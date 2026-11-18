import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAI, extractJSON } from '../src/ai/client.js';

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
const openaiReply = (text) => ({ choices: [{ message: { content: text } }] });
const anthropicReply = (text) => ({ content: [{ type: 'text', text }] });

test('extractJSON reads fenced JSON and JSON wrapped in prose', () => {
  assert.deepEqual(extractJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJSON('Sure! Here it is: {"a":[1,2]} hope that helps'), { a: [1, 2] });
  assert.deepEqual(extractJSON('[{"k":"x"}]'), [{ k: 'x' }]);
  assert.throws(() => extractJSON('no json here'));
});

test('openai-compatible provider (gemini preset) uses bearer auth and the preset base URL', async () => {
  const f = fakeFetch([openaiReply('{"ok":true}')]);
  const ai = createAI({ provider: 'gemini', apiKey: 'k1', model: 'm1' }, f);
  assert.deepEqual(await ai.chatJSON('sys', 'user'), { ok: true });
  assert.match(f.calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions$/);
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer k1');
  assert.equal(f.calls[0].body.model, 'm1');
});

test('anthropic provider uses x-api-key and the messages endpoint', async () => {
  const f = fakeFetch([anthropicReply('{"ok":1}')]);
  const ai = createAI({ provider: 'anthropic', apiKey: 'k2', model: 'claude-x' }, f);
  assert.deepEqual(await ai.chatJSON('sys', 'user'), { ok: 1 });
  assert.equal(f.calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(f.calls[0].init.headers['x-api-key'], 'k2');
  assert.equal(f.calls[0].init.headers['anthropic-version'], '2023-06-01');
  assert.match(f.calls[0].body.system, /^sys\b/);
});

test('chatJSON retries once on invalid JSON, then succeeds', async () => {
  const f = fakeFetch([openaiReply('oops not json'), openaiReply('{"x":2}')]);
  const ai = createAI({ provider: 'openai', apiKey: 'k', model: 'm' }, f);
  assert.deepEqual(await ai.chatJSON('s', 'u'), { x: 2 });
  assert.equal(f.calls.length, 2);
});

test('chatJSON throws after two invalid replies', async () => {
  const f = fakeFetch([openaiReply('nope'), openaiReply('still nope')]);
  const ai = createAI({ provider: 'openai', apiKey: 'k', model: 'm' }, f);
  await assert.rejects(ai.chatJSON('s', 'u'), /JSON/);
});

test('custom base URL overrides the preset (e.g. a local Ollama)', async () => {
  const f = fakeFetch([openaiReply('{}')]);
  const ai = createAI({ provider: 'ollama', model: 'llama3', baseUrl: 'http://box:11434/v1/' }, f);
  await ai.chatJSON('s', 'u');
  assert.equal(f.calls[0].url, 'http://box:11434/v1/chat/completions');
});

test('unknown provider gives a helpful error', () => {
  assert.throws(() => createAI({ provider: 'nope', model: 'm' }), /Unknown AI_PROVIDER "nope"/);
});

function statusFetch(statuses, okText = '{"ok":true}') {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const s = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    if (s === 'net') throw new TypeError('fetch failed');
    const body = s === 200 ? openaiReply(okText) : { error: { code: s, message: 'busy' } };
    return new Response(JSON.stringify(body), { status: s, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

test('chatJSON retries 503/429 and network errors with growing waits, then succeeds', async () => {
  const waits = [];
  const f = statusFetch([503, 429, 'net', 200]);
  const ai = createAI({ provider: 'gemini', apiKey: 'k', model: 'm', sleep: async (ms) => waits.push(ms) }, f);
  assert.deepEqual(await ai.chatJSON('sys', 'user'), { ok: true });
  assert.equal(f.calls.length, 4);
  assert.equal(waits.length, 3);
  assert.ok(waits[0] > 0 && waits[1] > waits[0] && waits[2] > waits[1]);
});

test('chatJSON does not retry a 400/401 error', async () => {
  const waits = [];
  const f = statusFetch([401]);
  const ai = createAI({ provider: 'gemini', apiKey: 'k', model: 'm', sleep: async (ms) => waits.push(ms) }, f);
  await assert.rejects(ai.chatJSON('sys', 'user'), /HTTP 401/);
  assert.equal(f.calls.length, 1);
  assert.equal(waits.length, 0);
});

test('chatJSON gives up after the retry limit and reports the last error', async () => {
  const f = statusFetch([503]);
  const ai = createAI({ provider: 'gemini', apiKey: 'k', model: 'm', retries: 2, sleep: async () => {} }, f);
  await assert.rejects(ai.chatJSON('sys', 'user'), /HTTP 503/);
  assert.equal(f.calls.length, 3);
});

test('each AI request carries a timeout signal', async () => {
  const f = statusFetch([200]);
  const ai = createAI({ provider: 'gemini', apiKey: 'k', model: 'm', timeoutMs: 5000 }, f);
  await ai.chatJSON('sys', 'user');
  assert.ok(f.calls[0].init.signal instanceof AbortSignal);
});
