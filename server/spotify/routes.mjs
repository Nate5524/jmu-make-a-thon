import express from "express";
import { randomBytes } from "node:crypto";
import { escapeHtml } from "../lib/escapeHtml.mjs";
import {
  SPOTIFY_SCOPES,
  pruneSpotifyOAuthStates,
  spotifyOAuthPendingStates,
  spotifyRedirectUri,
} from "./oauth.mjs";
import {
  getSpotifyAccessToken,
  spotifyApiRequest,
  spotifyEnvConfigured,
  spotifyTokenCache,
} from "./client.mjs";

export function createSpotifyRouter() {
  const router = express.Router();

  router.get("/login", (req, res) => {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res
        .status(503)
        .type("html")
        .send(
          "<p>Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in <code>.env</code>, restart the server, then try again.</p>",
        );
    }
    pruneSpotifyOAuthStates();
    const state = randomBytes(16).toString("hex");
    spotifyOAuthPendingStates.set(state, Date.now());
    const auth = new URL("https://accounts.spotify.com/authorize");
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("scope", SPOTIFY_SCOPES);
    auth.searchParams.set("redirect_uri", spotifyRedirectUri());
    auth.searchParams.set("state", state);
    auth.searchParams.set("show_dialog", "true");
    res.redirect(auth.toString());
  });

  router.get("/callback", async (req, res) => {
    const { code, state, error: qErr } = req.query;
    if (typeof qErr === "string" && qErr) {
      return res.status(400).type("html").send(`<p>Spotify error: ${escapeHtml(qErr)}</p>`);
    }
    if (typeof code !== "string" || typeof state !== "string") {
      return res.status(400).type("html").send("<p>Missing code or state.</p>");
    }
    if (!spotifyOAuthPendingStates.has(state)) {
      return res
        .status(400)
        .type("html")
        .send("<p>Invalid or expired state — open <code>/api/spotify/login</code> again.</p>");
    }
    spotifyOAuthPendingStates.delete(state);

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: spotifyRedirectUri(),
      client_id: clientId,
      client_secret: clientSecret,
    });

    const tok = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await tok.json().catch(() => ({}));
    if (!tok.ok) {
      return res
        .status(400)
        .type("html")
        .send(`<p>Token exchange failed.</p><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`);
    }

    const refresh = data.refresh_token;
    if (!refresh) {
      return res
        .status(400)
        .type("html")
        .send(
          "<p>No refresh_token in response. Revoke app access in Spotify account settings and try again.</p>",
        );
    }

    res.type("html").send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Spotify setup</title>
