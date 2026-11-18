# PinHunter Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `pinhunter ui`, a local web app for setup, drafts, hunting, publishing and settings.

**Architecture:** Shared actions (`runChecks`, `doHunt`, `doPublish`) used by both the CLI and the UI. A zero-dependency `http` server with a token-protected JSON API and job runner. A vanilla JS single-page app served from `src/ui/public`.

**Spec:** `docs/superpowers/specs/2026-11-18-pinhunter-dashboard-design.md`

## Global Constraints
- Node ≥ 22, no dependencies, no build step.
- Server binds 127.0.0.1. API requires header `x-pinhunter-token`. Host must be `localhost:<port>` or `127.0.0.1:<port>`.
- Secrets are never sent to the browser: `{set, hint: '…last4'}` only.
- `.env` writes accept only keys in `ENV_FIELDS`. Values with `\r`/`\n` are rejected, except `GOOGLE_SERVICE_ACCOUNT_JSON`, which is stored as base64.
- Draft PATCH accepts only `status, image_url, board, pin_title, pin_description, alt_text`. Status must be one of the STATUSES.

## Review Focus
1. A hunt or publish already running → second start returns 409, not a parallel run.
2. Saving an empty secret field → keeps the existing value (it doesn't wipe the key).
3. Malformed JSON body or unknown route → 400/404 JSON, server keeps running.
4. Pinterest callback with wrong/missing state → 400, nothing saved.
5. Image preview of a web page (not an image) → clear error text shown on the card.

### Task 1: Shared actions
Files: `src/actions.js`, `src/cli/commands.js`, `src/cli/context.js`, `test/actions.test.js`
- `runChecks(ctx) -> [{name, ok, note}]`. `doctor` prints them.
- `doHunt(ctx, {dryRun}) -> {drafts, keywords, errors}` and `doPublish(ctx, {dryRun}) -> {posted, failed, waiting}`.
- `buildContext({cwd, log, env})` passes `env` through to `loadConfig`.
- Tests: runChecks reports a missing AI provider as `ok:false`, and a mock-provider AI as ok. doHunt with mock AI and mock source on a memory queue appends 5 drafts.

### Task 2: UI server
Files: `src/ui/fields.js`, `src/ui/server.js`, `test/ui.test.js`
- `createUiServer({cwd, token, port, makeContext?}) -> http.Server`.
- Routes:
  - `/api/overview`
  - `/api/settings` (GET, PUT)
  - `/api/checks`
  - `/api/drafts` (GET), `/api/drafts/:row` (PATCH)
  - `/api/jobs` (POST), `/api/jobs/:id` (GET)
  - `/api/boards`
  - `/api/image`
  - `/api/pinterest/connect`
  - `/callback`
  - static files
- Tests:
  - 401 without token.
  - 403 for a foreign Host.
  - Settings masks secrets, rejects unknown keys and newlines, and keeps a secret when its field is sent empty. Prefs are saved to the config file.
  - Drafts PATCH whitelist and status validation.
  - Hunt job (mock) completes with its log. A second concurrent job gets 409.
  - Callback with bad state returns 400.

### Task 3: Front end
Files: `src/ui/public/{index.html,app.js,app.css,icon.png}`
- Views: Overview, Drafts, Hunt, Publish, Setup, Settings.
- Check in the browser at desktop and phone width, in light and dark.

### Task 4: CLI + docs
- `pinhunter ui [--port N] [--no-open]` and `npm run ui`.
- README section "Use the dashboard".
- Full `npm test`, commit, push.
