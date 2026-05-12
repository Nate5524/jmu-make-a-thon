import express from "express";
import { getAdminSecret } from "../lib/adminSecret.mjs";
import { state } from "../state.mjs";

export function createChatRouter() {
  const router = express.Router();

  router.post("/chat", (req, res) => {
    const { role, content } = req.body || {};
    if (!role || typeof content !== "string") {
      return res.status(400).json({ error: "role and content required" });
    }
    state.chatHistory.push({ role, content });
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    res.json({ ok: true, revision: state.revision });
  });

  router.delete("/chat", (req, res) => {
    const secret = getAdminSecret();
    if (!secret) {
      return res.status(503).json({ error: "Set ADMIN_SECRET in the environment for writes." });
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

  return router;
}
