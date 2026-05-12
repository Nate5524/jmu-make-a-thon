import {
  apiCreateCalendarEvent,
  apiDeleteCalendarEvent,
  apiPatchCalendarEvent,
} from "./calendarApi.js";
import { normalizeSmartHomeClient } from "./normalizeSmartHome.js";
import { clientTimezone, wallClockToUtcIso } from "./scheduleTime.js";

export function trackLabelFromSpotifyItem(t) {
  if (!t || !t.name) return "";
  const artists = (t.artists || []).map((a) => a.name).join(", ");
  return artists ? `${t.name} — ${artists}` : String(t.name);
}

function spotifyDevQuery(webDeviceId) {
  return webDeviceId ? "?device_id=" + encodeURIComponent(webDeviceId) : "";
}

/**
 * @param {{
 *   getState: () => { spotifyConfigured: boolean, spotifyWebDeviceId: string | null },
 *   dispatch: (a: unknown) => void,
 *   refetchCalendar: () => Promise<void>,
 *   applySmartHomeFromResponse: (devices: unknown[], revision?: number | null) => void,
 *   setLastRevision: (rev: number) => void,
 *   refreshSpotifyPlayer: () => Promise<void>,
 *   appendSchedule: (s: unknown) => void,
 *   removeSchedule: (id: string) => void,
 * }} ctx
 */
