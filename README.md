# Songs to Spotify

Chrome extension that saves the song playing in any browser tab to a Spotify playlist when you press a keyboard shortcut. It does **not** start playback on Spotify.

## How it works

1. Press **Alt+Shift+S** (or click **Add to playlist** in the popup).
2. The extension finds the tab that is making sound (preferring the active tab) and reads its track info from the [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API), falling back to the page title.
3. The title is cleaned up (strips "(Official Video)", "[Lyrics]", "ft. X", "- Topic", "VEVO", and splits "Artist - Song" on YouTube).
4. It searches Spotify and scores the results on title and artist, ranking karaoke, cover, remix, sped-up and similar versions lower unless that is what was playing.
5. If the best match is clear, it is added to your playlist (unless it is already there). If not, nothing is added: the icon shows **?** and the popup lets you pick from the top 3.
6. The popup lists your last 20 songs, with **Undo** for anything that was added.

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

### Tests

Unit tests (title cleanup, match scoring, error messages):

```bash
npm test
```

End-to-end tests load the built extension into Chromium, play audio on local test pages, and run every flow against a fake Spotify API (no account needed):

```bash
npx playwright install chromium   # once
npm run test:e2e
```

Branded Chrome 137+ ignores `--load-extension`, so the tests need Playwright's Chromium or a [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) build via `CHROME_PATH`. A muted window opens off-screen while they run. Screenshots of the popup are saved to `tests/e2e/screenshots/`.

Regenerate the icons with `npm run icons`.

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

## Troubleshooting

| Message | Fix |
| --- | --- |
| Invalid redirect URI (during connect) | Add the exact redirect URI from step 5 to your Spotify app, including the trailing slash |
| Spotify refused the request … Premium … User Management | The Spotify app owner needs Premium, and your account must be listed under **User Management** in the dashboard |
| Your Spotify login expired or was revoked | Click **Connect Spotify** again |
| Couldn't read the tab that's playing | Reload that tab (tabs opened before the extension was installed or reloaded can't be read) |
| An ad is playing | Wait for the YouTube ad to finish |

## Notes

- The Spotify app owner needs **Spotify Premium**, and apps in Development Mode are limited to 5 allowlisted users.
- The extension skips `open.spotify.com` to avoid adding songs that are already playing in Spotify's web player.
- Sites that expose rich metadata via Media Session (YouTube, Bandcamp, many streaming sites) work best.
- Sites with generic page titles, or no artist, always ask you to pick the right song.

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
