// End-to-end tests: loads the built extension (dist/) into Chromium, plays
// audio on local test pages, and drives the popup and service worker against
// a fake Spotify API installed inside the service worker.
//
// Run with `npm run test:e2e`. Needs a Chromium that still accepts
// --load-extension (branded Chrome 137+ does not):
//   npx playwright install chromium
// or point CHROME_PATH at a Chrome for Testing build.
//
// A real (off-screen, muted) window is used because headless Chromium has no
// audio output, so tabs are never marked audible.

import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXT = path.join(ROOT, "dist");
const EXT_ID = "ikedjmlbcpnelopjhnbhkglanccjjjnh";
const SCREENSHOTS = path.join(ROOT, "tests", "e2e", "screenshots");
fs.mkdirSync(SCREENSHOTS, { recursive: true });

// --- local test site --------------------------------------------------------
// /player?play=1&ms=1&title=..&artist=..&doc=..&pause=1
const PLAYER = `<!doctype html><html><head><title>loading</title></head><body>
<script>
const p = new URLSearchParams(location.search);
document.title = p.get("doc") || "Test page";
function wav() {
  const rate = 8000, n = rate * 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const s = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVE"); s(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / rate * 2 * Math.PI * 440) * 300, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}
if (p.get("play")) {
  const a = document.createElement("audio");
  a.src = wav(); a.loop = true; document.body.appendChild(a);
  a.play().then(() => { if (p.get("pause")) setTimeout(() => a.pause(), 500); });
}
if (p.get("ms")) {
  navigator.mediaSession.metadata = new MediaMetadata({ title: p.get("title") || "", artist: p.get("artist") || "" });
  navigator.mediaSession.playbackState = p.get("pause") ? "paused" : "playing";
}
</script></body></html>`;

function resolveChrome() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }
  const bundled = chromium.executablePath();
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  console.error(
    "No Chromium found. Run `npx playwright install chromium`, or set CHROME_PATH to a Chrome for Testing binary."
  );
  process.exit(2);
}

if (!fs.existsSync(path.join(EXT, "manifest.json"))) {
  console.error("dist/ is missing. Run `npm run build` first (npm run test:e2e does this).");
  process.exit(2);
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(PLAYER);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const playerUrl = (query) =>
  `http://127.0.0.1:${server.address().port}/player?${new URLSearchParams(query)}`;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "songs-to-spot-e2e-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: resolveChrome(),
  headless: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--autoplay-policy=no-user-gesture-required",
    "--window-position=-2400,-2400",
  ],
});

const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
// Mute every tab. Unlike --mute-audio, per-tab muting keeps tabs "audible".
await sw.evaluate(() =>
  chrome.tabs.onCreated.addListener((tab) => chrome.tabs.update(tab.id, { muted: true }))
);

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail && !pass ? `\n      -> ${detail}` : ""}`);
}
function section(title) {
  console.log(`\n# ${title}`);
}

const settle = (ms = 1500) => new Promise((resolve) => setTimeout(resolve, ms));
const popupUrl = `chrome-extension://${EXT_ID}/src/popup/popup.html`;
// A popup page kept open in a tab, used to send messages as the popup would.
const control = await context.newPage();
await control.goto(popupUrl);
const send = (message) => control.evaluate((m) => chrome.runtime.sendMessage(m), message);
const storage = (keys) => control.evaluate((k) => chrome.storage.local.get(k), keys);
const setStorage = (values) => control.evaluate((v) => chrome.storage.local.set(v), values);
const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));
const clearGuard = () => setStorage({ lastSentKey: null, lastSentAt: 0 });

async function closePlayers() {
  for (const page of context.pages()) {
    if (!page.url().startsWith("chrome-extension://")) {
      await page.close();
    }
  }
}
async function openPlayer(query) {
  const page = await context.newPage();
  await page.goto(playerUrl(query));
  return page;
}
async function openPopup(height = 760) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 340, height });
  await page.goto(popupUrl);
  await settle(1200);
  return page;
}
const text = (page, id) => page.evaluate((i) => document.getElementById(i).textContent.trim(), id);
const visible = (page, id) =>
  page.evaluate((i) => !document.getElementById(i).classList.contains("hidden"), id);

