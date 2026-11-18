# PinHunter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A command-line tool that finds affiliate products, writes Pinterest pin drafts into a Google Sheet for a human to add images to, and publishes READY rows to Pinterest.

**Architecture:** Plain ES-module Node code with no build step. Every external service (AI, Sheets, Pinterest, sources, webhook) is a small factory that takes an injectable `fetch`, so tests run fully offline with fake fetches. `hunt` and `publish` are pure orchestration functions that receive those clients, and the CLI only wires them together.

**Tech Stack:** Node ≥ 22, `node:test`, built-in `fetch`/`crypto`/`http`. **Zero runtime dependencies.** Google service-account JWTs are signed with `node:crypto`, which supersedes the spec's `google-auth-library` so users never need `npm install`.

**Spec:** `docs/superpowers/specs/2026-11-18-pinhunter-design.md`

## Global Constraints

- Node ≥ 22; `"type": "module"`; no runtime dependencies.
- Pin title ≤ 100 chars, description ≤ 800 chars, alt text ≤ 500 chars.
- Every description ends with the disclosure (`prefs.disclosure`, default `#affiliate — I may earn a commission if you buy through this link.`). Truncation never cuts the disclosure.
- Default `draftsPerRun` 5, `maxPostsPerRun` 5.
- Statuses: `NEEDS_IMAGE`, `READY`, `POSTED`, `ERROR`, `SKIP`.
- Drafts tab columns, in order: `created_at, status, source, product_key, product, price, score, why_picked, affiliate_link, board, pin_title, pin_description, alt_text, image_brief, image_url, pin_url, error`.
- AI never invents products; it only ranks and describes products returned by a source.
- Secrets come from env only and are never written to the Sheet or logs.

## Review Focus

1. Image link is a Google Drive or Dropbox share page, not a direct image → convert to a direct download; a non-image response gives a clear ERROR in the row instead of a crash. (Task 5 test)
2. AI returns prose around the JSON, or broken JSON → extract the first JSON object, retry once, then skip that product without failing the run. (Task 1 test)
3. One source fails (bad key, network) → the other sources still run and the error is logged. (Task 3 test)
4. User types the board as a name ("Home Decor"), in a different case, or as an ID → resolves to the board ID; an unknown board gives a row ERROR listing the valid boards. (Task 5 test)
5. Status typed in lowercase or with spaces ("ready ") → treated as READY. (Task 4 test)

---

### Task 1: Config, HTTP and AI client

**Files:** `package.json`, `src/config.js`, `src/util/http.js`, `src/util/text.js`, `src/ai/client.js`, `src/ai/presets.js`, `test/ai.test.js`, `test/text.test.js`

**Produces:**
- `loadConfig({cwd, env}) -> {env, prefs}`: loads `.env` if present and merges `pinhunter.config.json` over `DEFAULT_PREFS`.
- `fetchJSON(fetchImpl, url, init) -> any`: throws `HttpError{status, body}` on a non-2xx response.
- `truncate(str, n)` and `withDisclosure(desc, disclosure, max=800)`.
- `extractJSON(text) -> any`
- `createAI({provider, apiKey, model, baseUrl}, fetchImpl) -> {chatJSON(system, user) -> object}`. Providers: openai, gemini, grok (xai), groq, openrouter, deepseek, ollama (`/chat/completions`), anthropic (`/v1/messages`, `anthropic-version: 2023-06-01`), and mock (deterministic, offline).

Tests:
- `extractJSON` handles fenced JSON and prose around it.
- `chatJSON` retries once on invalid JSON, then throws.
- The anthropic request uses `x-api-key` and openai-compatible requests use a Bearer token.
- `withDisclosure` keeps the disclosure when truncating to 800.

### Task 2: Products, scoring, keyword planning, pin writing

**Files:** `src/product.js`, `src/hunt/score.js`, `src/hunt/plan.js`, `src/hunt/write.js`, `test/score.test.js`, `test/write.test.js`

**Produces:**
- `productKey(p) = source + ':' + sourceId`
- `dataScore(p) -> 0..10`: the mean of the available parts.
  - sales: `min(10, 2.5*log10(1+salesVolume))`
  - rating: `rating*2*min(1, log10(1+reviewCount)/3)`
  - commission: `min(10, price*commissionRate)`, where commissionRate is a fraction
  - returns 5 when no part is available
- `finalScore = 0.6*data + 0.4*fit`
- `planKeywords(ai, prefs, date) -> string[]`: returns `prefs.keywords` plus the AI's keywords, up to `keywordsPerRun`.
- `rateFit(ai, products, prefs) -> Map<key,{fit, why}>`
- `writePin(ai, product, prefs, boardNames) -> {board, pin_title, pin_description, alt_text, image_brief}`: limits are enforced and the disclosure is appended.

