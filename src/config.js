import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_PREFS = {
  niches: ['home decor', 'kitchen gadgets'],
  keywords: [],
  keywordsPerRun: 3,
  sources: ['aliexpress', 'feed'],
  draftsPerRun: 5,
  maxPostsPerRun: 5,
  postDelaySeconds: 30,
  market: { country: 'US', currency: 'USD', language: 'EN' },
  priceRange: { min: 0, max: 0 },
  boards: {},
  disclosure: '#affiliate — I may earn a commission if you buy through this link.',
  tone: 'friendly, helpful and inspiring',
  language: 'English',
};

/** Load .env (if present) into env and merge pinhunter.config.json over the defaults. */
export function loadConfig({ cwd = process.cwd(), env = process.env, configPath } = {}) {
  const envFile = join(cwd, '.env');
  if (env === process.env && existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch (e) {
      throw new Error(`Could not read .env: ${e.message}`);
    }
  }
  const file = configPath || env.PINHUNTER_CONFIG || join(cwd, 'pinhunter.config.json');
  let user = {};
  if (existsSync(file)) {
    try {
      user = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`${file} is not valid JSON: ${e.message}`);
    }
  }
  const prefs = {
    ...DEFAULT_PREFS,
    ...user,
    market: { ...DEFAULT_PREFS.market, ...(user.market || {}) },
    priceRange: { ...DEFAULT_PREFS.priceRange, ...(user.priceRange || {}) },
  };
  return { env, prefs, configFile: existsSync(file) ? file : null };
}

/** Read the Google service account from GOOGLE_SERVICE_ACCOUNT_JSON (raw or base64) or GOOGLE_SERVICE_ACCOUNT_FILE. */
export function readServiceAccount(env, cwd = process.cwd()) {
  let raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw && env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    const p = env.GOOGLE_SERVICE_ACCOUNT_FILE;
    const full = existsSync(p) ? p : join(cwd, p);
    if (!existsSync(full)) throw new Error(`GOOGLE_SERVICE_ACCOUNT_FILE not found: ${p}`);
    raw = readFileSync(full, 'utf8');
  }
  if (!raw) return null;
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(text);
  if (!sa.client_email || !sa.private_key) throw new Error('Service account JSON is missing client_email or private_key.');
  return sa;
}