export function createJarvisToolDispatch(ctx) {
  async function executeJarvisAction(action) {
    switch (action.type) {
      case "delete_event": {
        if (typeof action.id !== "string" || !action.id.trim()) {
          throw new Error("delete_event requires an id.");
        }
        await apiDeleteCalendarEvent(action.id);
        await ctx.refetchCalendar();
        return;
      }
      case "edit_event": {
        if (typeof action.id !== "string" || !action.id.trim()) {
          throw new Error("edit_event requires an id.");
        }
        const patch = {};
        if (action.summary !== undefined) patch.summary = action.summary;
        if (action.description !== undefined) patch.description = action.description;
        if (action.allDay) {
          if (typeof action.date !== "string" || !action.date.trim()) {
            throw new Error("All-day edit_event requires a date.");
          }
          patch.allDay = true;
          patch.startDate = action.date;
          if (action.endDate !== undefined) patch.endDate = action.endDate;
        } else {
          const hasTimedFields =
            action.date !== undefined || action.startTime !== undefined || action.endTime !== undefined;
          if (hasTimedFields) {
            if (
              typeof action.date !== "string" ||
              typeof action.startTime !== "string" ||
              typeof action.endTime !== "string"
            ) {
              throw new Error("Timed edit_event requires date, startTime, and endTime.");
            }
            patch.start = `${action.date}T${action.startTime}:00`;
            patch.end = `${action.date}T${action.endTime}:00`;
          }
        }
        await apiPatchCalendarEvent(action.id, patch);
        await ctx.refetchCalendar();
        return;
      }
      case "create_event": {
        if (typeof action.summary !== "string" || !action.summary.trim()) {
          throw new Error("create_event requires a summary.");
        }
        if (typeof action.date !== "string" || !action.date.trim()) {
          throw new Error("create_event requires a date.");
        }
        if (action.allDay) {
          const body = { summary: action.summary, description: action.description };
          body.allDay = true;
          body.startDate = action.date;
          if (action.endDate && !String(action.endDate).includes("T")) body.endDate = action.endDate;
          await apiCreateCalendarEvent(body);
          await ctx.refetchCalendar();
          return;
        }
        if (typeof action.startTime !== "string" || typeof action.endTime !== "string") {
          throw new Error("Timed create_event requires startTime and endTime.");
        }
        const startISO = `${action.date}T${action.startTime}:00`;
        const endISO = `${action.date}T${action.endTime}:00`;
        await apiCreateCalendarEvent({
          summary: action.summary,
          description: action.description,
          start: startISO,
          end: endISO,
        });
        await ctx.refetchCalendar();
        return;
      }
      default:
        console.warn("Unknown Jarvis action type:", action);
    }
  }

  async function spotifySearchFirstTrack(query) {
    const st = ctx.getState();
    if (!st.spotifyConfigured) throw new Error("Spotify is not configured on the server.");
    const q = (query == null ? "" : String(query)).trim();
    if (!q) throw new Error("Search query is empty.");
    const r = await fetch("/api/spotify/search?q=" + encodeURIComponent(q));
    if (r.status === 503) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "Spotify is not configured.");
    }
    if (!r.ok) throw new Error("Track search failed.");
    const data = await r.json();
    const items = (data.tracks && data.tracks.items) || [];
    if (!items.length) throw new Error("No tracks matched that search.");
    return items[0];
  }

  async function spotifyPlayUriStrict(uri) {
    const st = ctx.getState();
    const dq = spotifyDevQuery(st.spotifyWebDeviceId);
    const r = await fetch("/api/spotify/player/play" + dq, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [uri] }),
    });
    if (r.status !== 204 && !r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "Could not start that track.");
    }
    await ctx.refreshSpotifyPlayer();
  }

  async function spotifyQueueUriStrict(uri) {
    const st = ctx.getState();
    const q = st.spotifyWebDeviceId ? "?device_id=" + encodeURIComponent(st.spotifyWebDeviceId) : "";
    const r = await fetch("/api/spotify/player/queue" + q, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri }),
    });
    if (r.status !== 204 && !r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "Could not add to queue (active Spotify device required).");
    }
    await ctx.refreshSpotifyPlayer();
  }

  async function spotifyResumePlayback() {
    const st = ctx.getState();
    if (!st.spotifyConfigured) throw new Error("Spotify is not configured on the server.");
    const dq = spotifyDevQuery(st.spotifyWebDeviceId);
    const r = await fetch("/api/spotify/player/play" + dq, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (r.status !== 204 && !r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "Could not start playback — open Spotify on a device or use Play in this browser.");
    }
    await ctx.refreshSpotifyPlayer();
  }

  async function spotifyPausePlayback() {
    const st = ctx.getState();
    if (!st.spotifyConfigured) throw new Error("Spotify is not configured on the server.");
    const dq = spotifyDevQuery(st.spotifyWebDeviceId);
    const r = await fetch("/api/spotify/player/pause" + dq, { method: "PUT" });
    if (r.status !== 204 && !r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "Could not pause playback.");
    }
    await ctx.refreshSpotifyPlayer();
  }

  async function spotifySkipNextStrict() {
    const st = ctx.getState();
    if (!st.spotifyConfigured) throw new Error("Spotify is not configured on the server.");
    const r = await fetch("/api/spotify/player/next" + spotifyDevQuery(st.spotifyWebDeviceId), { method: "POST" });
    if (r.status !== 204 && !r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "Could not skip to next track.");
    }
    await ctx.refreshSpotifyPlayer();
  }

  async function spotifySkipPreviousStrict() {
    const st = ctx.getState();
    if (!st.spotifyConfigured) throw new Error("Spotify is not configured on the server.");
    const r = await fetch("/api/spotify/player/previous" + spotifyDevQuery(st.spotifyWebDeviceId), {
      method: "POST",
    });
    if (r.status !== 204 && !r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "Could not go to previous track.");
    }
    await ctx.refreshSpotifyPlayer();
  }

  return async function dispatchJarvisTool(name, args) {
    if (!args || typeof args !== "object") {
      throw new Error("Tool arguments must be an object.");
    }
    switch (name) {
      case "create_calendar_event":
        await executeJarvisAction({
          type: "create_event",
          summary: args.summary,
          date: args.date,
          allDay: args.allDay,
          endDate: args.endDate,
          startTime: args.startTime,
          endTime: args.endTime,
          description: args.description,
        });
        return { ok: true };
      case "delete_calendar_event":
        await executeJarvisAction({ type: "delete_event", id: args.id });
        return { ok: true };
      case "edit_calendar_event":
        await executeJarvisAction({
          type: "edit_event",
          id: args.id,
          summary: args.summary,
          description: args.description,
          allDay: args.allDay,
          date: args.date,
          endDate: args.endDate,
          startTime: args.startTime,
          endTime: args.endTime,
        });
        return { ok: true };
      case "set_demo_smart_home_device": {
        const dev = args.device;
        const on = args.on;
        if (dev !== "ambient" && dev !== "blinds") {
          throw new Error("device must be ambient or blinds.");
        }
        if (typeof on !== "boolean") {
          throw new Error("on must be a boolean.");
        }
        const r = await fetch("/api/smart-home/set", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: dev, on }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(data.error || "Smart home update failed.");
        }
        if (data.smartHome && Array.isArray(data.smartHome.devices)) {
          ctx.applySmartHomeFromResponse(data.smartHome.devices, data.revision);
        }
        return { ok: true, device: dev, on };
      }
      case "get_demo_smart_home_lights_state": {
        const r = await fetch("/api/state");
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(data.error || "Could not read smart home state.");
        }
        if (data.smartHome && Array.isArray(data.smartHome.devices)) {
          ctx.applySmartHomeFromResponse(data.smartHome.devices, data.revision);
        }
        const rev = Number(data.revision);
        if (Number.isFinite(rev)) ctx.setLastRevision(rev);
        const norm = normalizeSmartHomeClient(data.smartHome?.devices);
        const ambient = norm.devices.find((d) => String(d.id).toLowerCase() === "ambient");
        const on = ambient ? !!ambient.on : false;
        return {
          ok: true,
          device: "ambient",
          on,
          note: "Authoritative lights state shared with the GUI sidebar.",
        };
      }
      case "toggle_demo_smart_home_lights": {
        const r = await fetch("/api/smart-home/toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "ambient" }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(data.error || "Lights toggle failed.");
        }
        if (data.smartHome && Array.isArray(data.smartHome.devices)) {
          ctx.applySmartHomeFromResponse(data.smartHome.devices, data.revision);
        }
        const rev = Number(data.revision);
        if (Number.isFinite(rev)) ctx.setLastRevision(rev);
        const norm2 = normalizeSmartHomeClient(data.smartHome?.devices);
        const ambient2 = norm2.devices.find((d) => String(d.id).toLowerCase() === "ambient");
        const on2 = ambient2 ? !!ambient2.on : false;
        return { ok: true, device: "ambient", on: on2 };
      }
      case "open_demo_smart_home_blinds": {
        const r = await fetch("/api/smart-home/blinds/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(data.error || "Blinds open failed.");
        }
        if (data.smartHome && Array.isArray(data.smartHome.devices)) {
          ctx.applySmartHomeFromResponse(data.smartHome.devices, data.revision);
        }
        const rev = Number(data.revision);
        if (Number.isFinite(rev)) ctx.setLastRevision(rev);
        return { ok: true, action: "open_blinds", note: "Open webhook sent (always)." };
      }
      case "close_demo_smart_home_blinds": {
        const r = await fetch("/api/smart-home/blinds/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(data.error || "Blinds close failed.");
        }
        if (data.smartHome && Array.isArray(data.smartHome.devices)) {
          ctx.applySmartHomeFromResponse(data.smartHome.devices, data.revision);
        }
        const rev = Number(data.revision);
        if (Number.isFinite(rev)) ctx.setLastRevision(rev);
        return { ok: true, action: "close_blinds", note: "Close webhook sent (always)." };
      }
      case "spotify_play":
        await spotifyResumePlayback();
        return { ok: true, action: "play" };
      case "spotify_pause":
        await spotifyPausePlayback();
        return { ok: true, action: "pause" };
      case "spotify_skip_next":
        await spotifySkipNextStrict();
        return { ok: true, action: "next" };
      case "spotify_skip_previous":
        await spotifySkipPreviousStrict();
        return { ok: true, action: "previous" };
      case "spotify_play_track": {
        const t = await spotifySearchFirstTrack(args.query);
        await spotifyPlayUriStrict(t.uri);
        const label = trackLabelFromSpotifyItem(t);
        return { ok: true, action: "play_track", track: label };
      }
      case "spotify_queue_track": {
        const t = await spotifySearchFirstTrack(args.query);
        await spotifyQueueUriStrict(t.uri);
        const label = trackLabelFromSpotifyItem(t);
        return { ok: true, action: "queue_track", track: label };
      }
      case "create_schedule": {
        const tz = clientTimezone();
        let nextRunAt;
        if (typeof args.delayMinutes === "number" && args.delayMinutes > 0) {
          nextRunAt = new Date(Date.now() + args.delayMinutes * 60000).toISOString();
        } else if (args.date && args.time) {
          nextRunAt = wallClockToUtcIso(args.date, args.time, tz);
        } else {
          throw new Error("Provide date+time or delayMinutes");
        }
        const body = {
          mode: args.mode || "static",
          label: args.label || "",
          nextRunAt,
          timezone: tz,
          repeat: args.repeat || "once",
          wallClockTime: args.time
            ? args.time.slice(0, 5)
            : new Date(nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
          createdBy: "jarvis",
          speak: args.speak !== false,
        };
        if (args.repeat === "weekly" && typeof args.weekday === "number") body.weekday = args.weekday;
        if (args.mode === "static") {
          body.storedAssistantText = args.storedAssistantText || args.label;
        } else {
          body.storedInstruction = args.storedInstruction || args.label;
          if (Array.isArray(args.toolSteps)) body.toolSteps = args.toolSteps;
        }
        const r = await fetch("/api/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to create schedule");
        if (data.schedule) ctx.appendSchedule(data.schedule);
        return { ok: true, id: data.schedule?.id, nextRunAt: data.schedule?.nextRunAt };
      }
      case "cancel_schedule": {
        const r = await fetch(`/api/schedules/${encodeURIComponent(args.id)}`, { method: "DELETE" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Schedule not found");
        ctx.removeSchedule(args.id);
        return { ok: true };
      }
      default:
        throw new Error("Unknown tool: " + name);
    }
  };
}
