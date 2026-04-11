import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { randomBytes } from "node:crypto";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 3000;

// ─── Spotify (Web API + optional Web Playback SDK token) ─────────────────────
const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "streaming",
].join(" ");

/** @type {Map<string, number>} */
const spotifyOAuthPendingStates = new Map();
let spotifyTokenCache = { accessToken: "", expiresAt: 0 };

function spotifyRedirectUri() {
  return (
    process.env.SPOTIFY_REDIRECT_URI ||
    `http://localhost:${PORT}/api/spotify/callback`
  );
}

function spotifyEnvConfigured() {
  return !!(
    process.env.SPOTIFY_REFRESH_TOKEN &&
    process.env.SPOTIFY_CLIENT_ID &&
    process.env.SPOTIFY_CLIENT_SECRET
  );
}

function pruneSpotifyOAuthStates() {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [st, t] of spotifyOAuthPendingStates) {
    if (t < cutoff) spotifyOAuthPendingStates.delete(st);
  }
}

async function getSpotifyAccessToken() {
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
    spotifyTokenCache = { accessToken: "", expiresAt: 0 };
    return null;
  }

  const expiresIn = Number(data.expires_in) || 3600;
  spotifyTokenCache = {
    accessToken: data.access_token,
    expiresAt: now + expiresIn * 1000,
  };
  if (data.refresh_token) {
    console.warn(
      "[spotify] Spotify returned a new refresh_token — update SPOTIFY_REFRESH_TOKEN in .env"
    );
  }
  return spotifyTokenCache.accessToken;
}

/**
 * @param {string} method
 * @param {string} apiPath path starting with /me/...
 * @param {{ json?: unknown, query?: Record<string, string> }} opts
 */
async function spotifyApiRequest(method, apiPath, opts = {}) {
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

// ─── Google Calendar (service account) ────────────────────────────────────────
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "";
const SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "jmu-make-a-thon-97645ef3d37e.json"
);

let calendarClient = null;
try {
  const creds = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"));
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  calendarClient = google.calendar({ version: "v3", auth });
  console.log("[calendar] Service account loaded:", creds.client_email);
} catch (err) {
  console.warn(
    "[calendar] Could not load service account key — calendar endpoints disabled.",
    err.message
  );
}

/** Extra Jarvis instructions (merged into prompt). Edit here or set JARVIS_PERSONALITY in `.env` — not editable from any UI. */
const DEFAULT_JARVIS_PERSONALITY =
  "Emphasize sleep hygiene and campus resources when relevant. Stay concise and PG-13.";

const ALLOWED_DEVICE_IDS = new Set(["blinds", "ambient"]);

function initialPersonality() {
  const fromEnv = process.env.JARVIS_PERSONALITY;
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    return String(fromEnv);
  }
  return DEFAULT_JARVIS_PERSONALITY;
}

function defaultSmartHome() {
  return {
    devices: [
      { id: "blinds", name: "Blinds", on: false },
      { id: "ambient", name: "Ambient lights", on: true },
    ],
  };
}

function normalizeSmartHomeDevices(devices) {
  if (!Array.isArray(devices)) return defaultSmartHome().devices;
  const byId = new Map(devices.filter((d) => d && ALLOWED_DEVICE_IDS.has(d.id)).map((d) => [d.id, !!d.on]));
  return defaultSmartHome().devices.map((d) => ({
    ...d,
    on: byId.has(d.id) ? byId.get(d.id) : d.on,
  }));
}

/** Drop legacy devices (e.g. desk lamp), map desk → blinds once, always expose Blinds + Ambient lights. */
function reconcileSmartHomeToCanonical() {
  const prev = Array.isArray(state.smartHome?.devices) ? state.smartHome.devices : [];
  const before = JSON.stringify(prev);
  const map = new Map();
  for (const d of prev) {
    if (d && d.id) map.set(String(d.id).toLowerCase(), d);
  }
  const desk = map.get("desk");
  const defaults = defaultSmartHome().devices;
  state.smartHome.devices = defaults.map((def) => {
    let on = def.on;
    const cur = map.get(String(def.id).toLowerCase());
    if (cur) on = !!cur.on;
    else if (def.id === "blinds" && desk && !map.get("blinds")) on = !!desk.on;
    return { id: def.id, name: def.name, on };
  });
  if (before !== JSON.stringify(state.smartHome.devices)) {
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
  }
}

