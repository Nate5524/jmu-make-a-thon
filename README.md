# jmu-make-a-thon

Repository of code created by team sleepyheads for the 2026 JMU Make-A-Thon.

## Prerequisites

- [Node.js](https://nodejs.org/) (current LTS is fine)

## Install

```bash
npm install
```

## Run locally

The app is served by a single Node server ([`server.mjs`](server.mjs)) so development and production use the same API and static hosting behavior.

**Development** (Vite dev middleware + shared demo state API):

```bash
npm run dev
```

Then open [http://localhost:3000/](http://localhost:3000/) (or the port in your `.env`). Jarvis is at [`./jarvis.html`](./jarvis.html) relative to that origin (e.g. `http://localhost:3000/jarvis.html`).

### HTTPS via ngrok (required for microphone)

Browser microphone/camera APIs require a **secure context** (HTTPS or `localhost`). If you need mic access from a non-localhost origin (e.g. a phone on the same network), use ngrok to create an HTTPS tunnel:

1. Sign up for a free account at <https://dashboard.ngrok.com/signup>
2. Copy your authtoken from <https://dashboard.ngrok.com/get-started/your-authtoken>
3. Run:
   ```bash
   npx ngrok config add-authtoken YOUR_TOKEN_HERE
   ```
4. In a **second terminal** (keep `npm run dev` running in the first):
   ```bash
   npm run tunnel
   ```
5. ngrok will print an HTTPS URL like `https://xxxx.ngrok-free.app` -- use that to access the app.

**Production-style** (build static assets, then run the server):

```bash
npm run build
npm start
```

## Jarvis personality (code only)

Extra instructions merged into Jarvis's system prompt are **not** editable from any web UI.

- Edit the default string **`DEFAULT_JARVIS_PERSONALITY`** in [`server.mjs`](server.mjs), **or**
- Set **`JARVIS_PERSONALITY`** in `.env` (supports a long single-line or multiline value depending on your shell).

Restart the server after changes.

## Internal dev page (`admin.html`)

[`admin.html`](admin.html) is for **developers only**: seed smart-home device on/off defaults via `PUT /api/state` with `ADMIN_SECRET`. It is **not** linked from the product. In **production**, `admin.html` is **not served** unless you set **`ENABLE_ADMIN_UI=true`** in the environment.

## Environment

Copy [`.env.example`](.env.example) to `.env` and adjust as needed.

| Variable            | Purpose |
|---------------------|---------|
| `PORT`              | HTTP port (default `3000`). |
| `ADMIN_SECRET`      | Required for **writes** to `PUT /api/state` in production. In development, if unset, the server uses a default (`dev-demo-secret`) and logs a reminder. |
| `JARVIS_PERSONALITY` | Optional. Overrides the in-code default extra Jarvis instructions. |
| `ENABLE_ADMIN_UI`   | In **production** only: set to `true` to allow serving `./admin.html`. |
| `GOOGLE_CALENDAR_ID` | The Google Calendar ID to read/write events. Found in Calendar Settings > Integrate calendar. |
| `CALENDAR_SERVICE_ACCOUNT` | The service account email (informational; the actual auth uses the key file). |

**Do not commit `.env`** (it is gitignored).

## Demo state API

In-memory state is shared by every browser connected to the **same server process**.

- `GET ./api/state` -- read feed (personality from server config) and smart-home demo state.
- `PUT ./api/state` -- update smart-home seed only; header `Authorization: Bearer <ADMIN_SECRET>`.
- `POST ./api/smart-home/toggle` -- body `{ "id": "blinds" | "ambient" }`; flips that device (no admin secret).
- `POST ./api/smart-home/set` -- body `{ "id": "blinds" | "ambient", "on": true | false }`; sets that device explicitly (no admin secret).

Jarvis polls `GET ./api/state` about every two seconds and merges `feed.personality` from the server into its system prompt.

## Google Calendar

Calendar integration is handled **server-side** via a Google Cloud service account -- no user-facing OAuth flow required.

**Setup (only needs to be done once and already done - see the google doc for information on private keys):**

1. In [Google Cloud Console](https://console.cloud.google.com/), enable the **Google Calendar API** for your project.
2. Create a **service account** and download its JSON key file. Place it in the project root as `jmu-make-a-thon-97645ef3d37e.json` (this file is gitignored).
3. In Google Calendar, **share** the target calendar with the service account email (give it "Make changes to events" permission).
4. Set `GOOGLE_CALENDAR_ID` in `.env` to the calendar's ID (found in Calendar Settings > Integrate calendar).

**Endpoints:**

- `GET /api/calendar/events` -- returns today's events from the shared calendar.
- `POST /api/calendar/events` -- creates an event. Body: `{ "summary": "...", "start": "YYYY-MM-DDTHH:MM:00", "end": "YYYY-MM-DDTHH:MM:00" }`.

Jarvis can also create events via natural language (e.g. "add a meeting today from 2-3").

## Deploy

On a host (including your device):

1. Set `ADMIN_SECRET` (and `PORT` if the platform does not inject it).
2. Set `JARVIS_PERSONALITY` if you want custom Jarvis instructions without redeploying code changes to `server.mjs`.
3. Optionally set `ENABLE_ADMIN_UI=true` if you need `./admin.html` in production.
4. Place the service account key file (`jmu-make-a-thon-97645ef3d37e.json`) on the host and set `GOOGLE_CALENDAR_ID`.
5. Run `npm run build` then `npm start` (or equivalent start command).

The server listens on `0.0.0.0` so it is reachable on a LAN IP for demos when firewall rules allow.
