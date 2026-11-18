import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncate, withDisclosure } from '../src/util/text.js';

test('truncate leaves short text alone and cuts long text on a word with an ellipsis', () => {
  assert.equal(truncate('hello', 10), 'hello');
  const out = truncate('the quick brown fox jumps over', 15);
  assert.ok(out.length <= 15, out);
  assert.ok(out.endsWith('…'), out);
});

test('withDisclosure appends the disclosure once', () => {
  const d = '#affiliate — I may earn a commission.';
  const out = withDisclosure('Great mug for coffee lovers.', d);
  assert.ok(out.endsWith(d));
  assert.equal(withDisclosure(out, d), out, 'not added twice');
});

test('withDisclosure keeps the disclosure when truncating to 800', () => {
  const d = '#affiliate — I may earn a commission.';
  const out = withDisclosure('word '.repeat(400), d, 800);
  assert.ok(out.length <= 800, `length ${out.length}`);
  assert.ok(out.endsWith(d));
});
