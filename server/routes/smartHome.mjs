import express from "express";
import { reconcileSmartHomeToCanonical, state } from "../state.mjs";
import { postBlindsWebhook, postLightsWebhook } from "../webhooks.mjs";

export function createSmartHomeRouter() {
  const router = express.Router();

  router.post("/toggle", async (req, res) => {
    reconcileSmartHomeToCanonical(state);
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
      try {
        await postLightsWebhook();
      } catch (err) {
        console.warn("Lights webhook failed:", err.message);
        return res.status(502).json({ error: "Lights webhook unreachable" });
      }
    }
    if (id === "blinds") {
      try {
        await postBlindsWebhook(!d.on);
      } catch (err) {
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

  router.post("/set", async (req, res) => {
    reconcileSmartHomeToCanonical(state);
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
      try {
        await postLightsWebhook();
      } catch (err) {
        console.warn("Lights webhook failed:", err.message);
        return res.status(502).json({ error: "Lights webhook unreachable" });
      }
    }
    if (id === "blinds") {
      try {
        await postBlindsWebhook(on);
      } catch (err) {
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
    reconcileSmartHomeToCanonical(state);
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

  router.post("/blinds/open", async (_req, res) => {
    await blindsOpenCloseHandler(true, res);
  });

  router.post("/blinds/close", async (_req, res) => {
    await blindsOpenCloseHandler(false, res);
  });

  return router;
}
