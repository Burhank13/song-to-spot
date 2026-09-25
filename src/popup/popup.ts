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

async function refreshStatus(): Promise<void> {
  showError("");
  status = await sendMessage<StatusResponse>({ type: "GET_STATUS" });

  $("connect-btn").classList.toggle("hidden", status.connected);
  $("disconnect-btn").classList.toggle("hidden", !status.connected);
  $("playlist-section").classList.toggle("hidden", !status.connected);
  $("last-result").textContent = status.lastResult ?? "";
  updateSaveButton();

  // The playlist list only changes on connect or an explicit refresh, so
  // don't refetch it on every storage change (e.g. after each save).
  if (status.connected && !playlistsLoaded) {
    playlistsLoaded = true;
    await loadPlaylists(status.playlistId);
  } else if (!status.connected) {
    playlistsLoaded = false;
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

  $("disconnect-btn").addEventListener("click", async () => {
    await sendMessage({ type: "DISCONNECT_SPOTIFY" });
    await refreshStatus();
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
    await refreshStatus();
  });

  $("save-btn").addEventListener("click", async () => {
    showError("");
    const saveBtn = $<HTMLButtonElement>("save-btn");
    saveBtn.disabled = true;
    const response = await sendMessage<BackgroundResponse>({ type: "SAVE_NOW_PLAYING" });
    if (isErrorResponse(response)) {
      showError(response.error);
    }
    await refreshStatus();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.lastResult || changes.spotifyTokens) {
      void refreshStatus();
    }
  });

  await Promise.all([refreshStatus(), refreshNowPlaying(), showShortcut()]);
}

void init();
