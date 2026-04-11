import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 3000;

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
