import express from "express";
import { CALENDAR_ID, calendarClient } from "./client.mjs";

export function createCalendarRouter() {
  const router = express.Router();

  router.get("/events", async (req, res) => {
    if (!calendarClient || !CALENDAR_ID) {
      return res.status(503).json({ error: "Google Calendar not configured on the server." });
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
        // UTC calendar day so the default window does not depend on the host's local timezone.
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth();
        const d = now.getUTCDate();
        timeMin = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
        timeMax = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0));
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
        start: ev.start?.dateTime || ev.start?.date,
        end: ev.end?.dateTime || ev.end?.date,
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
      start: ev.start?.dateTime || ev.start?.date,
      end: ev.end?.dateTime || ev.end?.date,
    };
  }

  router.post("/events", async (req, res) => {
    if (!calendarClient || !CALENDAR_ID) {
      return res.status(503).json({ error: "Google Calendar not configured on the server." });
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

  router.patch("/events/:eventId", async (req, res) => {
    if (!calendarClient || !CALENDAR_ID) {
      return res.status(503).json({ error: "Google Calendar not configured on the server." });
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

  router.delete("/events/:eventId", async (req, res) => {
    if (!calendarClient || !CALENDAR_ID) {
      return res.status(503).json({ error: "Google Calendar not configured on the server." });
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

  return router;
}
