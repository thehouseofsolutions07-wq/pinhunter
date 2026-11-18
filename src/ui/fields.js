import { PROVIDERS } from '../ai/presets.js';

/**
 * Every .env setting the dashboard can edit. Anything not listed here is refused.
 * secret: never sent to the browser; an empty value on save keeps the current one.
 */
export const ENV_GROUPS = [
  {
    id: 'ai',
    title: 'Your AI',
    help: 'Any OpenAI-compatible AI or Claude. Gemini has a free tier at aistudio.google.com.',
    link: 'https://aistudio.google.com/api-keys',
    fields: [
      { key: 'AI_PROVIDER', label: 'Provider', type: 'select', options: Object.keys(PROVIDERS).filter((p) => p !== 'mock') },
      { key: 'AI_MODEL', label: 'Model', placeholder: 'gemini-3.5-flash-lite' },
      { key: 'AI_API_KEY', label: 'API key', secret: true },
      { key: 'AI_BASE_URL', label: 'Base URL (only for "custom")', placeholder: 'https://…/v1' },
    ],
  },
  {
    id: 'sheet',
    title: 'Google Sheet',
    help: 'Your draft queue. Share the Sheet with the service account email as Editor.',
    link: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
    fields: [
      { key: 'GOOGLE_SHEET_ID', label: 'Sheet ID', placeholder: 'the long ID in the Sheet link' },
      { key: 'GOOGLE_SERVICE_ACCOUNT_FILE', label: 'Service account key file', placeholder: 'service-account.json' },
      { key: 'GOOGLE_SERVICE_ACCOUNT_JSON', label: '…or paste the key JSON', type: 'textarea', secret: true },
    ],
  },
  {
    id: 'pinterest',
    title: 'Pinterest',
    help: 'Create an app at developers.pinterest.com, add the redirect URI below, then press Connect.',
    link: 'https://developers.pinterest.com/apps/',
    fields: [
      { key: 'PINTEREST_CLIENT_ID', label: 'App ID' },
      { key: 'PINTEREST_CLIENT_SECRET', label: 'App secret', secret: true },
      { key: 'PINTEREST_REDIRECT_URI', label: 'Redirect URI', placeholder: 'http://localhost:8085/callback' },
      { key: 'PINTEREST_SANDBOX', label: 'Post to the sandbox (testing)', type: 'bool' },
      { key: 'PINTEREST_REFRESH_TOKEN', label: 'Refresh token (filled in by Connect)', secret: true },
      { key: 'PINTEREST_ACCESS_TOKEN', label: 'Access token (filled in by Connect)', secret: true },
    ],
  },
  {
    id: 'aliexpress',
    title: 'AliExpress',
    help: 'App key and secret from the AliExpress Open Platform; tracking ID from the affiliate portal.',
    link: 'https://openservice.aliexpress.com/',
    fields: [
      { key: 'ALIEXPRESS_APP_KEY', label: 'App key' },
      { key: 'ALIEXPRESS_APP_SECRET', label: 'App secret', secret: true },
      { key: 'ALIEXPRESS_TRACKING_ID', label: 'Tracking ID' },
    ],
  },
  {
    id: 'amazon',
    title: 'Amazon (beta)',
    help: 'Creators API credentials from Associates Central → Tools → Creators API.',
    link: 'https://affiliate-program.amazon.com/',
    fields: [
      { key: 'AMAZON_CREDENTIAL_ID', label: 'Credential ID' },
      { key: 'AMAZON_CREDENTIAL_SECRET', label: 'Credential secret', secret: true },
      { key: 'AMAZON_CREDENTIAL_VERSION', label: 'Credential version', placeholder: '3.1' },
      { key: 'AMAZON_PARTNER_TAG', label: 'Partner tag', placeholder: 'yourtag-20' },
      { key: 'AMAZON_MARKETPLACE', label: 'Marketplace', placeholder: 'www.amazon.com' },
    ],
  },
  {
    id: 'notify',
    title: 'Notifications',
    help: 'Optional: a Discord or Slack webhook gets a message when new drafts are ready.',
    fields: [{ key: 'NOTIFY_WEBHOOK_URL', label: 'Webhook URL', secret: true }],
  },
];

export const ENV_FIELDS = ENV_GROUPS.flatMap((g) => g.fields.map((f) => ({ ...f, group: g.id })));
export const FIELD_BY_KEY = new Map(ENV_FIELDS.map((f) => [f.key, f]));

/** pinhunter.config.json keys the dashboard edits, with how to clean each value. */
const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[\n,]/)).map((s) => String(s).trim()).filter(Boolean);
const num = (v, min = 0) => Math.max(min, Number.parseFloat(v) || 0);
const int = (v, min = 0) => Math.max(min, Math.round(Number(v) || 0));
const text = (v) => String(v ?? '').trim();
const strMap = (v) =>
  Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).map(([k, val]) => [text(k), text(val)]).filter(([k, val]) => k && val));

export const PREF_CLEANERS = {
  niches: list,
  keywords: list,
  keywordsPerRun: (v) => int(v, 1),
  sources: list,
  draftsPerRun: (v) => int(v, 1),
  maxPostsPerRun: (v) => int(v, 1),
  postDelaySeconds: (v) => int(v, 0),
  market: (v) => ({ country: text(v?.country).toUpperCase(), currency: text(v?.currency).toUpperCase(), language: text(v?.language).toUpperCase() }),
  priceRange: (v) => ({ min: num(v?.min), max: num(v?.max) }),
  boards: strMap,
  disclosure: text,
  tone: text,
  language: text,
};
