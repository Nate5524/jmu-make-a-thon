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

**Production-style** (build static assets, then run the server):

```bash
npm run build
npm start
```

## Jarvis personality (code only)

Extra instructions merged into Jarvis’s system prompt are **not** editable from any web UI.

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

**Do not commit `.env`** (it is gitignored).

## Demo state API

In-memory state is shared by every browser connected to the **same server process**.

- `GET ./api/state` — read feed (personality from server config) and smart-home demo state.
- `PUT ./api/state` — update smart-home seed only; header `Authorization: Bearer <ADMIN_SECRET>`.
- `POST ./api/smart-home/toggle` — body `{ "id": "blinds" | "ambient" }`; flips that device (no admin secret).
- `POST ./api/smart-home/set` — body `{ "id": "blinds" | "ambient", "on": true | false }`; sets that device explicitly (no admin secret).

Jarvis polls `GET ./api/state` about every two seconds and merges `feed.personality` from the server into its system prompt.

## Google Calendar (optional)

If you configure OAuth in [`jarvis.html`](jarvis.html), add your app’s **JavaScript origins** in Google Cloud Console to match how you run the app (for example `http://localhost:3000` and your deployed HTTPS origin).

## Deploy

On a host (Railway, Render, Fly, a VPS, etc.):

1. Set `ADMIN_SECRET` (and `PORT` if the platform does not inject it).
2. Set `JARVIS_PERSONALITY` if you want custom Jarvis instructions without redeploying code changes to `server.mjs`.
3. Optionally set `ENABLE_ADMIN_UI=true` if you need `./admin.html` in production.
4. Run `npm run build` then `npm start` (or equivalent start command).

The server listens on `0.0.0.0` so it is reachable on a LAN IP for demos when firewall rules allow.
