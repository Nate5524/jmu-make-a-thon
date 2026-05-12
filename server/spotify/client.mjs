export const spotifyTokenCache = { accessToken: "", expiresAt: 0 };

export function spotifyEnvConfigured() {
  return !!(
    process.env.SPOTIFY_REFRESH_TOKEN &&
    process.env.SPOTIFY_CLIENT_ID &&
    process.env.SPOTIFY_CLIENT_SECRET
  );
}

export async function getSpotifyAccessToken() {
  if (!spotifyEnvConfigured()) return null;

  const now = Date.now();
  if (spotifyTokenCache.accessToken && now < spotifyTokenCache.expiresAt - 60_000) {
    return spotifyTokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.SPOTIFY_REFRESH_TOKEN,
    client_id: process.env.SPOTIFY_CLIENT_ID,
    client_secret: process.env.SPOTIFY_CLIENT_SECRET,
  });

  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("[spotify] Token refresh failed:", data.error || resp.status);
    spotifyTokenCache.accessToken = "";
    spotifyTokenCache.expiresAt = 0;
    return null;
  }

  const expiresIn = Number(data.expires_in) || 3600;
  spotifyTokenCache.accessToken = data.access_token;
  spotifyTokenCache.expiresAt = now + expiresIn * 1000;
  if (data.refresh_token) {
    console.warn(
      "[spotify] Spotify returned a new refresh_token — update SPOTIFY_REFRESH_TOKEN in .env",
    );
  }
  return spotifyTokenCache.accessToken;
}

/**
 * @param {string} method
 * @param {string} apiPath path starting with /me/...
 * @param {{ json?: unknown, query?: Record<string, string> }} opts
 */
export async function spotifyApiRequest(method, apiPath, opts = {}) {
  const token = await getSpotifyAccessToken();
  if (!token) {
    return {
      ok: false,
      status: 503,
      data: null,
      error: "Could not obtain Spotify access token. Check .env credentials.",
    };
  }

  let url = `https://api.spotify.com/v1${apiPath}`;
  if (opts.query) {
    const q = new URLSearchParams(opts.query);
    url += `?${q.toString()}`;
  }

  /** @type {RequestInit} */
  const init = {
    method,
    headers: { Authorization: `Bearer ${token}` },
  };
  if (opts.json !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(opts.json);
  }

  const resp = await fetch(url, init);
  const text = await resp.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  return {
    ok: resp.ok,
    status: resp.status,
    data: parsed,
    error: parsed?.error?.message,
  };
}
