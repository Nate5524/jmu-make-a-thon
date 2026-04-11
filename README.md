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

Then open [http://localhost:3000/](http://localhost:3000/) (or the port in your `.env`). Jarvis lives at `/jarvis.html`; judges can edit shared demo state at `/admin.html` (**Demo controls**).

**Production-style** (build static assets, then run the server):

```bash
npm run build
npm start
```

## Environment

Copy [`.env.example`](.env.example) to `.env` and adjust as needed.

| Variable        | Purpose |
|----------------|---------|
| `PORT`         | HTTP port (default `3000`). |
| `ADMIN_SECRET` | Required for **writes** to `PUT /api/state` in production. In development, if unset, the server uses a default (`dev-demo-secret`) and logs a reminder. |

**Do not commit `.env`** (it is gitignored).

## Demo state API

In-memory state is shared by every browser connected to the **same server process** (good for two devs or a judge phone + presentation laptop on the same URL).

- `GET /api/state` — read feed text and smart-home demo toggles.
- `PUT /api/state` — update state; send header `Authorization: Bearer <ADMIN_SECRET>`.

Jarvis polls `GET /api/state` about every two seconds and merges the feed into its system prompt.

## Google Calendar (optional)

If you configure OAuth in [`jarvis.html`](jarvis.html), add your app’s **JavaScript origins** in Google Cloud Console to match how you run the app (for example `http://localhost:3000` and your deployed HTTPS origin), not the old Vite-only port.

## Deploy

On a host (Railway, Render, Fly, a VPS, etc.):

1. Set `ADMIN_SECRET` (and `PORT` if the platform does not inject it).
2. Run `npm run build` then `npm start` (or equivalent start command).

The server listens on `0.0.0.0` so it is reachable on a LAN IP for demos when firewall rules allow.
