import type {
  BackgroundResponse,
  Message,
  PlaylistsResponse,
  StatusResponse,
} from "../shared/messages";

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

function isStatusResponse(value: BackgroundResponse): value is StatusResponse {
  return "connected" in value;
}

function isPlaylistsResponse(value: BackgroundResponse): value is PlaylistsResponse {
  return "playlists" in value;
}

function isErrorResponse(
  value: BackgroundResponse
): value is { ok: false; error: string } {
  return "ok" in value && value.ok === false;
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
  const status = await sendMessage<StatusResponse>({ type: "GET_STATUS" });

  $("connect-btn").classList.toggle("hidden", status.connected);
  $("disconnect-btn").classList.toggle("hidden", !status.connected);
  $("playlist-section").classList.toggle("hidden", !status.connected);
  $("controls-section").classList.toggle("hidden", !status.connected);

  const enabledToggle = $<HTMLInputElement>("enabled-toggle");
  enabledToggle.checked = status.enabled;

  const sendNowBtn = $("send-now-btn") as HTMLButtonElement;
  const canConfirm = Boolean(status.connected && status.lastTrack && status.playlistId);

  if (status.lastTrack) {
    $("track-title").textContent = status.lastTrack.title;
    $("track-artist").textContent = status.lastTrack.artist || "Unknown artist";
  } else {
    $("track-title").textContent = "No track detected yet";
    $("track-artist").textContent = "";
  }

  sendNowBtn.disabled = !canConfirm;
  $("last-result").textContent = status.lastResult ?? "";

  if (status.connected) {
    await loadPlaylists(status.playlistId);
  }
}

async function init(): Promise<void> {
  $("connect-btn").addEventListener("click", async () => {
    showError("");
    const response = await sendMessage<BackgroundResponse>({ type: "AUTH_SPOTIFY" });
    if (isErrorResponse(response)) {
      showError(response.error);
      return;
    }
    if (isStatusResponse(response)) {
      await refreshStatus();
    }
  });

  $("disconnect-btn").addEventListener("click", async () => {
    await sendMessage({ type: "DISCONNECT_SPOTIFY" });
    await refreshStatus();
  });

  $("refresh-playlists-btn").addEventListener("click", async () => {
    const status = await sendMessage<StatusResponse>({ type: "GET_STATUS" });
    await loadPlaylists(status.playlistId);
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

  $<HTMLInputElement>("enabled-toggle").addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    await sendMessage({ type: "TOGGLE_ENABLED", enabled: input.checked });
  });

  $("send-now-btn").addEventListener("click", async () => {
    showError("");
    const response = await sendMessage<BackgroundResponse>({ type: "SEND_NOW" });
    if (isErrorResponse(response)) {
      showError(response.error);
      return;
    }
    await refreshStatus();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (
      changes.lastTrack ||
      changes.spotifyTokens ||
      changes.settings ||
      changes.playlistId ||
      changes.playlistName
    ) {
      void refreshStatus();
    }
  });

  await refreshStatus();
}

void init();