function getAdminSecret() {
  if (process.env.ADMIN_SECRET) return process.env.ADMIN_SECRET;
  if (!isProd) return "dev-demo-secret";
  return "";
}

let state = {
  revision: 0,
  updatedAt: new Date().toISOString(),
  feed: { personality: initialPersonality() },
  smartHome: defaultSmartHome(),
  /** @type {Array<{ role: string, content: string }>} */
  chatHistory: [],
};

reconcileSmartHomeToCanonical();

function createApp() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/state", (_req, res) => {
    reconcileSmartHomeToCanonical();
    res.json({
      revision: state.revision,
      updatedAt: state.updatedAt,
      feed: { ...state.feed },
      smartHome: JSON.parse(JSON.stringify(state.smartHome)),
      chatHistory: state.chatHistory,
    });
  });

  app.post("/api/chat", (req, res) => {
    const { role, content } = req.body || {};
    if (!role || typeof content !== "string") {
      return res.status(400).json({ error: "role and content required" });
    }
    state.chatHistory.push({ role, content });
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    res.json({ ok: true, revision: state.revision });
  });

  app.post("/api/smart-home/toggle", (req, res) => {
    reconcileSmartHomeToCanonical();
    let id = req.body?.id;
    if (id === "desk") id = "blinds";
    if (id !== "blinds" && id !== "ambient") {
      return res.status(400).json({ error: "id must be blinds or ambient" });
    }
    const d = state.smartHome.devices.find((x) => x.id === id);
    if (!d) {
      return res.status(404).json({ error: "device not found" });
    }
    d.on = !d.on;
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    res.json({
      ok: true,
      revision: state.revision,
      updatedAt: state.updatedAt,
      smartHome: JSON.parse(JSON.stringify(state.smartHome)),
    });
  });

  app.post("/api/smart-home/set", (req, res) => {
    reconcileSmartHomeToCanonical();
    let id = req.body?.id;
    if (id === "desk") id = "blinds";
    if (id !== "blinds" && id !== "ambient") {
      return res.status(400).json({ error: "id must be blinds or ambient" });
    }
    const on = req.body?.on;
    if (typeof on !== "boolean") {
      return res.status(400).json({ error: "on must be a boolean" });
    }
    const d = state.smartHome.devices.find((x) => x.id === id);
    if (!d) {
      return res.status(404).json({ error: "device not found" });
    }
    d.on = on;
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    res.json({
      ok: true,
      revision: state.revision,
      updatedAt: state.updatedAt,
      smartHome: JSON.parse(JSON.stringify(state.smartHome)),
    });
  });

  app.put("/api/state", (req, res) => {
    const secret = getAdminSecret();
    if (!secret) {
      return res
        .status(503)
        .json({ error: "Set ADMIN_SECRET in the environment for writes." });
    }
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (token !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body || {};
    if (body.smartHome && typeof body.smartHome === "object") {
      const devices = body.smartHome.devices;
      state.smartHome = {
        devices: normalizeSmartHomeDevices(devices),
      };
      reconcileSmartHomeToCanonical();
    }

    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    res.json({
      ok: true,
      revision: state.revision,
      updatedAt: state.updatedAt,
    });
  });

  // ─── Calendar endpoints ────────────────────────────────────────────────────
  app.get("/api/calendar/events", async (_req, res) => {
    if (!calendarClient || !CALENDAR_ID) {
      return res
        .status(503)
        .json({ error: "Google Calendar not configured on the server." });
    }
    try {
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      ).toISOString();
      const endOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1
      ).toISOString();

      const resp = await calendarClient.events.list({
        calendarId: CALENDAR_ID,
        timeMin: startOfDay,
        timeMax: endOfDay,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 25,
      });

      const events = (resp.data.items || []).map((ev) => ({
        id: ev.id,
        summary: ev.summary || "(No title)",
        description: ev.description || "",
        start: ev.start.dateTime || ev.start.date,
        end: ev.end.dateTime || ev.end.date,
      }));

      res.json({ events });
    } catch (err) {
      console.error("[calendar] Failed to list events:", err.message);
      res.status(500).json({ error: "Failed to fetch calendar events." });
    }
  });

  app.post("/api/calendar/events", async (req, res) => {
    if (!calendarClient || !CALENDAR_ID) {
      return res
        .status(503)
        .json({ error: "Google Calendar not configured on the server." });
    }
    const { summary, start, end, description } = req.body || {};
    if (!summary || !start || !end) {
      return res
        .status(400)
        .json({ error: "summary, start, and end are required." });
    }
    try {
      const resp = await calendarClient.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: {
          summary,
          description: description || "",
          start: { dateTime: start, timeZone: "America/New_York" },
          end: { dateTime: end, timeZone: "America/New_York" },
        },
      });
      const ev = resp.data;
      res.json({
        ok: true,
        event: {
          id: ev.id,
          summary: ev.summary,
          description: ev.description || "",
          start: ev.start.dateTime || ev.start.date,
          end: ev.end.dateTime || ev.end.date,
        },
      });
    } catch (err) {
      console.error("[calendar] Failed to create event:", err.message);
      res.status(500).json({ error: "Failed to create calendar event." });
    }
  });

  // ─── Spotify: one-time OAuth (copy refresh token → .env) ─────────────────────
  app.get("/api/spotify/login", (req, res) => {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res
        .status(503)
        .type("html")
        .send(
          "<p>Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in <code>.env</code>, restart the server, then try again.</p>"
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

  app.get("/api/spotify/callback", async (req, res) => {
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
          "<p>No refresh_token in response. Revoke app access in Spotify account settings and try again.</p>"
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
<p>Restart <code>npm run dev</code>, then open <a href="/jarvis.html">Jarvis</a>.</p>
</body></html>`);
  });

  // ─── Spotify: API for Jarvis (refresh token in env = single account) ───────
  app.get("/api/spotify/oauth-token", async (_req, res) => {
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

  app.get("/api/spotify/player", async (_req, res) => {
    if (!spotifyEnvConfigured()) {
      return res.status(503).json({ error: "Spotify not configured on the server." });
    }
    const r = await spotifyApiRequest("GET", "/me/player", {});
    if (!r.ok) {
      const msg = r.error || r.data?.error?.message || "Spotify player request failed.";
      if (r.status === 401 || r.status === 403) {
        spotifyTokenCache = { accessToken: "", expiresAt: 0 };
      }
      return res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({ error: msg });
    }
    if (r.status === 204 || r.data == null) {
      return res.json({ player: null });
    }
    return res.json({ player: r.data });
  });

  app.put("/api/spotify/player/play", async (req, res) => {
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

  app.put("/api/spotify/player/pause", async (req, res) => {
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

  app.post("/api/spotify/player/next", async (req, res) => {
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

  app.post("/api/spotify/player/previous", async (req, res) => {
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

  app.put("/api/spotify/player/transfer", async (req, res) => {
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

  app.get("/api/spotify/search", async (req, res) => {
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

  return app;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function main() {
  const app = createApp();

  if (isProd) {
    const dist = path.join(__dirname, "dist");
    app.use((req, res, next) => {
      if (process.env.ENABLE_ADMIN_UI !== "true") {
        const p = req.path || "";
        if (p === "/admin.html" || p.endsWith("/admin.html")) {
          return res.status(404).end("Not found");
        }
      }
      next();
    });
    app.use(express.static(dist));
  } else {
    const vite = await createViteServer({
      root: __dirname,
      server: { middlewareMode: true },
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    const mode = isProd ? "production" : "development";
    console.log(`[${mode}] http://localhost:${PORT}/ (LAN: http://0.0.0.0:${PORT}/)`);
    if (!isProd && !process.env.ADMIN_SECRET) {
      console.log("[dev] Using default ADMIN_SECRET for PUT /api/state: dev-demo-secret");
    }
    if (isProd && process.env.ENABLE_ADMIN_UI !== "true") {
      console.log("[prod] admin.html is not served (set ENABLE_ADMIN_UI=true to allow)");
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
