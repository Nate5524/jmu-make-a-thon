import express from "express";
import { randomUUID } from "node:crypto";
import { state } from "../state.mjs";

const ALLOWED_SCHEDULE_TOOL_NAMES = new Set([
  "create_calendar_event",
  "delete_calendar_event",
  "edit_calendar_event",
  "set_demo_smart_home_device",
  "get_demo_smart_home_lights_state",
  "toggle_demo_smart_home_lights",
  "open_demo_smart_home_blinds",
  "close_demo_smart_home_blinds",
  "spotify_play",
  "spotify_pause",
  "spotify_skip_next",
  "spotify_skip_previous",
  "spotify_play_track",
  "spotify_queue_track",
]);

/** Same algorithm as client `scheduleTime.js` — local wall time on a calendar day → UTC ISO. */
function wallClockToUtcIso(dateStr, timeStr, timezone) {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const utcFmt = guess.toLocaleString("en-US", { timeZone: "UTC" });
  const tzFmt = guess.toLocaleString("en-US", { timeZone: timezone });
  return new Date(guess.getTime() - (new Date(tzFmt).getTime() - new Date(utcFmt).getTime())).toISOString();
}

function formatYmdInTz(ms, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

const SHORT_WEEKDAY_TO_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function weekdayInTz(ms, timeZone) {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    weekday: "short",
  }).format(new Date(ms));
  return SHORT_WEEKDAY_TO_NUM[label];
}

/** Proleptic Gregorian civil date + n days (matches calendar stepping for Y-M-D labels). */
function civilYmdPlusDays(ymd, deltaDays) {
  const [y, m, d] = ymd.split("-").map(Number);
  const u = Date.UTC(y, m - 1, d + deltaDays);
  const x = new Date(u);
  const yy = x.getUTCFullYear();
  const mm = String(x.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(x.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Next weekly run: next instant ≥ now in `schedule.timezone` where local weekday matches
 * `schedule.weekday` (0=Sun..6=Sat) and local clock matches `schedule.wallClockTime` (HH:MM).
 */
function advanceWeeklyNextRun(schedule, nowMs) {
  const tz = schedule.timezone || "UTC";
  const wall = schedule.wallClockTime;
  const wd = schedule.weekday;
  if (typeof wall !== "string" || !/^\d{2}:\d{2}$/.test(wall) || typeof wd !== "number" || wd < 0 || wd > 6) {
    return null;
  }

  const startYmd = formatYmdInTz(nowMs, tz);
  for (let offset = 0; offset < 370; offset++) {
    const ymd = civilYmdPlusDays(startYmd, offset);
    let iso;
    try {
      iso = wallClockToUtcIso(ymd, wall, tz);
    } catch {
      continue;
    }
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || t <= nowMs) continue;
    if (weekdayInTz(t, tz) === wd) return iso;
  }
  return null;
}

function advanceScheduleNextRun(schedule) {
  if (schedule.repeat === "once") return null;
  const nowMs = Date.now();
  if (schedule.repeat === "daily") {
    const periodMs = 86_400_000;
    let next = new Date(schedule.nextRunAt).getTime();
    do {
      next += periodMs;
    } while (next <= nowMs);
    return new Date(next).toISOString();
  }
  if (schedule.repeat === "weekly") {
    try {
      const nextIso = advanceWeeklyNextRun(schedule, nowMs);
      if (nextIso) return nextIso;
    } catch {
      /* fall through to legacy 7-day step */
    }
  }
  const periodMs = 7 * 86_400_000;
  let next = new Date(schedule.nextRunAt).getTime();
  do {
    next += periodMs;
  } while (next <= nowMs);
  return new Date(next).toISOString();
}

export function createSchedulesRouter() {
  const router = express.Router();

  router.post("/", (req, res) => {
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
    if (
      b.repeat !== "once" &&
      (typeof b.wallClockTime !== "string" || !/^\d{2}:\d{2}$/.test(b.wallClockTime))
    ) {
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

  router.post("/consume-due", (_req, res) => {
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

  router.delete("/:id", (req, res) => {
    const idx = state.schedules.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Schedule not found." });
    state.schedules.splice(idx, 1);
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    res.json({ ok: true, revision: state.revision });
  });

  return router;
}
