# Songs to Spotify — Chrome Extension Plan

## Goal
Build a **Chrome extension** that watches media playing in the browser, detects the current track (title + artist), and sends it to Spotify — search for a match and add it to a playlist.

## Scope change from desktop app
A Chrome extension detects media **inside Chrome tabs only** (not system-wide Apple Music, Spotify desktop, etc.). This is the MVP: most "discover music elsewhere" use cases happen in the browser (YouTube, YouTube Music, SoundCloud, Bandcamp, etc.).

## Recommended defaults (configurable later)

Decision | Default
--- | ---
Platform | Chrome / Chromium browsers (Edge, Brave)
Media source | Active tab via **Media Session API** + site-specific fallbacks
Supported sites (MVP) | YouTube, YouTube Music, SoundCloud
Spotify action (MVP) | **Add matched track to playlist**
Trigger mode | **Ask before adding** when track changes
Exclude Spotify as source | Yes — skip `open.spotify.com` tabs to avoid loops

---

## Architecture

```
flowchart LR
    subgraph tabs [BrowserTabs]
        CS[ContentScript]
        MediaSession[navigator.mediaSession]
        DOM[Site-specific DOM fallback]
    end

    subgraph bg [ServiceWorker]
        Dedup[Debounce and dedup]
        Pipeline[Detect to match to act]
    end

    subgraph spotify [SpotifyAPI]
        OAuth[OAuth PKCE via chrome.identity]
        Search[Search API]
        Action[Add to playlist]
    end

    subgraph ui [ExtensionUI]
        Popup[Popup]
        Options[Options page]
    end

    MediaSession --> CS
    DOM --> CS
    CS -->|chrome.runtime.sendMessage| Dedup --> Pipeline --> Search --> Action
    OAuth --> Search
    OAuth --> Action
    Popup --> bg
    Options --> bg
```

**Data flow:**

1. Content script polls `navigator.mediaSession.metadata` every ~2s (and listens for playback changes).
2. If metadata is missing, fall back to site-specific DOM selectors (e.g. YouTube Music title bar).
3. Send `{ title, artist, album, isPlaying, tabUrl }` to the service worker.
4. Service worker deduplicates, skips if source is Spotify or track unchanged.
5. Search Spotify: `GET /v1/search?q=track:{title} artist:{artist}&type=track&limit=1`.
6. Prompt the user for confirmation, then execute action with `spotify:track:{id}` to add it to the selected playlist.

---

## Tech stack

Layer | Choice | Why
--- | --- | ---
Extension platform | **Manifest V3** | Required for new Chrome extensions
Language | **TypeScript** | Type safety for messages and API responses
Build tool | **Vite** + `[@crxjs/vite-plugin](https://crxjs.dev/vite-plugin)` | Fast dev reload, auto-bundles extension
Media detection | Content scripts + **Media Session API** | Standard metadata on YouTube, YT Music, SoundCloud
Spotify API | Raw `fetch` in service worker | No Node deps; works in MV3 service worker
OAuth | **PKCE** via `chrome.identity.launchWebAuthFlow` | Official pattern for third-party OAuth in extensions
Storage | `chrome.storage.local` | Tokens, settings, last-sent track
UI | Popup HTML/CSS + optional lightweight framework-free JS | Keep MVP simple

---

## Prerequisites (one-time setup)

1. **Spotify Developer app** at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)

