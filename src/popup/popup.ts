import type { HistoryEntry, PendingPick } from "../shared/storage";
import type { Candidate } from "../spotify/match";
import type {
  BackgroundResponse,
  Message,
  NowPlayingResponse,
  PlaylistsResponse,
  StatusResponse,
} from "../shared/messages";

const SAVE_COMMAND = "save-now-playing";

function $<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

function showError(message: string): void {
  const errorEl = $("error");
  if (!message) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
    return;
  }
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

async function sendMessage<T extends BackgroundResponse>(
  message: Message
): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function isPlaylistsResponse(value: BackgroundResponse): value is PlaylistsResponse {
  return "playlists" in value;
}

function isErrorResponse(
  value: BackgroundResponse
): value is { ok: false; error: string } {
  return "ok" in value && value.ok === false;
}

let status: StatusResponse | null = null;
let hasNowPlaying = false;
let playlistsLoaded = false;
let editingPlaylist = false;

function updateSaveButton(): void {
  const saveBtn = $<HTMLButtonElement>("save-btn");
  saveBtn.classList.toggle("hidden", !status?.connected);
  saveBtn.disabled = !(status?.connected && status.playlistId && hasNowPlaying);
}

async function loadPlaylists(selectedId: string | null): Promise<void> {
  const response = await sendMessage<BackgroundResponse>({ type: "FETCH_PLAYLISTS" });
  if (isErrorResponse(response)) {
    showError(response.error);
    return;
  }
  if (!isPlaylistsResponse(response)) {
    return;
  }

  const select = $<HTMLSelectElement>("playlist-select");
  select.innerHTML = `<option value="">Select a playlist…</option>`;
  for (const playlist of response.playlists) {
    const option = document.createElement("option");
    option.value = playlist.id;
    option.textContent = playlist.name;
    if (playlist.id === selectedId) {
      option.selected = true;
    }
    select.appendChild(option);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function songRow(
  name: string,
  sub: string,
  imageUrl: string | null,
  action?: HTMLElement
): HTMLLIElement {
  const row = el("li");
  if (imageUrl) {
    const img = el("img");
    img.src = imageUrl;
    img.alt = "";
    img.addEventListener("error", () => img.replaceWith(el("div", "no-art")));
    row.appendChild(img);
  } else {
    row.appendChild(el("div", "no-art"));
  }
  const info = el("div", "info");
  info.append(el("p", "name", name), el("p", "sub", sub));
  row.appendChild(info);
  if (action) {
    row.appendChild(action);
  }
  return row;
}

async function runAction(message: Message): Promise<void> {
  showError("");
  const response = await sendMessage<BackgroundResponse>(message);
  if (isErrorResponse(response)) {
    showError(response.error);
  }
  await refreshStatus();
}

function renderPick(pending: PendingPick | null): void {
  $("pick-section").classList.toggle("hidden", !pending);
  const list = $("pick-list");
  list.replaceChildren();
  if (!pending) {
    return;
  }

  const { title, artist } = pending.track;
  $("pick-detected").textContent = `Heard: ${title}${artist ? ` — ${artist}` : ""}`;
  pending.candidates.forEach((candidate: Candidate) => {
    const button = el("button", "", "Add");
    button.type = "button";
    button.addEventListener("click", () => {
      button.disabled = true;
      void runAction({ type: "PICK_MATCH", uri: candidate.uri });
    });
    const sub = [candidate.artists.join(", "), candidate.album].filter(Boolean).join(" · ");
    list.appendChild(songRow(candidate.name, sub, candidate.imageUrl, button));
  });
}

const HISTORY_LABELS: Record<HistoryEntry["status"], string> = {
  added: "Added",
  already_in_playlist: "Already there",
  not_found: "Not found",
  removed: "Removed",
};

function renderHistory(history: HistoryEntry[]): void {
  $("history-section").classList.toggle("hidden", history.length === 0);
  const list = $("history-list");
  list.replaceChildren();

  for (const entry of history) {
    const name = entry.match?.name ?? entry.detected.title;
    const sub = entry.match?.artists.join(", ") ?? (entry.detected.artist || "Unknown artist");
    let action: HTMLElement;
    if (entry.status === "added") {
      action = el("button", "secondary", "Undo");
      (action as HTMLButtonElement).type = "button";
      action.addEventListener("click", () => {
        (action as HTMLButtonElement).disabled = true;
        void runAction({ type: "UNDO", entryId: entry.id });
      });
    } else {
      action = el("span", "tag", HISTORY_LABELS[entry.status]);
    }
    list.appendChild(songRow(name, sub, entry.match?.imageUrl ?? null, action));
  }
}

// Doesn't clear the error line: callers clear it before acting, and an
// error shown by an action must survive the refresh that follows it.
async function refreshStatus(): Promise<void> {
  status = await sendMessage<StatusResponse>({ type: "GET_STATUS" });

  const { connected, playlistId } = status;
  const showPicker = connected && (!playlistId || editingPlaylist);

  $("connect-btn").classList.toggle("hidden", connected);
  $("footer").classList.toggle("hidden", !connected);
  $("playlist-section").classList.toggle("hidden", !showPicker);
  $("playlist-summary").classList.toggle("hidden", !connected || showPicker);
  $("playlist-name").textContent = status.playlistName ?? "";
  $("last-result").textContent = status.lastResult ?? "";
  renderPick(status.pending);
  renderHistory(status.history);
  updateSaveButton();

  // Only fetch playlists when the picker is on screen, and only once: the
  // list changes on connect or an explicit refresh, not after each save.
  if (showPicker && !playlistsLoaded) {
    playlistsLoaded = true;
    await loadPlaylists(playlistId);
  } else if (!connected) {
    playlistsLoaded = false;
    editingPlaylist = false;
  }
}

async function refreshNowPlaying(): Promise<void> {
  const response = await sendMessage<NowPlayingResponse>({ type: "GET_NOW_PLAYING" });
  const track = response.nowPlaying;
  hasNowPlaying = Boolean(track);

  if (track) {
    $("track-title").textContent = track.title;
    $("track-artist").textContent = track.artist || "Unknown artist";
  } else {
    $("track-title").textContent = response.reason ?? "Nothing is playing.";
    $("track-artist").textContent = "";
  }
  updateSaveButton();
}

async function showShortcut(): Promise<void> {
  const hint = $("shortcut-hint");
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((c) => c.name === SAVE_COMMAND)?.shortcut;

  hint.textContent = shortcut ? `Shortcut: ${shortcut} · ` : "No shortcut set · ";
  const link = document.createElement("a");
  link.href = "#";
  link.textContent = shortcut ? "change" : "set one";
  link.addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });
  hint.appendChild(link);
}

