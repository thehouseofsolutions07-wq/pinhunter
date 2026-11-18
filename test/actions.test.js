import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChecks, doHunt } from '../src/actions.js';
import { buildContext } from '../src/cli/context.js';
import { createAI } from '../src/ai/client.js';
import { createMemoryQueue } from '../src/sheets/queue.js';
import { DEFAULT_PREFS } from '../src/config.js';

const quiet = () => {};
const tmp = () => mkdtempSync(join(tmpdir(), 'ph-act-'));

test('runChecks reports each part with ok true/false and a note', async () => {
  const checks = await runChecks(buildContext({ cwd: tmp(), env: {}, log: quiet }));
  const ai = checks.find((c) => c.name === 'AI');
  assert.equal(ai.ok, false);
  assert.match(ai.note, /AI_PROVIDER/);
  assert.equal(checks.find((c) => c.name === 'Google Sheet').ok, false);
  assert.equal(checks.find((c) => c.name === 'Pinterest').ok, false);
  assert.equal(checks.find((c) => c.name === 'Notifications').ok, null);
});

test('runChecks marks a working AI as ok', async () => {
  const checks = await runChecks(buildContext({ cwd: tmp(), env: { AI_PROVIDER: 'mock' }, log: quiet }));
  assert.equal(checks.find((c) => c.name === 'AI').ok, true);
});

test('buildContext uses the env it is given instead of process.env', () => {
  const ctx = buildContext({ cwd: tmp(), env: { AI_PROVIDER: 'mock', GOOGLE_SHEET_ID: 'abc' }, log: quiet });
  assert.equal(ctx.env.GOOGLE_SHEET_ID, 'abc');
});

test('doHunt runs a full hunt and adds drafts to the queue', async () => {
  const queue = createMemoryQueue();
  const logs = [];
  const ctx = {
    env: {},
    prefs: { ...DEFAULT_PREFS, sources: ['mock'] },
    log: (m) => logs.push(m),
    ai: () => createAI({ provider: 'mock' }),
    queue: () => queue,
    hasPinterest: () => false,
  };
  const r = await doHunt(ctx, { dryRun: false });
  assert.equal(r.drafts.length, 5);
  assert.equal(queue.drafts.length, 5);
  assert.ok(logs.some((l) => /Added 5 draft/.test(l)));
});
