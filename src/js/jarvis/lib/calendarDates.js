export function localIsoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function calendarDayBoundsIso(ymd) {
  const parts = String(ymd).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error("Invalid date");
  }
  const [y, mo, d] = parts;
  const timeMin = new Date(y, mo - 1, d, 0, 0, 0, 0);
  const timeMax = new Date(y, mo - 1, d + 1, 0, 0, 0, 0);
  return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() };
}

export function eventContextDayKey(ev) {
  if (!ev || !ev.start) return localIsoDate();
  if (ev.allDay) return String(ev.start).slice(0, 10);
  return localIsoDate(new Date(ev.start));
}

export function formatContextDayHeading(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
