export async function apiCreateCalendarEvent(body) {
  const resp = await fetch("/api/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create event");
  }
  return resp.json();
}

export async function apiDeleteCalendarEvent(eventId) {
  const resp = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete event");
  }
}

export async function apiPatchCalendarEvent(eventId, fields) {
  const resp = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update event");
  }
}

export async function apiFetchCalendarRange(timeMin, timeMax) {
  const qs = new URLSearchParams({ timeMin, timeMax });
  const resp = await fetch("/api/calendar/events?" + qs.toString());
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.events || [];
}