<style>body{font-family:system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;}
code,pre{background:#111827;color:#e2e8f0;padding:.5rem;border-radius:8px;display:block;overflow:auto;}
</style></head><body>
<h1>Spotify linked</h1>
<p>Add this line to your <code>.env</code> (never commit real tokens):</p>
<pre>SPOTIFY_REFRESH_TOKEN=${escapeHtml(refresh)}</pre>
<p>Restart <code>npm run dev</code>, then open <a href="/src/html/jarvis.html">Jarvis</a>.</p>
</body></html>`);
  });

  router.get("/oauth-token", async (_req, res) => {
    if (!spotifyEnvConfigured()) {
      return res.status(503).json({ error: "Spotify not configured on the server." });
    }
    const token = await getSpotifyAccessToken();
    if (!token) {
      return res.status(503).json({ error: "Could not refresh Spotify access token." });
    }
    const ttl = Math.max(0, Math.floor((spotifyTokenCache.expiresAt - Date.now()) / 1000));
    res.json({ access_token: token, expires_in: ttl || 3600 });
  });

  router.get("/player", async (_req, res) => {
    if (!spotifyEnvConfigured()) {
      return res.status(503).json({ error: "Spotify not configured on the server." });
    }
    const r = await spotifyApiRequest("GET", "/me/player", {});
    if (!r.ok) {
      const msg = r.error || r.data?.error?.message || "Spotify player request failed.";
      if (r.status === 401 || r.status === 403) {
        spotifyTokenCache.accessToken = "";
        spotifyTokenCache.expiresAt = 0;
      }
      return res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({ error: msg });
    }
    if (r.status === 204 || r.data == null) {
      return res.json({ player: null });
    }
    return res.json({ player: r.data });
  });

  router.put("/player/play", async (req, res) => {
    if (!spotifyEnvConfigured()) {
      return res.status(503).json({ error: "Spotify not configured on the server." });
    }
    const deviceId = req.query.device_id;
    const path =
      typeof deviceId === "string" && deviceId
        ? `/me/player/play?device_id=${encodeURIComponent(deviceId)}`
        : "/me/player/play";
    const r = await spotifyApiRequest("PUT", path, {
      json: req.body && Object.keys(req.body).length ? req.body : undefined,
    });
    if (r.status === 204 || r.ok) {
      return res.status(204).end();
    }
    return res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
      error: r.data?.error?.message || "Play request failed.",
    });
  });

  router.put("/player/pause", async (req, res) => {
    if (!spotifyEnvConfigured()) {
      return res.status(503).json({ error: "Spotify not configured on the server." });
    }
    const deviceId = req.query.device_id;
    const path =
      typeof deviceId === "string" && deviceId
        ? `/me/player/pause?device_id=${encodeURIComponent(deviceId)}`
        : "/me/player/pause";
    const r = await spotifyApiRequest("PUT", path, {});
    if (r.status === 204 || r.ok) {
      return res.status(204).end();
    }
    return res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
      error: r.data?.error?.message || "Pause request failed.",
    });
  });

  router.put("/player/volume", async (req, res) => {
    if (!spotifyEnvConfigured()) {
      return res.status(503).json({ error: "Spotify not configured on the server." });
    }
    let raw = req.query.volume_percent;
    if (raw == null && req.body && req.body.volume_percent != null) {
      raw = req.body.volume_percent;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res
        .status(400)
        .json({ error: "volume_percent must be a number from 0 to 100 (query or JSON body)." });
    }
    const deviceId = req.query.device_id;
    /** @type {Record<string, string>} */
    const query = { volume_percent: String(Math.round(n)) };
    if (typeof deviceId === "string" && deviceId) {
      query.device_id = deviceId;
    }
    const r = await spotifyApiRequest("PUT", "/me/player/volume", { query });
    if (r.status === 204 || r.ok) {
      return res.status(204).end();
    }
    return res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
      error: r.data?.error?.message || "Volume request failed.",
    });
  });

  router.post("/player/next", async (req, res) => {
    if (!spotifyEnvConfigured()) {
      return res.status(503).json({ error: "Spotify not configured on the server." });
    }
    const deviceId = req.query.device_id;
    const path =
      typeof deviceId === "string" && deviceId
        ? `/me/player/next?device_id=${encodeURIComponent(deviceId)}`
        : "/me/player/next";
    const r = await spotifyApiRequest("POST", path, {});
    if (r.status === 204 || r.ok) {
      return res.status(204).end();
    }
    return res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
      error: r.data?.error?.message || "Next track failed.",
    });
  });

  router.post("/player/previous", async (req, res) => {
    if (!spotifyEnvConfigured()) {
      return res.status(503).json({ error: "Spotify not configured on the server." });
    }
    const deviceId = req.query.device_id;
    const path =
      typeof deviceId === "string" && deviceId
        ? `/me/player/previous?device_id=${encodeURIComponent(deviceId)}`
        : "/me/player/previous";
    const r = await spotifyApiRequest("POST", path, {});
    if (r.status === 204 || r.ok) {
      return res.status(204).end();
    }
    return res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
      error: r.data?.error?.message || "Previous track failed.",
    });
  });

  router.post("/player/queue", async (req, res) => {
    if (!spotifyEnvConfigured()) {
      return res.status(503).json({ error: "Spotify not configured on the server." });
    }
    const uri = req.body?.uri;
    if (typeof uri !== "string" || !uri.startsWith("spotify:")) {
      return res.status(400).json({ error: "body.uri must be a spotify: URI (e.g. spotify:track:…)." });
    }
    const deviceId = req.query.device_id;
    /** @type {Record<string, string>} */
    const query = { uri };
    if (typeof deviceId === "string" && deviceId) {
      query.device_id = deviceId;
    }
    const r = await spotifyApiRequest("POST", "/me/player/queue", { query });
    if (r.status === 204 || r.ok) {
      return res.status(204).end();
    }
    return res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
      error: r.data?.error?.message || "Add to queue failed.",
    });
  });

  router.put("/player/transfer", async (req, res) => {
    if (!spotifyEnvConfigured()) {
      return res.status(503).json({ error: "Spotify not configured on the server." });
    }
    const device_ids = req.body?.device_ids;
    if (!Array.isArray(device_ids) || !device_ids.length) {
      return res.status(400).json({ error: "device_ids array required." });
    }
    const r = await spotifyApiRequest("PUT", "/me/player", {
      json: { device_ids, play: !!req.body?.play },
    });
    if (r.status === 204 || r.ok) {
      return res.status(204).end();
    }
    return res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
      error: r.data?.error?.message || "Transfer failed.",
    });
  });

  router.get("/search", async (req, res) => {
    if (!spotifyEnvConfigured()) {
      return res.status(503).json({ error: "Spotify not configured on the server." });
    }
    const q = req.query.q;
    if (typeof q !== "string" || !q.trim()) {
      return res.status(400).json({ error: "q query parameter required." });
    }
    const r = await spotifyApiRequest("GET", "/search", {
      query: { q: q.trim(), type: "track", limit: "8" },
    });
    if (!r.ok) {
      return res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
        error: r.data?.error?.message || "Search failed.",
      });
    }
    res.json(r.data);
  });

  return router;
}
