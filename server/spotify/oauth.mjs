import { PORT } from "../config.mjs";

export const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "streaming",
].join(" ");

/** @type {Map<string, number>} */
export const spotifyOAuthPendingStates = new Map();

export function spotifyRedirectUri() {
  return process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${PORT}/api/spotify/callback`;
}

export function pruneSpotifyOAuthStates() {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [st, t] of spotifyOAuthPendingStates) {
    if (t < cutoff) spotifyOAuthPendingStates.delete(st);
  }
}
