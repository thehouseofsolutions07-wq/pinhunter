import { getSources } from './sources/index.js';
import { runHunt } from './hunt/index.js';
import { runPublish } from './publish.js';
import { aliexpressSource } from './sources/aliexpress.js';
import { amazonSource } from './sources/amazon.js';

const SOURCE_KEYS = { aliexpress: aliexpressSource.required, amazon: amazonSource.required };

/** Check every connection. Returns [{name, ok, note}]; ok is null for optional parts that are not set. */
export async function runChecks(ctx) {
  const { env, prefs } = ctx;
  const out = [];
  const check = async (name, fn) => {
    try {
      out.push({ name, ok: true, note: (await fn()) || '' });
    } catch (e) {
      out.push({ name, ok: false, note: e.message });
    }
  };
  await check('AI', async () => {
    const reply = await ctx.ai().chatJSON('[task:ping] Health check.', 'Return {"ok": true}.');
    if (!reply) throw new Error('empty reply');
    return `${env.AI_PROVIDER} / ${env.AI_MODEL || '(no model)'}`;
  });
  await check('Google Sheet', async () => {
    const q = ctx.queue();
    await q.ensure();
    const drafts = await q.readDrafts();
    return `${drafts.length} drafts${q.url ? ` · ${q.url}` : ''}`;
  });
  await check('Pinterest', async () => {
    const boards = await ctx.pinterest().listBoards();
    return `${boards.length} boards${/^(1|true)$/i.test(env.PINTEREST_SANDBOX || '') ? ' (sandbox)' : ''}`;
  });
  for (const name of prefs.sources || []) {
    await check(`Source: ${name}`, async () => {
      const missing = (SOURCE_KEYS[name] || []).filter((k) => !env[k]);
      if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
      return name === 'feed' ? 'reads the Products tab of your Sheet' : 'keys present';
    });
  }
  out.push(
    env.NOTIFY_WEBHOOK_URL
      ? { name: 'Notifications', ok: true, note: 'webhook set' }
      : { name: 'Notifications', ok: null, note: 'optional, NOTIFY_WEBHOOK_URL not set' },
  );
  return out;
}

/** Find products, write pin drafts and add them to the Sheet. */
export async function doHunt(ctx, { dryRun = false } = {}) {
  const queue = ctx.queue();
  const ai = ctx.ai();
  await queue.ensure();
  let boardNames = Object.values(ctx.prefs.boards || {});
  if (ctx.hasPinterest()) {
    try {
      boardNames = (await ctx.pinterest().listBoards()).map((b) => b.name);
    } catch (e) {
      ctx.log(`Could not load Pinterest boards (${e.message}); continuing without them.`);
    }
  }
  const sources = getSources(ctx.prefs.sources, { env: ctx.env, prefs: ctx.prefs, fetch, queue, log: ctx.log });
  if (!sources.length) throw new Error('No product sources are enabled. Check "sources" in pinhunter.config.json and the keys in .env.');
  return runHunt({ ai, sources, queue, prefs: ctx.prefs, boardNames, notifyUrl: ctx.env.NOTIFY_WEBHOOK_URL, sheetUrl: queue.url, log: ctx.log, dryRun });
}

/** Post READY drafts to Pinterest and write the result back. */
export function doPublish(ctx, { dryRun = false } = {}) {
  return runPublish({ queue: ctx.queue(), pinterest: ctx.pinterest(), prefs: ctx.prefs, log: ctx.log, dryRun, cwd: ctx.cwd, allowFiles: ctx.allowFiles !== false });
}
