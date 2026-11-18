# PinHunter Dashboard — design

Date: 2026-11-18 · Status: approved by owner ("Local first", screens as proposed)

## Intent

The owner wants to run PinHunter like a regular app instead of editing `.env` and typing commands. That means one place to paste the keys, see what is connected, hunt for products, finish drafts, publish, and check the results. Open-source users get the same thing.

## Goals

- `pinhunter ui` starts a local web app and opens it in the browser.
- **Setup:** enter every key in a form and see a green or red check for each connection. Connect Pinterest with one button (OAuth, no terminal).
- **Overview:** counts by status (needs image, ready, posted, errors), a link to the Sheet, and quick actions.
- **Drafts:** a card per pin with title, description, board, link, why it was picked and the image brief. Paste an image link, preview it exactly as Pinterest will receive it, then mark it READY or SKIP.
- **Hunt:** run a hunt (or a dry run) and watch the live log. New drafts appear afterwards.
- **Publish:** post READY drafts (or a dry run) with a live log. The results link to the live pins.
- **Settings:** niches, keywords, sources, drafts per run, price range, niche→board mapping, disclosure, tone, language.
- Zero dependencies and no build step, like the rest of the project.

## Non-goals

- Hosting or multi-user access. The design keeps hosting behind a password possible later.
- Image generation and analytics.
- Replacing the Sheet. The Sheet stays the source of truth, and the dashboard reads and writes it.

## Anti-goals

- Secrets leaking to the browser. The API never returns a secret value, only "set" plus its last 4 characters.
- Another website on the same machine being able to drive the dashboard. Prevented by the 127.0.0.1 bind, a Host header check, and a random session token on every API call.
- `.env` injection. Only known keys are accepted, and values with line breaks are rejected (multi-line service-account JSON is stored as base64).

## Approaches considered

1. **Local Node server + vanilla single-page app (chosen).** It reuses the existing modules directly, has zero dependencies, and works for every open-source user.
2. Hosted on Hostinger. Reachable from a phone, but the keys would live on a server and it needs auth. Deferred by the owner.
3. A React/Vite front end. Nicer tooling, but it adds a build step and dependencies, which the project avoids.

## How it works

- `src/ui/server.js`: an `http` server on 127.0.0.1, port 8085 by default. That is the same port as the Pinterest redirect URI, so `/callback` finishes the OAuth inside the dashboard.
- Each API request rebuilds the context from a fresh read of `.env` plus `pinhunter.config.json`, so saved settings apply at once.
- Hunt and publish run as **jobs**: `POST /api/jobs` starts one (one at a time), and `GET /api/jobs/:id` returns its status, log lines and result. The page polls for them.
- `GET /api/image?url=` runs the same `loadImage` that publishing uses, so the preview proves the link will work.
- `doctor` is refactored into `runChecks(ctx) → [{name, ok, note}]`, which both the CLI and the UI use.
- Front end: `src/ui/public/` (index.html, app.js, app.css, icon.png), with hash routes, light and dark themes, and a phone-friendly layout.
