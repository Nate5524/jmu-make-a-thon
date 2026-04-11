import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 3000;

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

function getAdminSecret() {
  if (process.env.ADMIN_SECRET) return process.env.ADMIN_SECRET;
  if (!isProd) return "dev-demo-secret";
  return "";
}

let state = {
  revision: 0,
  updatedAt: new Date().toISOString(),
  feed: { personality: "" },
  smartHome: {
    devices: [
      { id: "desk", name: "Desk lamp", on: false },
      { id: "ambient", name: "Ambient lights", on: true },
    ],
  },
  /** @type {Array<{ role: string, content: string }>} */
  chatHistory: [],
};

function createApp() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/state", (_req, res) => {
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
    if (body.feed && typeof body.feed === "object") {
      if (typeof body.feed.personality === "string") {
        state.feed.personality = body.feed.personality;
      }
    }
    if (body.smartHome && typeof body.smartHome === "object") {
      state.smartHome = body.smartHome;
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

  return app;
}

async function main() {
  const app = createApp();

  if (isProd) {
    const dist = path.join(__dirname, "dist");
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
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
