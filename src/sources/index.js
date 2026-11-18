import { aliexpressSource } from './aliexpress.js';
import { amazonSource } from './amazon.js';
import { feedSource } from './feed.js';
import { mockSource } from './mock.js';

/**
 * To add a new affiliate network: write a module that returns {name, hunt(keywords) -> Product[]},
 * list its required env vars on `.required`, and register it here.
 */
export const SOURCES = {
  aliexpress: (ctx) => aliexpressSource(ctx.env, ctx.prefs, ctx.fetch),
  amazon: (ctx) => amazonSource(ctx.env, ctx.prefs, ctx.fetch),
  feed: (ctx) => feedSource(ctx),
  mock: () => mockSource(),
};
const REQUIRED = { aliexpress: aliexpressSource.required, amazon: amazonSource.required };

export function getSources(names, ctx) {
  const log = ctx.log || console.log;
  const out = [];
  for (const raw of names || []) {
    const name = String(raw).toLowerCase();
    const make = SOURCES[name];
    if (!make) {
      log(`Unknown source "${raw}" (available: ${Object.keys(SOURCES).join(', ')}) — skipped.`);
      continue;
    }
    const missing = (REQUIRED[name] || []).filter((k) => !ctx.env?.[k]);
    if (missing.length) {
      log(`Source "${name}" skipped: set ${missing.join(', ')} in .env to enable it.`);
      continue;
    }
    out.push(make(ctx));
  }
  return out;
}

/** Run every source; one failing source never stops the others. */
export async function huntAll(sources, keywords, { log = console.log } = {}) {
  const products = [];
  const errors = [];
  for (const s of sources) {
    try {
      const found = await s.hunt(keywords);
      log(`  ${s.name}: ${found.length} products`);
      products.push(...found);
    } catch (e) {
      errors.push({ source: s.name, message: e.message });
      log(`  ${s.name}: failed — ${e.message}`);
    }
  }
  return { products, errors };
}
