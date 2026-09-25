# Songs to Spotify

Chrome extension that saves the song playing in any browser tab to a Spotify playlist when you press a keyboard shortcut. It does **not** start playback on Spotify.

## How it works

1. Press **Alt+Shift+S** (or click **Add to playlist** in the popup).
2. The extension finds the tab that is making sound (preferring the active tab) and reads its track info from the [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API), falling back to the page title.
3. The title is cleaned up (strips "(Official Video)", "[Lyrics]", "ft. X", "- Topic", "VEVO", and splits "Artist - Song" on YouTube).
4. It searches Spotify and adds the best match to your chosen playlist, then shows a notification with the result.

Nothing runs in the background between shortcut presses.

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

Run the tests:

```bash
npm test
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
4. Play music on any site and press **Alt+Shift+S**. Change the shortcut at `chrome://extensions/shortcuts`.

## Notes

- The Spotify app owner needs **Spotify Premium**, and apps in Development Mode are limited to 5 allowlisted users.
- The extension skips `open.spotify.com` to avoid adding songs that are already playing in Spotify's web player.
- Sites that expose rich metadata via Media Session (YouTube, Bandcamp, many streaming sites) work best.
- Sites with generic page titles may produce weaker matches; check the popup to see what will be searched before saving.

## Permissions

- `<all_urls>` — detect media on any website
- `identity` — Spotify OAuth login
- `storage` — save settings and tokens
- `notifications` — show the result after the shortcut
- `tabs` — find the tab that is playing audio

## Project structure

```
src/
  content/detector.ts      # Reads now-playing info when asked
  shared/clean.ts          # Title/artist cleanup before searching
  background/              # Service worker + add-to-playlist pipeline
  spotify/                 # OAuth + Spotify Web API client
  popup/                   # Extension popup UI
```