let r;
try {
  // -------------------------------------------------------------------------
  section("Setup");
  check("extension loads with the pinned ID", sw.url().includes(EXT_ID), sw.url());
  const commands = await control.evaluate(() => chrome.commands.getAll());
  const shortcut = commands.find((c) => c.name === "save-now-playing")?.shortcut;
  check("Alt+Shift+S shortcut is registered", shortcut === "Alt+Shift+S", shortcut);

  // -------------------------------------------------------------------------
  section("Now-playing detection");
  await openPlayer({ play: 1, ms: 1, title: "Glue (Official Video)", artist: "Bicep", doc: "ms-page" });
  await settle();
  const audible = await sw.evaluate(async () => (await chrome.tabs.query({ audible: true })).length);
  check("playing tab is reported audible", audible > 0, `audible tabs=${audible}`);
  r = await send({ type: "GET_NOW_PLAYING" });
  check("Media Session: title cleaned, artist kept",
    r.nowPlaying?.title === "Glue" && r.nowPlaying?.artist === "Bicep", JSON.stringify(r));
  await closePlayers();

  await openPlayer({ play: 1, doc: "Bicep - Glue (Official Audio)" });
  await settle();
  r = await send({ type: "GET_NOW_PLAYING" });
  check("page-title fallback splits 'Artist - Song'",
    r.nowPlaying?.title === "Glue" && r.nowPlaying?.artist === "Bicep", JSON.stringify(r));
  await closePlayers();

  await openPlayer({ play: 1, ms: 1, title: "Background Song", artist: "Loud Tab", doc: "loud" });
  await openPlayer({ doc: "Silent Artist - Silent Song" });
  await settle();
  r = await send({ type: "GET_NOW_PLAYING" });
  check("audible background tab wins over silent active tab",
    r.nowPlaying?.title === "Background Song", JSON.stringify(r));
  await closePlayers();

  await openPlayer({ play: 1, pause: 1, ms: 1, title: "Paused Song", artist: "X", doc: "paused" });
  await settle(2000);
  r = await send({ type: "GET_NOW_PLAYING" });
  check("paused media is ignored", r.nowPlaying === null, JSON.stringify(r));
  await closePlayers();

  r = await send({ type: "GET_NOW_PLAYING" });
  check("nothing playing gives a reason", r.reason === "Nothing is playing.", JSON.stringify(r));

  await openPlayer({ play: 1, ms: 1, title: "Glue", artist: "Bicep", doc: "save-page" });
  await settle();
  r = await send({ type: "SAVE_NOW_PLAYING" });
  check("saving without Spotify asks to connect", r.error === "Connect Spotify first.", JSON.stringify(r));

  // -------------------------------------------------------------------------
  // Stateful fake Spotify. `mode` switches simulate failures.
  await sw.evaluate(() => {
    const art = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2264%22%3E%3Crect width=%2264%22 height=%2264%22 fill=%22%231db954%22/%3E%3C/svg%3E";
    const T = (id, name, artists, album) => ({
      uri: `spotify:track:${id}`, name, artists: artists.map((n) => ({ name: n })),
      album: { name: album, images: [{ url: art, width: 64 }] },
    });
    self.__fake = {
      calls: [], snap: 1, playlist: ["spotify:track:existing"], mode: {},
      glue: [T("karaoke", "Glue (Karaoke Version)", ["Sing2Piano"], "Karaoke Hits"), T("glue", "Glue", ["Bicep"], "Bicep")],
      glueLoose: [T("glue", "Glue", ["Bicep"], "Bicep"), T("glue2", "Glue", ["Emily Burns"], "Glue"), T("glue3", "Glue Song", ["Beulah"], "The Coast Is Never Clear")],
    };
    self.fetch = async (input, init = {}) => {
      const f = self.__fake;
      const u = new URL(typeof input === "string" ? input : input.url);
      const method = init.method || "GET";
      const p = u.pathname;
      f.calls.push({ method, host: u.host, path: p, q: u.searchParams.get("q"), body: init.body ?? null, auth: init.headers?.Authorization });
      const json = (status, obj, headers = {}) =>
        new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...headers } });

      if (f.mode.offline) throw new TypeError("Failed to fetch");
      if (u.host === "accounts.spotify.com" && p === "/api/token") {
        if (f.mode.tokenStatus) return json(f.mode.tokenStatus, { error: "invalid_grant" });
        return json(200, { access_token: "refreshed-token", expires_in: 3600 });
      }
      if (p === "/v1/search" && f.mode.searchStatus) return json(f.mode.searchStatus, { error: { status: f.mode.searchStatus } });
      if (p === "/v1/search" && f.mode.rateLimitOnce) {
        f.mode.rateLimitOnce = false;
        return json(429, { error: "rate" }, { "Retry-After": "1" });
      }
      if (p === "/v1/me") return json(200, { id: "me" });
      if (p === "/v1/me/playlists") return json(200, { next: null, items: [
        { id: "PL123", name: "Mine", collaborative: false, owner: { id: "me" } },
        { id: "PLX", name: "Followed", collaborative: false, owner: { id: "someone" } },
        { id: "PLC", name: "Collab", collaborative: true, owner: { id: "someone" } },
      ] });
      if (p === "/v1/search") {
        const q = u.searchParams.get("q");
        if (q === "track:Glue artist:Bicep") return json(200, { tracks: { items: f.glue } });
        if (q === "Glue") return json(200, { tracks: { items: f.glueLoose } });
        return json(200, { tracks: { items: [] } });
      }
      if (p === "/v1/playlists/PL123" && u.searchParams.get("fields") === "snapshot_id") return json(200, { snapshot_id: `s${f.snap}` });
      if (p === "/v1/playlists/PL123/items" && method === "GET") return json(200, { next: null, items: f.playlist.map((uri) => ({ item: { uri } })) });
      if (p === "/v1/playlists/PL123/items" && method === "POST") {
        f.playlist.push(...JSON.parse(init.body).uris); f.snap++;
        return json(201, { snapshot_id: `s${f.snap}` });
      }
      if (p === "/v1/playlists/PL123/items" && method === "DELETE") {
        const gone = JSON.parse(init.body).items.map((i) => i.uri);
        f.playlist = f.playlist.filter((x) => !gone.includes(x)); f.snap++;
        return json(200, { snapshot_id: `s${f.snap}` });
      }
      return json(404, { error: `unexpected ${method} ${p}` });
    };
  });
  const fake = () => sw.evaluate(() => ({ calls: self.__fake.calls, playlist: self.__fake.playlist, snap: self.__fake.snap }));
  const resetCalls = () => sw.evaluate(() => { self.__fake.calls = []; });
  const setMode = (mode) => sw.evaluate((m) => { self.__fake.mode = m; }, mode);
  const TOKENS = { accessToken: "fake-token", refreshToken: "r", expiresAt: Date.now() + 3600e3 };

  await setStorage({
    spotifyTokens: TOKENS,
    settings: { playlistId: "PL123", playlistName: "Mine" },
    lastSentKey: null, lastSentAt: 0, history: [], pending: null, playlistCache: null,
  });
  await settle(500);

  // -------------------------------------------------------------------------
  section("Saving and matching");
  r = await send({ type: "FETCH_PLAYLISTS" });
  check("playlist list only has owned and collaborative playlists",
    JSON.stringify(r.playlists?.map((p) => p.id)) === '["PL123","PLC"]', JSON.stringify(r));

  await resetCalls();
  r = await send({ type: "SAVE_NOW_PLAYING" });
  let f = await fake();
  check("confident match adds the original, not the karaoke version",
    r.message === 'Added "Glue" by Bicep' && f.playlist.includes("spotify:track:glue") && !f.playlist.includes("spotify:track:karaoke"),
    JSON.stringify(r));
  const post = f.calls.find((c) => c.method === "POST");
  check("adds via POST /playlists/{id}/items with the bearer token",
    post?.path === "/v1/playlists/PL123/items" && post?.body === '{"uris":["spotify:track:glue"]}' && post?.auth === "Bearer fake-token",
    JSON.stringify(post));
  check("one search when the filtered search is conclusive",
    f.calls.filter((c) => c.path === "/v1/search").length === 1, JSON.stringify(f.calls.map((c) => c.path)));
  let s = await storage(["history", "playlistCache"]);
  check("history records the add", s.history[0]?.status === "added" && s.history[0]?.match?.uri === "spotify:track:glue", JSON.stringify(s.history[0]));
  check("playlist cache tracks the new snapshot",
    s.playlistCache?.snapshotId === `s${f.snap}` && s.playlistCache.uris.includes("spotify:track:glue"), JSON.stringify(s.playlistCache));

  await resetCalls();
  r = await send({ type: "SAVE_NOW_PLAYING" });
  f = await fake();
  check("second save within 30s is blocked without API calls",
    r.error === "Already saved: Glue" && f.calls.length === 0, JSON.stringify(r));

  await clearGuard();
  await resetCalls();
  r = await send({ type: "SAVE_NOW_PLAYING" });
  f = await fake();
  check("song already in the playlist is not added twice",
    r.message?.includes("already in your playlist") && f.playlist.filter((x) => x === "spotify:track:glue").length === 1, JSON.stringify(r));
  check("unchanged snapshot skips refetching playlist contents",
    !f.calls.some((c) => c.method === "GET" && c.path === "/v1/playlists/PL123/items"), JSON.stringify(f.calls.map((c) => c.path)));

  // -------------------------------------------------------------------------
  section("Picking a match");
  await closePlayers();
  await openPlayer({ play: 1, doc: "Glue" });
  await settle();
  await resetCalls();
  r = await send({ type: "SAVE_NOW_PLAYING" });
  s = await storage(["pending"]);
  check("unknown artist asks instead of adding", r.message?.includes("Open the extension to pick"), JSON.stringify(r));
  check("falls back to a free-text search",
    (await fake()).calls.some((c) => c.path === "/v1/search" && c.q === "Glue"), "");
  check("offers 3 candidates", s.pending?.candidates?.length === 3, JSON.stringify(s.pending));
  check("badge shows '?' while a pick is pending", (await badge()) === "?", await badge());

  let popup = await openPopup();
  await popup.screenshot({ path: path.join(SCREENSHOTS, "popup-pick.png"), fullPage: true });
  const rows = await popup.evaluate(() => [...document.querySelectorAll("#pick-list li .name")].map((n) => n.textContent));
  check("popup shows the picker", rows.length === 3, JSON.stringify(rows));
  await popup.locator("#pick-list li", { hasText: "Emily Burns" }).getByRole("button", { name: "Add" }).click();
  await settle(1000);
  f = await fake();
  s = await storage(["pending"]);
  check("picking a candidate adds that exact song", f.playlist.includes("spotify:track:glue2"), JSON.stringify(f.playlist));
  check("picking clears the pick and the badge", s.pending === null && (await badge()) === "", "");

  await clearGuard();
  await send({ type: "SAVE_NOW_PLAYING" });
  const hadPending = Boolean((await storage(["pending"])).pending);
  await send({ type: "DISMISS_PENDING" });
  check("'None of these' clears the pick",
    hadPending && (await storage(["pending"])).pending === null && (await badge()) === "", "");

  // -------------------------------------------------------------------------
  section("History and undo");
  await popup.reload();
  await settle(1000);
  await popup.screenshot({ path: path.join(SCREENSHOTS, "popup-history.png"), fullPage: true });
  const undoButtons = await popup.locator("#history-list button", { hasText: "Undo" }).count();
  check("Undo is offered only for added songs", undoButtons === 2, `undo buttons=${undoButtons}`);
  await resetCalls();
  await popup.locator("#history-list li", { hasText: "Emily Burns" }).getByRole("button", { name: "Undo" }).click();
  await settle(1000);
  f = await fake();
  s = await storage(["history", "playlistCache"]);
  const del = f.calls.find((c) => c.method === "DELETE");
  check("undo sends DELETE with items[].uri", del?.body === '{"items":[{"uri":"spotify:track:glue2"}]}', del?.body);
  check("undo updates the playlist, history and cache",
    !f.playlist.includes("spotify:track:glue2") &&
      s.history.find((h) => h.match?.uri === "spotify:track:glue2")?.status === "removed" &&
      !s.playlistCache.uris.includes("spotify:track:glue2"),
    JSON.stringify(f.playlist));

  // -------------------------------------------------------------------------
  section("Popup layout");
  await resetCalls();
  await popup.reload();
  await settle(1000);
  check("chosen playlist collapses to a summary line",
    (await visible(popup, "playlist-summary")) && !(await visible(popup, "playlist-section")) && (await text(popup, "playlist-name")) === "Mine", "");
  check("playlists are not fetched while the picker is collapsed",
    !(await fake()).calls.some((c) => c.path === "/v1/me/playlists"), "");
  await popup.click("#change-playlist");
  await settle(800);
  const options = await popup.evaluate(() => [...document.querySelectorAll("#playlist-select option")].map((o) => o.textContent));
  check("'Change' opens the picker and loads playlists",
    (await visible(popup, "playlist-section")) && options.includes("Mine") && options.includes("Collab"), JSON.stringify(options));
  await popup.selectOption("#playlist-select", "PL123");
  await settle(800);
  check("choosing a playlist collapses the picker again", !(await visible(popup, "playlist-section")), "");
  check("disconnect is a footer link when connected", await visible(popup, "footer"), "");

  // -------------------------------------------------------------------------
  section("Spotify errors");
  await closePlayers();
  await openPlayer({ play: 1, ms: 1, title: "Glue", artist: "Bicep", doc: "error-page" });
  await settle();

  await setMode({ searchStatus: 403 });
  await clearGuard();
  r = await send({ type: "SAVE_NOW_PLAYING" });
  check("403 explains Premium / User Management", /Premium.*User Management/.test(r.error ?? ""), r.error);
  check("403 keeps the user connected", Boolean((await storage(["spotifyTokens"])).spotifyTokens), "");

  await setMode({ searchStatus: 503 });
  await resetCalls();
  r = await send({ type: "SAVE_NOW_PLAYING" });
  f = await fake();
  check("5xx gives a plain message, no raw JSON", r.error === "Spotify is having problems right now (503). Try again shortly.", r.error);
  check("5xx on a read is retried once", f.calls.filter((c) => c.path === "/v1/search").length === 2, `searches=${f.calls.filter((c) => c.path === "/v1/search").length}`);

  await setMode({ rateLimitOnce: true });
  await resetCalls();
  await sw.evaluate(() => { self.__fake.playlist = self.__fake.playlist.filter((u) => u !== "spotify:track:glue"); self.__fake.snap++; });
  const started = Date.now();
  r = await send({ type: "SAVE_NOW_PLAYING" });
  check("short 429 is waited out and retried", r.ok === true && Date.now() - started >= 1000, JSON.stringify(r));

  await setMode({ offline: true });
  await clearGuard();
  r = await send({ type: "SAVE_NOW_PLAYING" });
  check("network failure gives a connection message", r.error?.startsWith("Couldn't reach Spotify"), r.error);

  await setMode({ tokenStatus: 400 });
  await clearGuard();
  await setStorage({ spotifyTokens: { ...TOKENS, expiresAt: 0 } });
  r = await send({ type: "SAVE_NOW_PLAYING" });
  check("revoked login gives a reconnect message", /Connect Spotify again/.test(r.error ?? ""), r.error);
  check("revoked login signs the user out", (await storage(["spotifyTokens"])).spotifyTokens === null, "");

  await popup.reload();
  await settle(1000);
  check("popup then offers 'Connect Spotify'",
    (await visible(popup, "connect-btn")) && !(await visible(popup, "footer")), "");

  await popup.evaluate(() => {
    const button = document.getElementById("save-btn");
    button.classList.remove("hidden");
    button.disabled = false;
    button.click();
  });
  await settle(1000);
  check("action errors stay visible in the popup", (await text(popup, "error")) === "Connect Spotify first.", await text(popup, "error"));
  await popup.screenshot({ path: path.join(SCREENSHOTS, "popup-disconnected.png"), fullPage: true });

  await setMode({});
  await setStorage({ spotifyTokens: TOKENS });
  popup = await openPopup(620);
  await popup.screenshot({ path: path.join(SCREENSHOTS, "popup-connected.png"), fullPage: true });
} catch (error) {
  check("test run completed without crashing", false, error.stack);
} finally {
  await context.close();
  server.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

const failed = results.filter((x) => !x.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed. Screenshots: tests/e2e/screenshots/`);
process.exit(failed ? 1 : 0);
