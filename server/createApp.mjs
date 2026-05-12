import express from "express";
import { createCalendarRouter } from "./calendar/routes.mjs";
import { createChatRouter } from "./routes/chat.mjs";
import { createSchedulesRouter } from "./routes/schedules.mjs";
import { createSmartHomeRouter } from "./routes/smartHome.mjs";
import { createStateRouter } from "./routes/state.mjs";
import { createSpotifyRouter } from "./spotify/routes.mjs";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  const htmlDir = "/src/html";
  app.use((req, res, next) => {
    const p = req.path || "";
    if (p === "/jarvis.html") {
      return res.redirect(302, htmlDir + "/jarvis.html");
    }
    if (p === "/admin.html") {
      return res.redirect(302, htmlDir + "/admin.html");
    }
    if (p === "/index.html") {
      return res.redirect(302, htmlDir + "/index.html");
    }
    next();
  });

  app.use("/api", createStateRouter());
  app.use("/api", createChatRouter());
  app.use("/api/smart-home", createSmartHomeRouter());
  app.use("/api/schedules", createSchedulesRouter());
  app.use("/api/calendar", createCalendarRouter());
  app.use("/api/spotify", createSpotifyRouter());

  app.get("/", (_req, res) => {
    res.redirect(302, "/src/html/jarvis.html");
  });

  return app;
}
