import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks, doHunt, doPublish } from '../actions.js';
import { runAuth } from './auth.js';
import { runDemo } from './demo.js';

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
    const { drafts } = await doHunt(ctx, { dryRun });
    if (dryRun) for (const d of drafts) ctx.log(`\n• ${d.pin_title}  [${d.board}]  score ${d.score}\n  ${d.affiliate_link}\n  ${d.pin_description.replace(/\n/g, ' ')}`);
  },

  publish: async (ctx, { dryRun }) => {
    const r = await doPublish(ctx, { dryRun });
    ctx.log(`Done: ${r.posted} posted, ${r.failed} failed.`);
    if (r.failed) process.exitCode = 1;
  },

  doctor: async (ctx) => {
    ctx.log(`Config: ${ctx.configFile || 'defaults (no pinhunter.config.json)'}`);
    const checks = await runChecks(ctx);
    for (const c of checks) ctx.log(`${c.ok === true ? '✓' : c.ok === false ? '✗' : '·'} ${c.name}${c.note ? ` — ${c.note}` : ''}`);
    if (checks.some((c) => c.ok === false)) process.exitCode = 1;
  },

  demo: () => runDemo(),
};