async function init(): Promise<void> {
  $("connect-btn").addEventListener("click", async () => {
    showError("");
    const response = await sendMessage<BackgroundResponse>({ type: "AUTH_SPOTIFY" });
    if (isErrorResponse(response)) {
      showError(response.error);
      return;
    }
    await refreshStatus();
  });

  $("disconnect-link").addEventListener("click", async (event) => {
    event.preventDefault();
    await sendMessage({ type: "DISCONNECT_SPOTIFY" });
    await refreshStatus();
  });

  $("change-playlist").addEventListener("click", (event) => {
    event.preventDefault();
    editingPlaylist = true;
    void refreshStatus();
  });

  $("refresh-playlists-btn").addEventListener("click", async () => {
    await loadPlaylists(status?.playlistId ?? null);
  });

  $<HTMLSelectElement>("playlist-select").addEventListener("change", async (event) => {
    const select = event.target as HTMLSelectElement;
    const option = select.selectedOptions[0];
    if (!option || !option.value) {
      return;
    }
    await sendMessage({
      type: "SET_PLAYLIST",
      playlistId: option.value,
      playlistName: option.textContent ?? "",
    });
    editingPlaylist = false;
    await refreshStatus();
  });

  $("save-btn").addEventListener("click", () => {
    $<HTMLButtonElement>("save-btn").disabled = true;
    void runAction({ type: "SAVE_NOW_PLAYING" });
  });

  $("dismiss-btn").addEventListener("click", () => {
    void runAction({ type: "DISMISS_PENDING" });
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (
      changes.lastResult ||
      changes.spotifyTokens ||
      changes.settings ||
      changes.pending ||
      changes.history
    ) {
      void refreshStatus();
    }
  });

  await Promise.all([refreshStatus(), refreshNowPlaying(), showShortcut()]);
}

void init();
