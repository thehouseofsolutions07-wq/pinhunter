import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSources } from '../sources/index.js';
import { runHunt } from '../hunt/index.js';
import { runPublish } from '../publish.js';
import { runAuth } from './auth.js';
import { runDemo } from './demo.js';
import { aliexpressSource } from '../sources/aliexpress.js';
import { amazonSource } from '../sources/amazon.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const HELP = `PinHunter — affiliate product hunter and Pinterest pin drafter

Usage: pinhunter <command> [--dry-run]

  init       create .env and pinhunter.config.json from the examples
  auth       connect your Pinterest account (one-time browser login)
  boards     list your Pinterest boards
  hunt       find products, write pin drafts, add them to the Sheet (status NEEDS_IMAGE)
  publish    post every READY draft to Pinterest and write the pin link back
  doctor     check that AI, Google Sheet, Pinterest and sources are set up
  demo       see the whole loop offline, no accounts needed
  help       show this help

  --dry-run  (hunt, publish) show what would happen without writing or posting
`;

export const commands = {
  help: async (ctx) => ctx.log(HELP),

  init: async ({ cwd, log }) => {
    for (const [src, dest] of [['.env.example', '.env'], ['pinhunter.config.example.json', 'pinhunter.config.json']]) {
      const target = join(cwd, dest);
      if (existsSync(target)) log(`${dest} already exists — left unchanged.`);
      else {
        copyFileSync(join(ROOT, src), target);
        log(`Created ${dest}`);
      }
    }
    log('\nNext: open .env and fill in your AI key, Google Sheet and Pinterest app. Then run "pinhunter doctor".');
  },

  auth: (ctx) => runAuth(ctx),

  boards: async (ctx) => {
    const boards = await ctx.pinterest().listBoards();
    if (!boards.length) ctx.log('No boards yet. Create one on Pinterest first.');
    for (const b of boards) ctx.log(`${b.id}\t${b.name}${b.privacy && b.privacy !== 'PUBLIC' ? ` (${b.privacy.toLowerCase()})` : ''}`);
  },

  hunt: async (ctx, { dryRun }) => {
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
    const { drafts } = await runHunt({ ai, sources, queue, prefs: ctx.prefs, boardNames, notifyUrl: ctx.env.NOTIFY_WEBHOOK_URL, sheetUrl: queue.url, log: ctx.log, dryRun });
    if (dryRun) for (const d of drafts) ctx.log(`\n• ${d.pin_title}  [${d.board}]  score ${d.score}\n  ${d.affiliate_link}\n  ${d.pin_description.replace(/\n/g, ' ')}`);
  },

  publish: async (ctx, { dryRun }) => {
    const r = await runPublish({ queue: ctx.queue(), pinterest: ctx.pinterest(), prefs: ctx.prefs, log: ctx.log, dryRun, cwd: ctx.cwd });
    ctx.log(`Done: ${r.posted} posted, ${r.failed} failed.`);
    if (r.failed) process.exitCode = 1;
  },

  doctor: async (ctx) => {
    const { log, env, prefs } = ctx;
    let bad = 0;
    const check = async (label, fn) => {
      try {
        const note = await fn();
        log(`✓ ${label}${note ? ` — ${note}` : ''}`);
      } catch (e) {
        bad++;
        log(`✗ ${label} — ${e.message}`);
      }
    };
    log(`Config: ${ctx.configFile || 'defaults (no pinhunter.config.json)'}`);
    await check('AI', async () => {
      const out = await ctx.ai().chatJSON('[task:ping] Health check.', 'Return {"ok": true}.');
      if (!out) throw new Error('empty reply');
      return `${env.AI_PROVIDER} / ${env.AI_MODEL || '(no model)'}`;
    });
    await check('Google Sheet', async () => {
      const q = ctx.queue();
      await q.ensure();
      const drafts = await q.readDrafts();
      return `${drafts.length} drafts · ${q.url}`;
    });
    await check('Pinterest', async () => {
      const p = ctx.pinterest();
      const boards = await p.listBoards();
      return `${boards.length} boards${/^(1|true)$/i.test(env.PINTEREST_SANDBOX || '') ? ' (sandbox)' : ''}`;
    });
    for (const name of prefs.sources || []) {
      const req = { aliexpress: aliexpressSource.required, amazon: amazonSource.required }[name] || [];
      await check(`Source: ${name}`, async () => {
        const missing = req.filter((k) => !env[k]);
        if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
        return name === 'feed' ? 'reads the Products tab of your Sheet' : 'keys present';
      });
    }
    log(env.NOTIFY_WEBHOOK_URL ? '✓ Notifications — webhook set' : '· Notifications — optional, NOTIFY_WEBHOOK_URL not set');
    if (bad) process.exitCode = 1;
  },

  demo: () => runDemo(),
};
