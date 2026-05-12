import { CALENDAR_CONTEXT_HORIZON_DAYS } from "../shared/constants.js";
import { eventContextDayKey, formatContextDayHeading } from "./calendarDates.js";
import { weatherCodeToDescription } from "./weatherCodes.js";

/**
 * @param {{
 *   weatherData: unknown,
 *   calendarContextEvents: Array<{ id?: string, summary?: string, allDay?: boolean, start?: string, end?: string }>,
 *   spotifyContextHint: string,
 *   remoteSchedules: Array<{ id: string, nextRunAt: string, repeat?: string, createdBy?: string, label?: string }>,
 * }} slice
 */
export function buildLlmContextString(slice) {
  const parts = [];
  const now = new Date();
  parts.push(
    `Current date/time: ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
  );

  const wd = slice.weatherData;
  if (wd && typeof wd === "object" && wd.current && wd.daily) {
    const c = wd.current;
    const d = wd.daily;
    parts.push(
      `Weather: ${weatherCodeToDescription(c.weather_code)}, ${Math.round(c.temperature_2m)}\u00B0F (feels like ${Math.round(c.apparent_temperature)}\u00B0F). Humidity ${c.relative_humidity_2m}%, wind ${Math.round(c.wind_speed_10m)} mph. High ${Math.round(d.temperature_2m_max[0])}\u00B0F, Low ${Math.round(d.temperature_2m_min[0])}\u00B0F.`,
    );
  }

  const ctxEvents = slice.calendarContextEvents || [];
  if (ctxEvents.length) {
    const byDay = new Map();
    for (const ev of ctxEvents) {
      const key = eventContextDayKey(ev);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(ev);
    }
    for (const list of byDay.values()) {
      list.sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
    }
    const sortedDays = [...byDay.keys()].sort();
    const lines = [];
    lines.push(
      `Upcoming calendar events (today through the next ${CALENDAR_CONTEXT_HORIZON_DAYS} days, local dates):`,
    );
    for (const day of sortedDays) {
      lines.push(`${formatContextDayHeading(day)}:`);
      const list = byDay.get(day) || [];
      for (const ev of list) {
        let timeRange;
        if (ev.allDay) {
          timeRange = "All day";
        } else {
          const start = ev.start ? new Date(ev.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
          const end = ev.end ? new Date(ev.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
          timeRange = start + (end ? " to " + end : "");
        }
        lines.push(`- [id:${ev.id}] ${timeRange}: ${ev.summary || "(No title)"}`);
      }
    }
    parts.push(lines.join("\n"));
  } else {
    parts.push(
      `Calendar: No upcoming events through the next ${CALENDAR_CONTEXT_HORIZON_DAYS} days (from today, local time).`,
    );
  }

  if (slice.spotifyContextHint && String(slice.spotifyContextHint).trim()) {
    parts.push(String(slice.spotifyContextHint).trim());
  }

  const schedules = slice.remoteSchedules || [];
  if (schedules.length) {
    const lines = ["Upcoming scheduled items:"];
    for (const s of schedules) {
      const when = new Date(s.nextRunAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const repeatTag = s.repeat !== "once" ? ` (${s.repeat})` : "";
      const by = s.createdBy === "jarvis" ? " [by Jarvis]" : "";
      lines.push(`- [sched:${s.id}] ${when}${repeatTag}${by}: ${s.label || "(no label)"}`);
    }
    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n");
}
