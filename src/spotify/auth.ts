const SPOTIFY_SCOPES = [
  "playlist-modify-private",
  "playlist-modify-public",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

function randomVerifier(length = 64): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomVerifier();
  const challenge = base64UrlEncode(await sha256(verifier));
  return { verifier, challenge };
}

function getRedirectUri(): string {
  return chrome.identity.getRedirectURL();
}

function buildAuthUrl(challenge: string): string {
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCode(
  code: string,
  verifier: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const redirectUri = getRedirectUri();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  return response.json();
}

async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${text}`);
  }

  return response.json();
}

export async function authenticateSpotify(): Promise<import("../shared/storage").SpotifyTokens> {
  if (!CLIENT_ID || CLIENT_ID === "your_spotify_client_id_here") {
    throw new Error(
      "Set VITE_SPOTIFY_CLIENT_ID in a .env file and rebuild the extension."
    );
  }

  const { verifier, challenge } = await createPkcePair();
  const authUrl = buildAuthUrl(challenge);

  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  if (!redirectUrl) {
    throw new Error("Spotify authorization was cancelled.");
  }

  const redirectParams = new URL(redirectUrl).searchParams;
  const error = redirectParams.get("error");
  const errorDescription = redirectParams.get("error_description");
  if (error) {
    throw new Error(
      `Spotify authorization failed: ${error}${
        errorDescription ? ` — ${errorDescription}` : ""
      }`
    );
  }

  const code = redirectParams.get("code");
  if (!code) {
    throw new Error("No authorization code returned from Spotify.");
  }

  const tokens = await exchangeCode(code, verifier);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}

export async function getValidAccessToken(
  tokens: import("../shared/storage").SpotifyTokens
): Promise<{ accessToken: string; tokens: import("../shared/storage").SpotifyTokens }> {
  const bufferMs = 60_000;
  if (Date.now() < tokens.expiresAt - bufferMs) {
    return { accessToken: tokens.accessToken, tokens };
  }

  const refreshed = await refreshAccessToken(tokens.refreshToken);
  const updated = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
  };

  return { accessToken: updated.accessToken, tokens: updated };
}

export function getOAuthRedirectUriForSetup(): string {
  return getRedirectUri();
}
