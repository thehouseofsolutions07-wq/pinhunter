# PinHunter 📌

**Find affiliate products that sell, get Pinterest pins written for you, and add only the picture.**

PinHunter searches affiliate programs for products that are selling well, picks the ones most likely to do well on Pinterest, and writes a complete pin for each. A pin includes a title, a description with hashtags, your affiliate link, a board, alt text, and a brief describing what picture to make. Each pin lands in a **Google Sheet** as a draft:

> **NEEDS_IMAGE** — "Draft ready. Make the picture, paste its link, set READY."

You make the image. PinHunter posts the pin and writes the live link back into the Sheet.

It works with **any AI you already use**: Google Gemini, xAI Grok, OpenAI, Anthropic Claude, Groq, OpenRouter, DeepSeek, Mistral, or a free local model through Ollama or LM Studio.

```
 hunt (daily)                                you                      publish (hourly)
┌────────────────────────────────┐   ┌────────────────────────┐   ┌──────────────────────────┐
│ AI picks trending keywords     │   │ make the picture       │   │ READY rows → Pinterest   │
│ sources return real products   │ → │ paste its link         │ → │ pin URL written back     │
│ score: sales + AI "pin appeal" │   │ set status to READY    │   │ status → POSTED          │
│ AI writes the pin copy         │   └────────────────────────┘   └──────────────────────────┘
│ rows added: NEEDS_IMAGE  + ping│
└────────────────────────────────┘
```

**The AI never invents products.** It only picks search keywords, ranks the results, and writes copy. Every product and link comes from a real affiliate source.

---

## Try it in 10 seconds (no accounts needed)

