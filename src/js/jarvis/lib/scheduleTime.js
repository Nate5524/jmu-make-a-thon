export function wallClockToUtcIso(dateStr, timeStr, timezone) {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const utcFmt = guess.toLocaleString("en-US", { timeZone: "UTC" });
  const tzFmt = guess.toLocaleString("en-US", { timeZone: timezone });
  return new Date(guess.getTime() - (new Date(tzFmt).getTime() - new Date(utcFmt).getTime())).toISOString();
}

export function clientTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}
