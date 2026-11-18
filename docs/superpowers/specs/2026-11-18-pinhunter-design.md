# PinHunter — design

Date: 2026-11-18 · Status: awaiting owner approval

## Intent

Affiliate marketers on Pinterest spend most of their time on the boring part: finding products worth promoting and writing pin copy for them. PinHunter does that part automatically and leaves the one creative step, the picture, to a human.

It hunts affiliate products with strong sales potential and writes a complete pin draft for each one: title, description, affiliate link, board, alt text and a brief for the image. Each draft becomes a row in a Google Sheet marked "needs image". The owner makes the picture, pastes its link into the row and sets the row to READY. PinHunter then posts the pin to Pinterest.

The owner (THS) uses it first. It is also released as an open-source GitHub project, so anyone can plug in their own AI provider (Gemini, Grok, OpenAI, Claude, a local model…) and their own affiliate and Pinterest accounts.

## Goals

- Hunt products from several affiliate sources, each a plug-in, and keep only the best candidates.
- Use the AI the user already has, through any OpenAI-compatible API or Claude.
- Write Pinterest-ready copy within Pinterest's limits, including an affiliate disclosure.
- Use a Google Sheet as the draft queue and the "your draft is ready" message.
- Post READY rows to the right Pinterest board and write back the live pin URL.
- Run hands-free on a schedule (GitHub Actions, free) or by hand from a terminal.
- Get a non-programmer running in about 30 minutes by following the README.

## Non-goals (v1)

- Generating the images. The user makes them. An image-generation plug-in could come later.
- Pinterest analytics or performance tracking.
- A web dashboard. The Google Sheet is the interface.
- Scraping sites whose terms forbid it.

## Anti-goals (a failure even if it "works")

- Pins that link to products that don't exist or aren't affiliate-tagged. The AI never invents products. It only ranks and writes about products that a real source returned.
- Spammy behavior: duplicate pins for the same product, or bulk posting that gets the account flagged. PinHunter dedupes and caps posts per run.
- Missing affiliate disclosure. Every description includes one (FTC/ASA rules and Pinterest policy).
- Leaked keys. Secrets live only in `.env` or GitHub Actions secrets, never in the repo or the Sheet.

## Constraints (verified 2026-11-18)

- **Pinterest API v5**: `POST /v5/pins` needs `board_id` and `media_source` (an `image_url` or `image_base64`). There is no draft endpoint, and a pin's image can't be changed after creation. That's why the draft lives in the Sheet. Title is capped at 100 characters, description at 800. The scopes are `boards:read, boards:write, pins:read, pins:write`. New apps start on Trial access, and public posting needs Standard access, which Pinterest reviews with a demo video. The README covers this.
- **Amazon**: PA-API 5 is retired (calls return 403). Its successor, the Creators API, uses OAuth 2.0 and needs an approved Associates account. Exact request shapes have to be checked against Amazon's docs while building.
- **AliExpress**: the Affiliate API (Open Platform, `api-sg.aliexpress.com`) has product query and hot-product methods and returns commission rates and sales volume. It needs an app key, app secret and tracking ID. The signing details have to be checked against the official docs while building.
- **Gumroad**: no official API for finding products to promote, and affiliate links are granted creator by creator. Gumroad links come in through the Feed source below.
- **Local machine**: Node 22 is installed and Python isn't, so the stack is Node.

## Approaches considered

1. **Node.js command-line tool + Google Sheet queue + GitHub Actions schedule** ← chosen. Easy to fork and run for free on a schedule, and every part (sources, AI provider) is swappable code. Trade-off: users need to copy-paste a few keys during setup.
2. **n8n / Make workflow template.** No code, but tied to one platform. The "hunt and score" logic gets awkward in visual nodes, and it's harder to grow as an open-source project.
3. **MCP server only** (your AI agent calls PinHunter tools). Fits "connect your agent", but it needs an agent running every time, so it isn't hands-free. It can be added later as a thin layer over the same core (v2).

Owner handed over the "how", so approach 1 is the builder's call.

## How it works

```
hunt (scheduled or manual)
  1. Plan   AI turns your niches + current season into search keywords
  2. Hunt   each enabled source searches those keywords -> real products
  3. Score  sales/rating/commission score + AI "Pinterest fit" score; drop dupes
  4. Write  AI writes pin copy for the top N
  5. Queue  append rows to the Sheet (status NEEDS_IMAGE); optional webhook ping

you: make image -> paste link in image_url -> set status READY

publish (scheduled or manual)
  6. Post   READY rows -> Pinterest pin on chosen board -> write back pin URL, POSTED
```

