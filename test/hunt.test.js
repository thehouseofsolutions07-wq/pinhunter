import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHunt } from '../src/hunt/index.js';
import { createAI } from '../src/ai/client.js';
import { mockSource } from '../src/sources/mock.js';
import { createMemoryQueue } from '../src/sheets/queue.js';
import { DEFAULT_PREFS } from '../src/config.js';

const ai = createAI({ provider: 'mock' });
const base = { ai, sources: [mockSource()], prefs: DEFAULT_PREFS, log: () => {}, now: new Date('2026-11-18T10:00:00Z') };

test('hunt appends 5 NEEDS_IMAGE drafts with complete pin copy', async () => {
  const queue = createMemoryQueue();
  const { drafts } = await runHunt({ ...base, queue });
  assert.equal(drafts.length, 5);
  assert.equal(queue.drafts.length, 5);
  for (const d of queue.drafts) {
    assert.equal(d.status, 'NEEDS_IMAGE');
    assert.ok(d.affiliate_link.startsWith('https://'));
    assert.ok(d.pin_title && d.pin_description && d.alt_text && d.image_brief);
    assert.ok(d.pin_description.endsWith(DEFAULT_PREFS.disclosure));
    assert.equal(d.image_url, '');
  }
  const scores = queue.drafts.map((d) => Number(d.score));
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'best first');
});

test('hunt skips products already in the sheet', async () => {
  const queue = createMemoryQueue();
  await runHunt({ ...base, queue });
  const firstKeys = new Set(queue.drafts.map((d) => d.product_key));
  const { drafts } = await runHunt({ ...base, queue });
  assert.equal(drafts.length, 3, 'only 3 of the 8 sample products are left');
  for (const d of drafts) assert.ok(!firstKeys.has(d.product_key));
});

test('hunt dry-run writes nothing and sends no notification', async () => {
  const queue = createMemoryQueue();
  let pinged = false;
  const { drafts } = await runHunt({ ...base, queue, dryRun: true, notifyUrl: 'https://discord.com/api/webhooks/x', fetch: async () => { pinged = true; return new Response('ok'); } });
  assert.equal(drafts.length, 5);
  assert.equal(queue.drafts.length, 0);
  assert.equal(pinged, false);
});

test('hunt pings the webhook with the number of drafts', async () => {
  const queue = createMemoryQueue();
  let msg;
  await runHunt({ ...base, queue, notifyUrl: 'https://discord.com/api/webhooks/x', fetch: async (u, init) => { msg = JSON.parse(init.body).content; return new Response('ok'); } });
  assert.match(msg, /5 new pin drafts/);
});

test('hunt respects the price range', async () => {
  const queue = createMemoryQueue();
  const { drafts } = await runHunt({ ...base, queue, prefs: { ...DEFAULT_PREFS, priceRange: { min: 15, max: 25 } } });
  for (const d of drafts) {
    const price = parseFloat(d.price);
    assert.ok(price >= 15 && price <= 25, d.price);
  }
});

test('hunt skips a product whose pin copy fails and backfills with the next best one', async () => {
  let n = 0;
  const flaky = { async chatJSON(system, user) { if (system.includes('[task:write]') && n++ === 0) throw new Error('AI hiccup'); return ai.chatJSON(system, user); } };
  const queue = createMemoryQueue();
  const logs = [];
  const { drafts } = await runHunt({ ...base, ai: flaky, queue, log: (m) => logs.push(m) });
  assert.equal(drafts.length, 5);
  assert.ok(logs.some((m) => /skipped .*AI hiccup/.test(m)));
});