Requires [Node.js 22+](https://nodejs.org). There's nothing to install: PinHunter has zero dependencies.

```bash
git clone https://github.com/<you>/pinhunter.git
cd pinhunter
node bin/pinhunter.js demo
```

The demo runs the whole loop with a fake AI, sample products, an in-memory "Sheet", and a fake Pinterest.

---

## Setup (about 30 minutes, once)

```bash
node bin/pinhunter.js init      # creates .env and pinhunter.config.json
```

Then fill in `.env` step by step.

### 1. Connect your AI

| Provider | `AI_PROVIDER` | Get a key | Example `AI_MODEL` |
|---|---|---|---|
| Google Gemini | `gemini` | aistudio.google.com → Get API key | `gemini-3.5-flash-lite` |
| xAI Grok | `grok` | console.x.ai | `grok-4` |
| OpenAI | `openai` | platform.openai.com | `gpt-4o-mini` |
| Anthropic Claude | `anthropic` | console.anthropic.com | `claude-sonnet-5-5` |
| Groq | `groq` | console.groq.com | `llama-3.3-70b-versatile` |
| OpenRouter | `openrouter` | openrouter.ai | any model id |
| Ollama (free, local) | `ollama` | no key | `llama3.1` |
| Anything OpenAI-compatible | `custom` + `AI_BASE_URL` | — | — |

Model names change often. Use whatever your provider currently lists.

### 2. Create the Google Sheet (your draft queue)

1. Create an empty Google Sheet. Copy the ID from its URL, `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`, into `GOOGLE_SHEET_ID`.
2. In [Google Cloud Console](https://console.cloud.google.com/): create a project and enable the **Google Sheets API**. Then go to **IAM & Admin → Service accounts → Create**, open **Keys → Add key → JSON**, and download the file.
3. Save the file as `service-account.json` in the PinHunter folder. It is git-ignored.
4. **Share your Sheet** with the service account's `client_email` (it looks like `...@...iam.gserviceaccount.com`) as **Editor**.

PinHunter creates the `Drafts` and `Products` tabs, the headers, and a status dropdown the first time it runs.

### 3. Connect Pinterest

1. You need a Pinterest **business** account. Converting a personal account is free.
2. Create an app at [developers.pinterest.com/apps](https://developers.pinterest.com/apps/). Add the redirect URI `http://localhost:8085/callback`. Copy the App ID and secret into `PINTEREST_CLIENT_ID` and `PINTEREST_CLIENT_SECRET`.
3. Run:
   ```bash
   node bin/pinhunter.js auth
   ```
   A browser opens and you approve access. The tokens are saved to `.env`.
4. Run `node bin/pinhunter.js boards` to check that your boards are listed.

> **Trial vs Standard access.** New Pinterest apps start on *Trial* access, which limits what you can publish. To post publicly, request **Standard access** from your app's page. Pinterest usually asks for a short screen recording of the app creating a pin, and running `pinhunter publish` on one draft works well for that. Until then you can test against the sandbox: generate a sandbox token in the app dashboard, put it in `PINTEREST_ACCESS_TOKEN`, and set `PINTEREST_SANDBOX=true`.

### 4. Choose where products come from

Enable sources in `pinhunter.config.json` under `"sources"`.

| Source | What it does | Needs |
|---|---|---|
| `aliexpress` | Searches the AliExpress Affiliate API, sorted by recent sales. Returns commission rate and sales volume. | App key, secret and tracking ID from the [AliExpress Open Platform](https://openservice.aliexpress.com) (Affiliate account) |
| `amazon` *(beta)* | Searches the Amazon **Creators API**, which replaced PA-API 5 in 2026 | Associates account approved for the Creators API: credential ID, secret, version and partner tag |
| `feed` | Reads your own affiliate links from the **Products** tab of the Sheet | Nothing. Paste links from **Gumroad, ClickBank, Impact, CJ, ShareASale, Etsy**, or any other network |
| `mock` | Sample products | Nothing (testing) |

**Products tab columns:** `affiliate_link | title | price | currency | category | notes`. Each link is drafted once.

### 5. Check everything

```bash
node bin/pinhunter.js doctor
```

---

## Use the dashboard (easiest)

```bash
npm run ui          # or: node bin/pinhunter.js ui
```

This opens PinHunter in your browser at `http://localhost:8085`. It only listens on your own computer, and the link includes a private session key that is saved in `.env`. In the dashboard you can:

- **Keys & connections:** paste your AI key, Google Sheet, Pinterest app and affiliate keys. Secrets are never shown again; only their last 4 characters are. Click **Connect Pinterest** to log in once.
- **Hunt:** find products and write drafts, with a live log. Tick "dry run" to preview without saving.
- **Drafts:** paste each image link, preview it, adjust the board or copy, and mark it **Ready**.
- **Publish:** post every Ready draft and see the pin links.
- **Settings:** niches, sources, price range, how many drafts per run, and which board each niche goes to.

Keep the terminal window open while you use it, and press Ctrl+C to stop it. Options: `--port 8090`, `--no-open`, and `--demo`. Run `npm run ui:demo` to try the dashboard with sample data and no accounts. If you change the port, your Pinterest app's redirect URI must be changed to match (`http://localhost:<port>/callback`).

### Put the dashboard online (optional)

You can run the same dashboard on a web host so you can open it from any device. On the host, it asks for a password.

1. Deploy this repo as a Node.js app (Hostinger Business/Cloud, Render, Railway, a VPS…). The start command is `npm start`, which runs `server.js`, and the app listens on `PORT`.
2. Set these environment variables on the host:
   - `PINHUNTER_PUBLIC_URL`: the address it lives at, e.g. `https://pins.example.com`
   - `PINHUNTER_PASSWORD`: at least 10 characters
   - `PINHUNTER_UI_TOKEN`: a long random string. Changing it logs everyone out.
   - your keys as in `.env`. Use `GOOGLE_SERVICE_ACCOUNT_JSON` (base64) instead of a key file.
3. In your Pinterest app, add `https://<your address>/callback` as a redirect URI.

Online, it only answers on that address. Wrong passwords are limited to 5 tries per 15 minutes. The login cookie is HttpOnly, Secure and SameSite=Strict. Image links must be web links, not file paths.

## Daily use (command line)

```bash
node bin/pinhunter.js hunt --dry-run   # preview, writes nothing
node bin/pinhunter.js hunt             # adds drafts to the Sheet
```

Then, in the Sheet, for each draft:

1. Read the **image_brief** column (it includes a product photo link for reference) and make your pin image. A vertical 2:3 image such as 1000×1500 works best.
2. Paste the image link into **image_url**. Any of these work:
   - a direct image URL
   - a Google Drive link (shared as "Anyone with the link")
   - a Dropbox link
   - a local file path, when you run PinHunter on your own computer
3. Change **status** to **READY**.

```bash
node bin/pinhunter.js publish
```

Each row becomes **POSTED** with the pin link, or **ERROR** with a plain-English reason. To discard a draft, set its status to `SKIP`.

### Sheet columns (Drafts tab)

| Column | Filled by | Meaning |
|---|---|---|
| `status` | both | `NEEDS_IMAGE` → (you) `READY` → `POSTED` / `ERROR`; `SKIP` to discard |
| `product`, `price`, `source`, `product_key` | PinHunter | What was found. The key prevents duplicates |
| `score`, `why_picked` | PinHunter | 0–10 ranking and the reason |
| `affiliate_link` | PinHunter | Where the pin links to |
| `board`, `pin_title`, `pin_description`, `alt_text` | PinHunter | Pin copy. **You can edit any of these before setting READY** |
| `image_brief` | PinHunter | What picture to make |
| `image_url` | **you** | Link to your finished image |
| `pin_url`, `error` | PinHunter | Result |

You get a "drafts ready" message by setting `NOTIFY_WEBHOOK_URL` to a Discord or Slack webhook. The message links to your Sheet.

---

## Run it automatically (free, on GitHub)

1. Push your copy of this repo to GitHub. A private repo is fine.
2. Commit your `pinhunter.config.json`. It holds no secrets.
3. Go to **Settings → Secrets and variables → Actions**:
   - **Secrets:** add each value from your `.env`. Paste the service account JSON file's contents into `GOOGLE_SERVICE_ACCOUNT_JSON`.
   - **Variables:** add `PINHUNTER_ENABLED` = `true`.
4. The included workflow runs `hunt` once a day and `publish` every hour. You can also run it by hand from the **Actions** tab.

On your own computer you can schedule `node bin/pinhunter.js hunt` and `publish` with Windows Task Scheduler or cron instead.

---

## Configuration (`pinhunter.config.json`)

| Key | Default | Meaning |
|---|---|---|
| `niches` | `["home decor","kitchen gadgets"]` | Topics your account covers. The AI turns them into keywords |
| `keywords` | `[]` | Fixed keywords to always search |
| `keywordsPerRun` | `3` | Keywords per hunt |
| `sources` | `["aliexpress","feed"]` | Which sources to use |
| `draftsPerRun` | `5` | New drafts per hunt |
| `maxPostsPerRun` | `5` | Most pins posted per publish run |
| `postDelaySeconds` | `30` | Pause between posts |
| `market` | US / USD / EN | Country, currency and language for product searches |
| `priceRange` | none | `{ "min": 5, "max": 150 }`. Products outside it are skipped |
| `boards` | `{}` | Niche → board name. Otherwise the AI picks from your boards |
| `disclosure` | `#affiliate — …` | Added to every description |
| `tone`, `language` | friendly / English | Writing style for the pins |

## Scoring

Each product gets a 0–10 score: `0.6 × data score + 0.4 × AI Pinterest-fit score`.

- **Data score:** sales volume, rating weighted by number of reviews, and commission per sale.
- **Fit score:** how visual, giftable, seasonal and on-niche the product is.

## Add a new affiliate network

Create `src/sources/<name>.js` exporting a function that returns `{ name, hunt(keywords) }`. `hunt` should return products in the shape documented in `src/product.js`. List the required env vars on `.required` and register the source in `src/sources/index.js`. Write tests with a fake `fetch` (see `test/sources.test.js`). Pull requests are welcome.

## Play fair

- **Disclose.** Every pin carries the disclosure line. FTC, ASA and Pinterest rules require it.
- **Don't spam.** Pinterest limits automated posting. Keep `maxPostsPerRun` modest and make original images.
- Follow each affiliate program's terms. Some don't allow certain link placements, and Amazon doesn't allow showing prices that may be out of date.
- PinHunter only uses official APIs and your own links. It does not scrape.

## Troubleshooting

| Message | Fix |
|---|---|
| `That link opens a web page, not an image` | Use a direct image link, or share the Drive file as "Anyone with the link" |
| `Board "X" not found` | Fix the board name in the row (the error lists your boards) and set READY again |
| `Pinterest token expired` | Run `pinhunter auth` again (and update the GitHub secret) |
| `Source "aliexpress" skipped` | Add the AliExpress keys to `.env` |
| `HTTP 403` from Google | Share the Sheet with the service account email as Editor |
| `HTTP 503` / `high demand` from the AI | PinHunter already retries busy and rate-limited replies with backoff. If it keeps failing, switch `AI_MODEL` to a lighter model (for Gemini, `gemini-3.5-flash-lite`) |

## Development

```bash
npm test          # node:test, fully offline
node bin/pinhunter.js demo
```

Design notes are in `docs/superpowers/`.

## License

MIT
