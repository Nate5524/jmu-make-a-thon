import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
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
      { id: "ambient", name: "Lights", on: false },
    ],
  };
}

const LIGHTS_WEBHOOK_URL = process.env.LIGHTS_WEBHOOK_URL || "";
const LIGHTS_SSH_HOST = process.env.LIGHTS_SSH_HOST || "";
const BLINDS_OPEN_WEBHOOK_URL = process.env.BLINDS_OPEN_WEBHOOK_URL || "";
const BLINDS_CLOSE_WEBHOOK_URL = process.env.BLINDS_CLOSE_WEBHOOK_URL || "";

/**
 * Fire the HA webhook that toggles the physical lights.
 * If LIGHTS_SSH_HOST is set, SSH into that host and curl from there (needed when
 * HA only responds to localhost). Otherwise, POST directly via fetch.
 */
async function postLightsWebhook() {
  if (!LIGHTS_WEBHOOK_URL) return;
  if (LIGHTS_SSH_HOST) {
    return new Promise((resolve, reject) => {
      execFile("ssh", [
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=5",
        LIGHTS_SSH_HOST,
        `curl -sf -X POST ${LIGHTS_WEBHOOK_URL}`,
      ], { timeout: 10000 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve();
      });
    });
  }
  const r = await fetch(LIGHTS_WEBHOOK_URL, { method: "POST", signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Lights webhook returned ${r.status}`);
}

/**
 * Fire the HA webhook that opens or closes the physical blinds.
 * @param {boolean} open - true = open/raise, false = close/lower
 */
async function postBlindsWebhook(open) {
  const url = open ? BLINDS_OPEN_WEBHOOK_URL : BLINDS_CLOSE_WEBHOOK_URL;
  if (!url) return;
  if (LIGHTS_SSH_HOST) {
    return new Promise((resolve, reject) => {
      execFile("ssh", [
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=5",
        LIGHTS_SSH_HOST,
        `curl -sf -X POST ${url}`,
      ], { timeout: 10000 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve();
      });
    });
  }
  const r = await fetch(url, { method: "POST", signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Blinds webhook returned ${r.status}`);
}

function normalizeSmartHomeDevices(devices) {
  if (!Array.isArray(devices)) return defaultSmartHome().devices;
  const byId = new Map(devices.filter((d) => d && ALLOWED_DEVICE_IDS.has(d.id)).map((d) => [d.id, !!d.on]));
  return defaultSmartHome().devices.map((d) => ({
    ...d,
    on: byId.has(d.id) ? byId.get(d.id) : d.on,
  }));
}

/** Drop legacy devices (e.g. desk lamp), map desk → blinds once, always expose Blinds + Lights. */
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
  /** @type {Array<Object>} Scheduled jobs (one-shot and repeating). */
  schedules: [],
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
      schedules: state.schedules,
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

  app.delete("/api/chat", (req, res) => {
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
    state.chatHistory = [];
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    res.json({ ok: true, revision: state.revision, updatedAt: state.updatedAt });
  });

  app.post("/api/smart-home/toggle", async (req, res) => {
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
    if (id === "ambient") {
      try { await postLightsWebhook(); } catch (err) {
        console.warn("Lights webhook failed:", err.message);
        return res.status(502).json({ error: "Lights webhook unreachable" });
      }
    }
    if (id === "blinds") {
      try { await postBlindsWebhook(!d.on); } catch (err) {
        console.warn("Blinds webhook failed:", err.message);
        return res.status(502).json({ error: "Blinds webhook unreachable" });
      }
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

  app.post("/api/smart-home/set", async (req, res) => {
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
    if (id === "ambient" && d.on !== on) {
      try { await postLightsWebhook(); } catch (err) {
        console.warn("Lights webhook failed:", err.message);
        return res.status(502).json({ error: "Lights webhook unreachable" });
      }
    }
    if (id === "blinds") {
      try { await postBlindsWebhook(on); } catch (err) {
        console.warn("Blinds webhook failed:", err.message);
        return res.status(502).json({ error: "Blinds webhook unreachable" });
      }
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

  async function blindsOpenCloseHandler(open, res) {
    reconcileSmartHomeToCanonical();
    const d = state.smartHome.devices.find((x) => x.id === "blinds");
    if (!d) {
      return res.status(404).json({ error: "device not found" });
    }
    try {
      await postBlindsWebhook(open);
    } catch (err) {
      console.warn("Blinds webhook failed:", err.message);
      return res.status(502).json({ error: "Blinds webhook unreachable" });
    }
    d.on = open;
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    res.json({
      ok: true,
      revision: state.revision,
      updatedAt: state.updatedAt,
      smartHome: JSON.parse(JSON.stringify(state.smartHome)),
    });
  }

  app.post("/api/smart-home/blinds/open", async (_req, res) => {
    await blindsOpenCloseHandler(true, res);
  });

  app.post("/api/smart-home/blinds/close", async (_req, res) => {
    await blindsOpenCloseHandler(false, res);
  });

  app.put("/api/state", async (req, res) => {
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
      const prevAmbient = state.smartHome.devices.find((x) => x.id === "ambient");
      const prevAmbientOn = prevAmbient ? prevAmbient.on : false;
      const prevBlinds = state.smartHome.devices.find((x) => x.id === "blinds");
      const prevBlindsOn = prevBlinds ? prevBlinds.on : false;

      const devices = body.smartHome.devices;
      const nextDevices = normalizeSmartHomeDevices(devices);
      const nextAmbient = nextDevices.find((x) => x.id === "ambient");
      const nextAmbientOn = nextAmbient ? nextAmbient.on : false;
      const nextBlinds = nextDevices.find((x) => x.id === "blinds");
      const nextBlindsOn = nextBlinds ? nextBlinds.on : false;

      if (prevAmbientOn !== nextAmbientOn) {
        try { await postLightsWebhook(); } catch (err) {
          console.warn("Lights webhook failed:", err.message);
          return res.status(502).json({ error: "Lights webhook unreachable" });
        }
      }
      if (prevBlindsOn !== nextBlindsOn) {
        try { await postBlindsWebhook(nextBlindsOn); } catch (err) {
          console.warn("Blinds webhook failed:", err.message);
          return res.status(502).json({ error: "Blinds webhook unreachable" });
        }
      }

      state.smartHome = { devices: nextDevices };
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

  // ─── Schedules ───────────────────────────────────────────────────────────────
  const ALLOWED_SCHEDULE_TOOL_NAMES = new Set([
    "create_calendar_event", "delete_calendar_event", "edit_calendar_event",
    "set_demo_smart_home_device",
    "get_demo_smart_home_lights_state",
    "toggle_demo_smart_home_lights",
    "open_demo_smart_home_blinds",
    "close_demo_smart_home_blinds",
    "spotify_play", "spotify_pause", "spotify_skip_next", "spotify_skip_previous",
    "spotify_play_track", "spotify_queue_track",
  ]);

  function advanceScheduleNextRun(schedule) {
    if (schedule.repeat === "once") return null;
    const now = Date.now();
    const periodMs = (schedule.repeat === "daily" ? 1 : 7) * 86_400_000;
    let next = new Date(schedule.nextRunAt).getTime();
    do { next += periodMs; } while (next <= now);
    return new Date(next).toISOString();
  }

  app.post("/api/schedules", (req, res) => {
    const b = req.body || {};
    if (!["static", "llm_followup"].includes(b.mode)) {
      return res.status(400).json({ error: "mode must be 'static' or 'llm_followup'" });
    }
    if (!b.nextRunAt || Number.isNaN(new Date(b.nextRunAt).getTime())) {
      return res.status(400).json({ error: "nextRunAt must be a valid ISO datetime" });
    }
    if (!["once", "daily", "weekly"].includes(b.repeat)) {
      return res.status(400).json({ error: "repeat must be 'once', 'daily', or 'weekly'" });
    }
    if (b.repeat === "weekly") {
      const wd = b.weekday;
      if (typeof wd !== "number" || wd < 0 || wd > 6 || !Number.isInteger(wd)) {
        return res.status(400).json({ error: "weekday (0-6) required for weekly schedules" });
      }
    }
    if (b.repeat !== "once" && (typeof b.wallClockTime !== "string" || !/^\d{2}:\d{2}$/.test(b.wallClockTime))) {
      return res.status(400).json({ error: "wallClockTime (HH:MM) required for repeating schedules" });
    }
    if (b.mode === "static" && typeof b.storedAssistantText !== "string") {
      return res.status(400).json({ error: "storedAssistantText required for static mode" });
    }
    if (b.mode === "llm_followup" && typeof b.storedInstruction !== "string") {
      return res.status(400).json({ error: "storedInstruction required for llm_followup mode" });
    }
    if (Array.isArray(b.toolSteps)) {
      for (const step of b.toolSteps) {
        if (!step || !ALLOWED_SCHEDULE_TOOL_NAMES.has(step.name)) {
          return res.status(400).json({ error: `Tool '${step?.name}' not allowed in schedules` });
        }
      }
    }

    const schedule = {
      id: randomUUID(),
      nextRunAt: new Date(b.nextRunAt).toISOString(),
      timezone: typeof b.timezone === "string" ? b.timezone : "UTC",
      repeat: b.repeat,
      wallClockTime: b.wallClockTime || null,
      weekday: b.repeat === "weekly" ? b.weekday : undefined,
      createdBy: b.createdBy === "jarvis" ? "jarvis" : "user",
      label: typeof b.label === "string" ? b.label : "",
      mode: b.mode,
    };

    if (b.mode === "static") {
      schedule.storedAssistantText = b.storedAssistantText;
      schedule.speak = b.speak !== false;
    } else {
      schedule.storedInstruction = b.storedInstruction;
      schedule.toolSteps = Array.isArray(b.toolSteps)
        ? b.toolSteps.filter((s) => s && ALLOWED_SCHEDULE_TOOL_NAMES.has(s.name))
        : [];
      schedule.speak = b.speak !== false;
    }

    state.schedules.push(schedule);
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    res.json({ ok: true, schedule, revision: state.revision });
  });

  app.delete("/api/schedules/:id", (req, res) => {
    const idx = state.schedules.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Schedule not found." });
    state.schedules.splice(idx, 1);
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    res.json({ ok: true, revision: state.revision });
  });

  app.post("/api/schedules/consume-due", (_req, res) => {
    const now = new Date();
    const due = [];
    const remaining = [];
    for (const s of state.schedules) {
      if (new Date(s.nextRunAt) <= now) {
        due.push({ ...s });
        if (s.repeat !== "once") {
          const next = advanceScheduleNextRun(s);
          if (next) remaining.push({ ...s, nextRunAt: next });
        }
      } else {
        remaining.push(s);
      }
    }
    if (due.length) {
      state.schedules = remaining;
      state.revision += 1;
      state.updatedAt = new Date().toISOString();
    }
    res.json({ jobs: due, revision: state.revision });
  });

  // ─── Calendar endpoints ────────────────────────────────────────────────────
  app.get("/api/calendar/events", async (req, res) => {
    if (!calendarClient || !CALENDAR_ID) {
      return res
        .status(503)
        .json({ error: "Google Calendar not configured on the server." });
    }
    try {
      let timeMin;
      let timeMax;
      const qMin = req.query.timeMin;
      const qMax = req.query.timeMax;
      if (typeof qMin === "string" && qMin && typeof qMax === "string" && qMax) {
        timeMin = new Date(qMin);
        timeMax = new Date(qMax);
        if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime())) {
          return res.status(400).json({ error: "Invalid timeMin or timeMax." });
        }
        if (timeMax.getTime() <= timeMin.getTime()) {
          return res.status(400).json({ error: "timeMax must be after timeMin." });
        }
        const maxSpanMs = 366 * 24 * 60 * 60 * 1000;
        if (timeMax.getTime() - timeMin.getTime() > maxSpanMs) {
          return res.status(400).json({ error: "Requested range too large (max 366 days)." });
        }
      } else {
        const now = new Date();
        timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      }

      const spanMs = timeMax.getTime() - timeMin.getTime();
      const spanDays = spanMs / (24 * 60 * 60 * 1000);
      const maxResults =
        spanDays <= 1.5 ? 80 : Math.min(500, Math.ceil(spanDays) * 12 + 40);

      const resp = await calendarClient.events.list({
        calendarId: CALENDAR_ID,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults,
      });

      const events = (resp.data.items || []).map((ev) => ({
        id: ev.id,
        summary: ev.summary || "(No title)",
        description: ev.description || "",
        allDay: Boolean(ev.start?.date),
        start: ev.start.dateTime || ev.start.date,
        end: ev.end.dateTime || ev.end.date,
      }));

      res.json({ events });
    } catch (err) {
      console.error("[calendar] Failed to list events:", err.message);
      res.status(500).json({ error: "Failed to fetch calendar events." });
    }
  });

  /** Build Google Calendar start/end objects from a request body. */
  function calendarTimeFields(body) {
    if (body.allDay) {
      const startDate = body.startDate || body.date;
      if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
      let endDate = body.endDate;
      if (!endDate) {
        const d = new Date(startDate + "T00:00:00");
        d.setDate(d.getDate() + 1);
        endDate = d.toISOString().slice(0, 10);
      }
      return {
        start: { date: startDate },
        end: { date: endDate },
      };
    }
    const { start, end } = body;
    if (!start || !end) return null;
    return {
      start: { dateTime: start, timeZone: "America/New_York" },
      end: { dateTime: end, timeZone: "America/New_York" },
    };
  }

  function calendarEventResponse(ev) {
    return {
      id: ev.id,
      summary: ev.summary || "(No title)",
      description: ev.description || "",
      allDay: Boolean(ev.start?.date),
      start: ev.start.dateTime || ev.start.date,
      end: ev.end.dateTime || ev.end.date,
    };
  }

  app.post("/api/calendar/events", async (req, res) => {
    if (!calendarClient || !CALENDAR_ID) {
      return res
        .status(503)
        .json({ error: "Google Calendar not configured on the server." });
    }
    const { summary, description } = req.body || {};
    if (!summary) {
      return res.status(400).json({ error: "summary is required." });
    }
    const times = calendarTimeFields(req.body);
    if (!times) {
      return res
        .status(400)
        .json({ error: "Provide start/end (timed) or allDay + startDate (all-day)." });
    }
    try {
      const resp = await calendarClient.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: {
          summary,
          description: description || "",
          ...times,
        },
      });
      res.json({ ok: true, event: calendarEventResponse(resp.data) });
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

  app.put("/api/spotify/player/volume", async (req, res) => {
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

  app.post("/api/spotify/player/queue", async (req, res) => {
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

  app.patch("/api/calendar/events/:eventId", async (req, res) => {
    if (!calendarClient || !CALENDAR_ID) {
      return res
        .status(503)
        .json({ error: "Google Calendar not configured on the server." });
    }
    const eventId = decodeURIComponent(req.params.eventId);
    const body = req.body || {};
    const requestBody = {};
    if (body.summary !== undefined) requestBody.summary = body.summary;
    if (body.description !== undefined) requestBody.description = body.description;
    const times = calendarTimeFields(body);
    if (times) Object.assign(requestBody, times);
    if (Object.keys(requestBody).length === 0) {
      return res.status(400).json({ error: "No fields to update." });
    }
    try {
      const resp = await calendarClient.events.patch({
        calendarId: CALENDAR_ID,
        eventId,
        requestBody,
      });
      res.json({ ok: true, event: calendarEventResponse(resp.data) });
    } catch (err) {
      console.error("[calendar] Failed to update event:", err.message);
      res.status(500).json({ error: "Failed to update calendar event." });
    }
  });

  app.delete("/api/calendar/events/:eventId", async (req, res) => {
    if (!calendarClient || !CALENDAR_ID) {
      return res
        .status(503)
        .json({ error: "Google Calendar not configured on the server." });
    }
    const eventId = decodeURIComponent(req.params.eventId);
    try {
      await calendarClient.events.delete({
        calendarId: CALENDAR_ID,
        eventId,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("[calendar] Failed to delete event:", err.message);
      res.status(500).json({ error: "Failed to delete calendar event." });
    }
  });

  app.get("/", (_req, res) => {
    res.redirect(302, "/jarvis.html");
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