Tests: score values for known inputs; `writePin` output respects every limit and ends with the disclosure.

### Task 3: Sources

**Files:** `src/sources/{index,aliexpress,amazon,feed,mock}.js`, `test/sources.test.js`

**Interfaces:**
- Each source is `{name, hunt(keywords, ctx) -> Promise<Product[]>}`.
- `getSources(names, {env, prefs, fetch, queue}) -> Source[]`. Sources missing credentials are skipped with a warning.
- `huntAll(sources, keywords, ctx) -> {products, errors}`

Source details:
- **aliexpress:** `https://api-sg.aliexpress.com/sync`, method `aliexpress.affiliate.product.query`. Params: `app_key, timestamp(ms), sign_method=sha256, keywords, page_size=20, sort=LAST_VOLUME_DESC, target_currency, target_language, tracking_id, ship_to_country`. Sign is uppercase hex of `HMAC-SHA256(secret, sorted key+value concat)`. Products are at `aliexpress_affiliate_product_query_response.resp_result.result.products.product`.
- **amazon:** token per credential version (2.x Cognito with Basic auth and form body; 3.x LwA with JSON body). Calls `POST https://creatorsapi.amazon/catalog/v1/searchItems` with headers `Authorization: Bearer <t>[, Version <v>]` and `x-marketplace`. The body is camelCase. Items are at `searchResult.items`. Labeled beta.
- **feed:** reads the `Products` tab (`affiliate_link, title, price, currency, notes`) through `queue.readProducts()`.
- **mock:** 8 fixed products.

Tests:
- The AliExpress signature matches a fixed vector.
- AliExpress response parsing produces a normalized Product.
- Amazon parsing works on a sample item.
- `huntAll` continues when one source throws.

### Task 4: Google Sheet queue and webhook

**Files:** `src/sheets/auth.js`, `src/sheets/queue.js`, `src/notify.js`, `test/queue.test.js`

**Produces:**
- `getGoogleToken(serviceAccount, fetchImpl) -> string`: RS256 JWT through `node:crypto`, exchanged at `https://oauth2.googleapis.com/token`.
- `createSheetQueue({sheetId, serviceAccount}, fetchImpl)`, which provides:
  - `ensure()`: creates the Drafts and Products tabs with headers and a status dropdown.
  - `readDrafts() -> Draft[]` (each with `row`), `appendDrafts(drafts)`, `updateDraft(row, fields)`, `readProducts()`.
- `createMemoryQueue()` for tests and dry runs.
- `normStatus(s)`
- `notify(url, text, fetchImpl)`: sends Discord's `content` and Slack's `text` fields.

Tests: row↔draft round trip; `normStatus(' ready ') === 'READY'`; the JWT has three parts and a valid RS256 signature.

### Task 5: Pinterest client, image fetch, publish, hunt orchestration

**Files:** `src/pinterest/{client,auth,image}.js`, `src/publish.js`, `src/hunt/index.js`, `test/publish.test.js`, `test/hunt.test.js`

**Produces:**
- `createPinterest({accessToken, refreshToken, clientId, clientSecret, sandbox}, fetchImpl)`, which provides:
  - `refresh()`, `listBoards() -> [{id,name}]` (paginated), `createPin({board_id,title,description,link,alt_text,image}) -> {id,url}`
- `directImageUrl(url)`: handles Drive and Dropbox links.
- `loadImage(urlOrPath, fetchImpl) -> {contentType, base64}`: JPEG/PNG only, at most 20 MB.
- `runPublish({queue, pinterest, prefs, fetch, log, dryRun, sleep}) -> {posted, failed}`
- `runHunt({ai, sources, queue, prefs, boards, notifyUrl, fetch, log, dryRun, now}) -> {drafts}`

Tests:
- `publish` posts READY rows only and writes back POSTED and the pin URL.
- Board name matching ignores case.
- An unknown board produces ERROR.
- Drive links are converted.
- A non-image response produces ERROR.
- `hunt` with the mock AI and mock source appends 5 NEEDS_IMAGE drafts, skips existing keys, and never appends during a dry run.

### Task 6: CLI, OAuth, doctor, docs, workflow

**Files:** `bin/pinhunter.js`, `src/cli/*.js`, `.env.example`, `pinhunter.config.example.json`, `.github/workflows/pinhunter.yml`, `README.md`, `LICENSE` (MIT), `.gitignore`

Commands:
- `init`: copies the example files.
- `auth`: local OAuth on `http://localhost:8085/callback`; saves `PINTEREST_REFRESH_TOKEN` to `.env`.
- `boards`
- `hunt [--dry-run]`
- `publish [--dry-run]`
- `doctor`
- `demo`: mock AI, mock source and memory queue, with no accounts needed.

Verification: `npm test` passes, and `node bin/pinhunter.js demo` prints 5 drafts and then a simulated publish.
