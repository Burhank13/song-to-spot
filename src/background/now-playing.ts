import type { TrackInfo } from "../shared/track";
import type { ContentMessage, ContentResponse } from "../shared/messages";
import { cleanTrack } from "../shared/clean";

export type NowPlayingResult =
  | { track: TrackInfo }
  | { track: null; reason: string };

async function readTab(
  tab: chrome.tabs.Tab
): Promise<{ responded: boolean; track: TrackInfo | null; reason?: string }> {
  if (tab.id === undefined) {
    return { responded: false, track: null };
  }
  try {
    const message: ContentMessage = {
      type: "READ_NOW_PLAYING",
      audible: Boolean(tab.audible),
    };
    const response = (await chrome.tabs.sendMessage(tab.id, message)) as
      | ContentResponse
      | undefined;
    return { responded: true, track: response?.track ?? null, reason: response?.reason };
  } catch {
    // No content script: chrome:// pages, or tabs opened before the
    // extension was installed or reloaded.
    return { responded: false, track: null };
  }
}

// Candidate order: the active tab if it is making sound, then other audible
// tabs (most recently used first), then the active tab even if silent.
async function candidateTabs(): Promise<chrome.tabs.Tab[]> {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const audible = (await chrome.tabs.query({ audible: true }))
    .filter((tab) => tab.id !== active?.id)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));

  const tabs: chrome.tabs.Tab[] = [];
  if (active?.audible) {
    tabs.push(active);
  }
  tabs.push(...audible);
  if (active && !active.audible) {
    tabs.push(active);
  }
  return tabs;
}

export async function findNowPlaying(): Promise<NowPlayingResult> {
  const tabs = await candidateTabs();
  let unreadableAudibleTab = false;
  let tabReason: string | undefined;

  for (const tab of tabs) {
    const { responded, track, reason } = await readTab(tab);
    if (track) {
      return { track: cleanTrack(track) };
    }
    tabReason ??= reason;
    if (!responded && tab.audible) {
      unreadableAudibleTab = true;
    }
  }

  return {
    track: null,
    reason: tabReason ?? (unreadableAudibleTab
      ? "Couldn't read the tab that's playing. Reload it and try again."
      : "Nothing is playing."),
  };
}
