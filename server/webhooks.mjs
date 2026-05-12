import { execFile } from "node:child_process";

/** Wrap for POSIX `sh` single-quoted remote argv so webhook URLs cannot break out of `curl`. */
function shSingleQuoted(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const LIGHTS_WEBHOOK_URL = process.env.LIGHTS_WEBHOOK_URL || "";
const LIGHTS_SSH_HOST = process.env.LIGHTS_SSH_HOST || "";
const BLINDS_SSH_HOST = process.env.BLINDS_SSH_HOST || "";
const BLINDS_OPEN_WEBHOOK_URL = process.env.BLINDS_OPEN_WEBHOOK_URL || "";
const BLINDS_CLOSE_WEBHOOK_URL = process.env.BLINDS_CLOSE_WEBHOOK_URL || "";
/** SSH jump host for blinds webhooks: explicit blinds host, else lights host (same-HA-box setups). */
const BLINDS_WEBHOOK_SSH_HOST = BLINDS_SSH_HOST || LIGHTS_SSH_HOST;

/**
 * Fire the HA webhook that toggles the physical lights.
 * If LIGHTS_SSH_HOST is set, SSH into that host and curl from there (needed when
 * HA only responds to localhost). Otherwise, POST directly via fetch.
 */
export async function postLightsWebhook() {
  if (!LIGHTS_WEBHOOK_URL) return;
  if (LIGHTS_SSH_HOST) {
    return new Promise((resolve, reject) => {
      execFile(
        "ssh",
        [
          "-o",
          "StrictHostKeyChecking=accept-new",
          "-o",
          "ConnectTimeout=5",
          LIGHTS_SSH_HOST,
          `curl -sf -X POST ${shSingleQuoted(LIGHTS_WEBHOOK_URL)}`,
        ],
        { timeout: 10000 },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr.trim() || err.message));
          else resolve();
        },
      );
    });
  }
  const r = await fetch(LIGHTS_WEBHOOK_URL, { method: "POST", signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Lights webhook returned ${r.status}`);
}

/**
 * Fire the HA webhook that opens or closes the physical blinds.
 * Uses `BLINDS_SSH_HOST` for SSH jump if set; otherwise `LIGHTS_SSH_HOST` when the same host reaches HA.
 * @param {boolean} open - true = open/raise, false = close/lower
 */
export async function postBlindsWebhook(open) {
  const url = open ? BLINDS_OPEN_WEBHOOK_URL : BLINDS_CLOSE_WEBHOOK_URL;
  if (!url) return;
  if (BLINDS_WEBHOOK_SSH_HOST) {
    return new Promise((resolve, reject) => {
      execFile(
        "ssh",
        [
          "-o",
          "StrictHostKeyChecking=accept-new",
          "-o",
          "ConnectTimeout=5",
          BLINDS_WEBHOOK_SSH_HOST,
          `curl -sf -X POST ${shSingleQuoted(url)}`,
        ],
        { timeout: 10000 },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr.trim() || err.message));
          else resolve();
        },
      );
    });
  }
  const r = await fetch(url, { method: "POST", signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Blinds webhook returned ${r.status}`);
}
