import path from "path";
import { readFileSync } from "fs";
import { google } from "googleapis";
import { projectRoot } from "../config.mjs";

export const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "";

/** Absolute path, or path relative to repo root. */
function resolveKeyFilePath() {
  const raw = (process.env.GOOGLE_CALENDAR_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? raw : path.join(projectRoot, raw);
}

const SERVICE_ACCOUNT_PATH = resolveKeyFilePath();

/** @type {ReturnType<typeof google.calendar> | null} */
export let calendarClient = null;

try {
  if (!SERVICE_ACCOUNT_PATH) {
    throw new Error("Set GOOGLE_CALENDAR_KEY_FILE (or GOOGLE_APPLICATION_CREDENTIALS) to your service account JSON path.");
  }
  const creds = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"));
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  calendarClient = google.calendar({ version: "v3", auth });
  console.log("[calendar] Service account loaded:", creds.client_email);
} catch (err) {
  console.warn(
    "[calendar] Could not load service account key — calendar endpoints disabled.",
    err.message,
  );
}
