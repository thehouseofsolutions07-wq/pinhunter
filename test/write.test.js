import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writePin } from '../src/hunt/write.js';
import { planKeywords } from '../src/hunt/plan.js';
import { rateFit } from '../src/hunt/rate.js';
import { DEFAULT_PREFS } from '../src/config.js';

const product = { source: 'mock', sourceId: '1', title: 'Ceramic Pour-Over Coffee Set', category: 'kitchen', price: 29.99, currency: 'USD', affiliateUrl: 'https://example.com/a' };

function stubAI(reply) {
  const calls = [];
  return { calls, async chatJSON(system, user) { calls.push({ system, user }); return typeof reply === 'function' ? reply(system, user) : reply; } };
}

test('writePin enforces Pinterest limits and appends the disclosure', async () => {
  const ai = stubAI({ board: 'Kitchen', pin_title: 'T'.repeat(300), pin_description: 'word '.repeat(400), alt_text: 'A'.repeat(900), image_brief: 'brief' });
  const pin = await writePin(ai, product, DEFAULT_PREFS, ['Kitchen']);
  assert.ok(pin.pin_title.length <= 100);
  assert.ok(pin.pin_description.length <= 800);
  assert.ok(pin.pin_description.endsWith(DEFAULT_PREFS.disclosure));
  assert.ok(pin.alt_text.length <= 500);
  assert.equal(pin.board, 'Kitchen');
});

test('writePin uses the niche->board mapping when the AI picks a board that does not exist', async () => {
  const ai = stubAI({ board: 'Made Up Board', pin_title: 't', pin_description: 'd', alt_text: 'a', image_brief: 'b' });
  const prefs = { ...DEFAULT_PREFS, boards: { kitchen: 'Kitchen Finds' } };
  const pin = await writePin(ai, { ...product, niche: 'kitchen' }, prefs, ['Kitchen Finds', 'Decor']);
  assert.equal(pin.board, 'Kitchen Finds');
});

test('writePin never puts a link in the AI prompt other than the product it was given', async () => {
  const ai = stubAI({ pin_title: 't', pin_description: 'd', alt_text: 'a', image_brief: 'b' });
  await writePin(ai, product, DEFAULT_PREFS, []);
  assert.match(ai.calls[0].system, /\[task:write\]/);
  assert.match(ai.calls[0].user, /Ceramic Pour-Over Coffee Set/);
});

test('planKeywords merges fixed keywords with AI keywords and caps the total', async () => {
  const ai = stubAI({ keywords: ['a', 'b', 'c', 'd'] });
  const kws = await planKeywords(ai, { ...DEFAULT_PREFS, keywords: ['fixed'], keywordsPerRun: 3 }, new Date('2026-11-18'));
  assert.deepEqual(kws, ['fixed', 'a', 'b']);
  assert.match(ai.calls[0].user, /November/);
});

test('planKeywords falls back to niches if the AI fails', async () => {
  const ai = { async chatJSON() { throw new Error('down'); } };
  const kws = await planKeywords(ai, { ...DEFAULT_PREFS, niches: ['yoga'], keywords: [] }, new Date());
  assert.deepEqual(kws, ['yoga']);
});

test('rateFit returns a map of key -> {fit, why}, clamping fit to 0..10', async () => {
  const ai = stubAI({ ratings: [{ key: 'mock:1', fit: 14, why: 'great' }] });
  const m = await rateFit(ai, [product], DEFAULT_PREFS);
  assert.deepEqual(m.get('mock:1'), { fit: 10, why: 'great' });
});

test('rateFit gives neutral fit 5 when the AI fails', async () => {
  const ai = { async chatJSON() { throw new Error('down'); } };
  const m = await rateFit(ai, [product], DEFAULT_PREFS);
  assert.equal(m.get('mock:1').fit, 5);
});
