import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 3000;

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

  return app;
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