### Sources (plug-ins, common interface)

Each source exports `search(keyword, opts) -> Product[]`. A Product is `{source, sourceId, title, productUrl, affiliateUrl, price, currency, rating, reviewCount, salesVolume, commissionRate, category, imageRefUrl}`.

- `aliexpress`: Affiliate API product and hot-product query.
- `amazon`: Creators API search. Disabled until credentials are present.
- `feed`: a "Products" tab in the same Sheet, or a CSV, where users paste any affiliate links (Gumroad, ClickBank, Impact, CJ, ShareASale…) with optional notes. Always available, and it covers every network without an API.
- `mock`: fixed sample products for tests and a demo run with no accounts.

### AI provider

One small client with two modes:
- **OpenAI-compatible** (`/chat/completions`): OpenAI, Google Gemini, xAI Grok, Groq, OpenRouter, DeepSeek, Ollama/LM Studio. Presets fill the base URL. The user sets `AI_PROVIDER`, `AI_API_KEY` and `AI_MODEL`.
- **Anthropic** (`/v1/messages`) for Claude.

Every AI call asks for JSON and validates it. If the output is invalid, it retries once, then skips that product.

### Scoring

`score = 0.6 * data score + 0.4 * AI fit score`. The data score is normalized from sales volume, rating × log(reviews), and estimated commission per sale. The AI fit score (0–10) asks "would this do well on Pinterest?": is it visual, is it giftable or aspirational, does it match the niche. Products already in the Sheet (same source + ID) are skipped. The top `DRAFTS_PER_RUN` are kept (default 5).

### Google Sheet (the queue and the message)

The Drafts tab has these columns: `created_at | status | source | product | price | score | why_picked | affiliate_link | board | pin_title | pin_description | alt_text | image_brief | image_url | pin_url | error`.

Statuses: `NEEDS_IMAGE` → (you) `READY` → `POSTED` or `ERROR`. Set `SKIP` to discard a draft.

Auth is a Google service account: you share the Sheet with its email address. PinHunter creates the tab and the headers if they're missing.

Optional `NOTIFY_WEBHOOK_URL` (Discord, Slack or any webhook) receives "5 new pin drafts ready — add images: <sheet link>".

### Pinterest

- `pinhunter auth` opens a one-time OAuth login in the browser. The callback goes to a localhost URL, and the refresh token is saved to `.env`. Tokens refresh automatically.
- `pinhunter boards` lists your boards. You map niches to boards in the config, or the AI picks from your board list.
- During publish, PinHunter downloads the image from `image_url` and uploads it as base64. That way Google Drive share links and other non-direct links work too, as long as the file is shared publicly. It also checks the size and type.
- Optional `PINTEREST_SANDBOX=true` for testing against the sandbox.
- `MAX_POSTS_PER_RUN` (default 5) and a delay between posts reduce the spam risk.

### Commands

`pinhunter init` (setup wizard that writes `.env`) · `auth` · `boards` · `hunt [--dry-run]` · `publish [--dry-run]` · `doctor` (checks every connection).

### Config

Secrets go in `.env`. Preferences go in `pinhunter.config.json`: niches, keywords, sources enabled, drafts per run, board mapping, language/market, disclosure text, price range.

### Running on a schedule

The included `.github/workflows/pinhunter.yml` runs `hunt` daily and `publish` hourly using repository secrets. Users can also run it locally or with Windows Task Scheduler or cron.

## Stack

Node 22+, plain JavaScript (ES modules), no build step. Dependencies are kept tiny: `google-auth-library` only. Everything else uses built-in `fetch`, `node:test` and `process.loadEnvFile`. MIT license.

## Left to the builder

- Exact AliExpress signing and Amazon Creators API request shapes, verified against the official docs. Each source is isolated and covered by mocked-HTTP tests.
- Prompt wording, the scoring weights' fine-tuning, and README screenshots.
- Repo name and whether it's public: the owner confirms before anything is pushed to GitHub.

## Builder's calls (for the owner to check)

- Node instead of Python (Node is already installed and makes the setup simpler).
- AI picks keywords but never products. Products always come from a real source.
- Disclosure line is on by default and editable in the config.
- 5 drafts per hunt and at most 5 posts per publish run by default.
- Discord/Slack webhook for the "drafts ready" ping. Email can be added later.
