# Songs to Spotify

Chrome extension that detects songs playing on **any website** and adds them to a Spotify playlist. It does **not** start playback on Spotify.

## How it works

1. A content script runs on every page and reads track info from the [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API) when available.
2. If a site does not expose Media Session metadata, the extension falls back to the page title while audio/video is playing.
3. When a new track is detected, the extension searches Spotify and adds the best match to your chosen playlist.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Spotify app

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Create an app (Web API).
3. Copy the **Client ID**.

### 3. Configure environment

```bash
cp .env.example .env
```

Set your client ID in `.env`:

```
VITE_SPOTIFY_CLIENT_ID=your_client_id_here
```

### 4. Build the extension

```bash
npm run build
```

For development with hot reload:

```bash
npm run dev
```

### 5. Register the redirect URI

1. Load the extension in Chrome: `chrome://extensions` → **Load unpacked** → select the `dist` folder.
2. Open the service worker console (Inspect views → service worker).
3. Copy the logged redirect URI, e.g. `https://abcdefghijklmnop.chromiumapp.org/`.
4. Add that exact URI to your Spotify app's **Redirect URIs**.

### 6. Use the extension

1. Click the extension icon.
2. **Connect Spotify** and approve access.
3. Choose a **target playlist**.
4. Play music on any site — new songs are added automatically.

## Notes

- **Spotify Premium is not required** to add tracks to playlists.
- The extension skips `open.spotify.com` to avoid adding songs that are already playing in Spotify's web player.
- Sites that expose rich metadata via Media Session (YouTube, Bandcamp, many streaming sites) work best.
- Sites with generic page titles may produce weaker matches; use **Add current song now** after the page title updates if needed.

## Permissions

- `<all_urls>` — detect media on any website
- `identity` — Spotify OAuth login
- `storage` — save settings and tokens
- `notifications` — confirm when a song is added

## Project structure

```
src/
  content/detector.ts      # Universal now-playing detection
  background/              # Service worker + add-to-playlist pipeline
  spotify/                 # OAuth + Spotify Web API client
  popup/                   # Extension popup UI
```
