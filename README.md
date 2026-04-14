# Rialo Race 8002

Rialo Race 8002 is the redesigned React/Vite frontend for the Rialo Race live market, replay, rankings, rewards, history, profile, and chat pages.

Live site: https://rialoracev1.vercel.app  
Repository: https://github.com/tenoli750/rialorace-8002

## What Is Included

- React/Vite app shell in `src/`
- Self-contained legacy Three.js race player in `public/legacy-race/`
- Actual racer images and 3D race assets in `public/assets/` and `public/legacy-race/assets/`
- Supabase-backed login, points, bets, rankings, rewards, bet history, ratio snapshots, and realtime chat
- Vercel rewrites for `.html` routes such as `/main-menu.html`, `/market02-betting.html`, and `/market-replay.html`

## Local Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev -- --host 127.0.0.1 --port 8002
```

Open:

```text
http://localhost:8002/main-menu.html
```

## Build

```bash
npm run build
```

Vite outputs the production build to `dist/`.

## Deployment

This project is deployed on Vercel as `rialoracev1`.

Important Vercel settings are stored in `vercel.json`:

- `buildCommand`: `npm run build`
- `outputDirectory`: `dist`
- SPA rewrites for app routes

Production URL:

```text
https://rialoracev1.vercel.app
```