- App type: Web API
- Redirect URI: `https://<extension-id>.chromiumapp.org/` (get exact URL after first load via `chrome.identity.getRedirectURL()`)
- Note your **Client ID** (PKCE — no client secret)
2. **Spotify Premium** — required for [playback control via Web API](https://developer.spotify.com/documentation/web-api/concepts/authorization)
3. **OAuth scopes**:

- `playlist-modify-private` — add to playlist
- `user-read-playback-state` — optional if checking device state or current playback
- `user-library-modify` — optional for future liked songs support
4. **Extension ID stability**: During development, pin your extension ID by adding a `"key"` field to `manifest.json` so the Spotify redirect URI doesn't change on every reload.

---

## Project structure

```
songs-to-spot/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── .env.example                 # VITE_SPOTIFY_CLIENT_ID
├── .gitignore
├── README.md
├── EXTENSION_PLAN.md
├── public/
│   └── icons/                   # 16, 48, 128 px
├── src/
│   ├── manifest.json            # MV3 manifest (processed by crxjs)
│   ├── background/
│   │   ├── service-worker.ts    # main background logic
│   │   ├── pipeline.ts          # detect → search → act
│   │   └── dedup.ts
│   ├── content/
│   │   ├── detector.ts          # shared media session reader
│   │   ├── youtube.ts           # YouTube / YT Music DOM fallback
│   │   └── soundcloud.ts        # SoundCloud fallback
│   ├── spotify/
│   │   ├── auth.ts              # PKCE + chrome.identity
│   │   ├── client.ts            # search, add_to_playlist
│   │   └── types.ts
│   ├── shared/
│   │   ├── messages.ts          # typed message protocol
│   │   └── track.ts             # TrackInfo interface
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.ts
│   └── options/
│       ├── options.html
│       └── options.ts
└── tests/
    ├── dedup.test.ts
    └── search-query.test.ts
```

---

## Manifest V3 essentials
Key permissions and entries in `src/manifest.json`:

```
{
  "manifest_version": 3,
  "name": "Songs to Spotify",
  "permissions": ["storage", "identity", "notifications", "tabs"],
  "host_permissions": [
    "https://www.youtube.com/*",
    "https://music.youtube.com/*",
    "https://soundcloud.com/*",
    "https://api.spotify.com/*",
    "https://accounts.spotify.com/*"
  ],
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
  },
  "options_page": "src/options/options.html",
  "content_scripts": [
    {
      "matches": ["https://www.youtube.com/*", "https://music.youtube.com/*", "https://soundcloud.com/*"],
      "js": ["src/content/detector.ts"],
      "run_at": "document_idle"
    }
  ]
}
```

---

## Phase 1 — MVP (core pipeline)

### 1.1 Media detection (`src/content/detector.ts`)
Primary: **Media Session API** (works on most modern media sites):

```
function readMediaSession(): TrackInfo | null {
  const ms = navigator.mediaSession;
  if (!ms?.metadata) return null;
  if (ms.playbackState !== "playing") return null;
  return {
    title: ms.metadata.title,
    artist: ms.metadata.artist,
    album: ms.metadata.album,
    isPlaying: true,
    sourceUrl: location.href,
  };
}
```

Poll every 2s; also hook `document` visibility and `play` events on `<video>` / `<audio>` elements to reduce latency.

**Fallback** (`src/content/youtube.ts`): When `metadata.artist` is empty (common on plain YouTube), parse the page title or DOM:

- YouTube: `#title h1` or `document.title` (strip " - YouTube")
- YouTube Music: `.title`, `.byline` selectors (may break if Google changes UI — isolate in one file)

**Filter**: Skip sending if `location.hostname` includes `open.spotify.com`.

### 1.2 Message protocol (`src/shared/messages.ts`)
Typed messages between content script ↔ service worker:

Message | Direction | Payload
--- | --- | ---
`TRACK_UPDATE` | content → background | `TrackInfo`
`GET_STATUS` | popup → background | —
`STATUS` | background → popup | `{ connected, enabled, lastTrack, lastAction }`
`TOGGLE_ENABLED` | popup → background | `boolean`
`SEND_NOW` | popup → background | manual trigger for current track
`AUTH_SPOTIFY` | popup → background | starts OAuth flow

### 1.3 Spotify auth (`src/spotify/auth.ts`)
PKCE with `chrome.identity`:

```
const redirectUri = chrome.identity.getRedirectURL();
const { verifier, challenge } = generatePkce();
const authUrl = buildSpotifyAuthUrl({ clientId, redirectUri, challenge, scopes });
const responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
const code = new URL(responseUrl).searchParams.get("code");
const tokens = await exchangeCodeForTokens({ code, verifier, redirectUri, clientId });
await chrome.storage.local.set({ spotifyTokens: tokens });
```

Store `{ access_token, refresh_token, expires_at }` in `chrome.storage.local`. Refresh proactively before expiry.

### 1.4 Spotify client (`src/spotify/client.ts`)
Service worker calls Spotify REST API directly:

- Search: `GET https://api.spotify.com/v1/search?q=track:{title} artist:{artist}&type=track&limit=3`
- Add to playlist: `POST /v1/playlists/{playlist_id}/tracks`

Check playlist existence and selected playlist ID in settings before sending.

### 1.5 Pipeline (`src/background/pipeline.ts`)
On `TRACK_UPDATE`:

1. Detect a new track and skip if source is Spotify or unchanged
2. Search Spotify for the best match
3. Notify the popup or options UI that confirmation is needed
4. Wait for user confirmation before adding to playlist
5. Update badge / notification on success or failure
6. Persist last action to storage for popup display

### 1.6 Popup UI (`src/popup/popup.html`)
Minimal popup (~320px wide):

- **Now playing** — title + artist from active tab
- **Connect Spotify** button (hidden when authenticated)
- **Confirm add** button to approve the detected song
- **Send now** button for manual add without waiting for detection
- **Status line** — "Ready to add" / "Added to playlist" / "Not found" / "No playlist"

---

## Phase 2 — Configurable actions and options page
Settings stored in `chrome.storage.sync`:

```
interface Settings {
  action: "add_playlist" | "like" | "queue";
  targetPlaylistId: string | null;
  enabled: boolean;
  enabledSites: string[];  // hostnames
}
```

For Phase 1, the primary action is:

Action | Spotify API
--- | ---
Add to playlist | `POST /v1/playlists/{id}/tracks`

Options page: OAuth status, action dropdown, playlist picker (fetch user playlists after auth).

---

## Phase 3 — Polish and edge cases
Edge case | Handling
--- | ---
Track not found on Spotify | Badge `!` + notification; popup shows "No match"
No playlist selected | Notification: "Choose a playlist first"
Metadata missing (generic title) | Site-specific DOM fallback; skip if unparseable
Multiple tabs playing | Prefer active tab (`chrome.tabs.query({ active: true })`)
Duplicate sends | Dedup by `(title, artist)` hash within 30s
Token expired | Auto-refresh; re-auth prompt in popup if refresh fails
YouTube DOM changes | Isolate selectors; degrade gracefully to title-only search
User on Spotify web | Skip `open.spotify.com` to prevent feedback loop

---

## Testing plan

1. **Unit tests** (Vitest): dedup logic, search query builder, PKCE challenge generation
2. **Manual integration tests**:

- Load unpacked extension in `chrome://extensions`
- Play song on YouTube → add matching track to playlist on Spotify
- Play on YouTube Music → correct artist + title matched
- Click "Send now" manually → works without auto-send
- Play on open.spotify.com → extension ignores
- Disconnect/reconnect Spotify → tokens persist across browser restart
- No playlist selected → clear error message

---

## Implementation order
Build in this sequence so each step is independently testable:

1. **Scaffold** — Vite + crxjs, manifest, load unpacked in Chrome
2. **Content script** — log now-playing to console on YouTube
3. **Service worker** — receive messages, store last track
4. **Popup** — display current track from storage
5. **Spotify OAuth** — connect button, token persistence
6. **Spotify search** — given title/artist, log Spotify URI
7. **Pipeline** — wire auto-send: detect → search → add to playlist
8. **Options + actions** — playlist picker, save settings
9. **Icons, notifications, edge cases, store checklist**

---

## Future path (optional, post-MVP)
If you later want **system-wide** detection (outside Chrome), add a companion desktop app using Windows GSMTC — the extension and desktop app can share the same Spotify OAuth tokens and search logic. The extension remains the simpler starting point.

---

## Risks and limitations

- **Browser-only**: Cannot detect media from non-browser apps (Spotify desktop, Apple Music app, etc.)
- **Site coverage**: Media Session API works on major sites; obscure players may need custom content scripts
- **DOM fragility**: YouTube Music UI selectors can break on site updates — keep fallbacks layered
- **Premium required**: Playback control needs Spotify Premium; playlist add works on Free tier
- **Extension ID**: Must register exact `chromiumapp.org` redirect URI in Spotify dashboard; pin extension key during dev
- **CORS**: Spotify API calls run from service worker (extension origin), not content script — no CORS issues
