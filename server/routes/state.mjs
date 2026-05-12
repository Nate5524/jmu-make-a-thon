import express from "express";
import { getAdminSecret } from "../lib/adminSecret.mjs";
import {
  normalizeSmartHomeDevices,
  reconcileSmartHomeToCanonical,
  state,
} from "../state.mjs";
import { postBlindsWebhook, postLightsWebhook } from "../webhooks.mjs";

export function createStateRouter() {
  const router = express.Router();

  router.get("/state", (_req, res) => {
    reconcileSmartHomeToCanonical(state);
    res.json({
      revision: state.revision,
      updatedAt: state.updatedAt,
      feed: { ...state.feed },
      smartHome: JSON.parse(JSON.stringify(state.smartHome)),
      chatHistory: state.chatHistory,
      schedules: state.schedules,
    });
  });

  router.put("/state", async (req, res) => {
    const secret = getAdminSecret();
    if (!secret) {
      return res.status(503).json({ error: "Set ADMIN_SECRET in the environment for writes." });
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
        try {
          await postLightsWebhook();
        } catch (err) {
          console.warn("Lights webhook failed:", err.message);
          return res.status(502).json({ error: "Lights webhook unreachable" });
        }
      }
      if (prevBlindsOn !== nextBlindsOn) {
        try {
          await postBlindsWebhook(nextBlindsOn);
        } catch (err) {
          console.warn("Blinds webhook failed:", err.message);
          return res.status(502).json({ error: "Blinds webhook unreachable" });
        }
      }

      state.smartHome = { devices: nextDevices };
      reconcileSmartHomeToCanonical(state);
    }

    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    res.json({
      ok: true,
      revision: state.revision,
      updatedAt: state.updatedAt,
    });
  });

  return router;
}
