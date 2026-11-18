import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUiServer } from '../src/ui/server.js';
import { createAI } from '../src/ai/client.js';
import { createMemoryQueue } from '../src/sheets/queue.js';
import { DEFAULT_PREFS } from '../src/config.js';

const TOKEN = 'test-token-123';
const servers = [];
after(() => servers.forEach((s) => s.close()));

/** Start a dashboard on a free port in a temp folder. `ctx` overrides parts of the context each request gets. */
async function start({ env = '', ctx } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'ph-ui-'));
  writeFileSync(join(cwd, '.env'), env);
  const queue = createMemoryQueue({
    drafts: [{ status: 'NEEDS_IMAGE', product_key: 'mock:1', product: 'Lamp', pin_title: 'Cozy lamp', board: 'Decor', image_url: '' }],
  });
  const makeContext = ctx
    ? ({ log }) => ({
        cwd,
        env: {},
        prefs: { ...DEFAULT_PREFS, sources: ['mock'] },
        log,
        ai: () => createAI({ provider: 'mock' }),
        queue: () => queue,
        hasPinterest: () => false,
        pinterest: () => {
          throw new Error('Pinterest is not connected.');
        },
        ...ctx,
      })
    : undefined;
  const server = createUiServer({ cwd, token: TOKEN, makeContext });
  servers.push(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = (path, { method = 'GET', body, token = TOKEN, host = `127.0.0.1:${port}` } = {}) =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
      const req = request(
        { host: '127.0.0.1', port, path, method, headers: { host, ...(token ? { 'x-pinhunter-token': token } : {}), ...(data ? { 'content-type': 'application/json' } : {}) } },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json;
            try {
              json = JSON.parse(text);
            } catch {
              json = undefined;
            }
            resolve({ status: res.statusCode, headers: res.headers, text, json });
          });
        },
      );
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  return { cwd, port, call, queue };
}

const waitJob = async (call, id) => {
  for (let i = 0; i < 100; i++) {
    const r = await call(`/api/jobs/${id}`);
    if (r.json.status !== 'running') return r.json;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error('job did not finish');
};

test('API calls without the session token are refused', async () => {
  const { call } = await start();
  const r = await call('/api/settings', { token: null });
  assert.equal(r.status, 401);
});

test('requests for a foreign Host are refused (DNS rebinding)', async () => {
  const { call } = await start();
  const r = await call('/api/settings', { host: 'evil.example:80' });
  assert.equal(r.status, 403);
});

test('the page itself loads without a token', async () => {
  const { call } = await start();
  const r = await call('/', { token: null });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.match(r.text, /PinHunter/);
});

test('settings never send secret values to the browser', async () => {
  const { call } = await start({ env: 'AI_PROVIDER=gemini\nAI_API_KEY=supersecretvalueAXYw\nGOOGLE_SHEET_ID=sheet123\n' });
  const r = await call('/api/settings');
  assert.equal(r.status, 200);
  assert.ok(!r.text.includes('supersecretvalue'));
  const key = r.json.fields.find((f) => f.key === 'AI_API_KEY');
  assert.equal(key.set, true);
  assert.equal(key.hint, '…AXYw');
  assert.equal(r.json.fields.find((f) => f.key === 'GOOGLE_SHEET_ID').value, 'sheet123');
});

test('saving settings writes .env, keeps a secret sent empty, and saves prefs', async () => {
  const { call, cwd } = await start({ env: 'AI_API_KEY=keepme1234\n' });
  const r = await call('/api/settings', {
    method: 'PUT',
    body: { env: { AI_PROVIDER: 'grok', AI_API_KEY: '', AI_MODEL: 'grok-4' }, prefs: { niches: ['yoga', 'tea'], draftsPerRun: '7', bogus: 1 } },
  });
  assert.equal(r.status, 200);
  const envText = readFileSync(join(cwd, '.env'), 'utf8');
  assert.match(envText, /AI_PROVIDER=grok/);
  assert.match(envText, /AI_API_KEY=keepme1234/);
  const prefs = JSON.parse(readFileSync(join(cwd, 'pinhunter.config.json'), 'utf8'));
  assert.deepEqual(prefs.niches, ['yoga', 'tea']);
  assert.equal(prefs.draftsPerRun, 7);
  assert.equal(prefs.bogus, undefined);
});

test('saving settings rejects unknown keys and line breaks', async () => {
  const { call } = await start();
  assert.equal((await call('/api/settings', { method: 'PUT', body: { env: { PATH: 'x' } } })).status, 400);
  assert.equal((await call('/api/settings', { method: 'PUT', body: { env: { AI_MODEL: 'a\nEVIL=1' } } })).status, 400);
});

test('a pasted service-account JSON is checked and stored as base64', async () => {
  const { call, cwd } = await start();
  const sa = JSON.stringify({ client_email: 'bot@x.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n' }, null, 2);
  const r = await call('/api/settings', { method: 'PUT', body: { env: { GOOGLE_SERVICE_ACCOUNT_JSON: sa } } });
  assert.equal(r.status, 200);
  const line = readFileSync(join(cwd, '.env'), 'utf8').split('\n').find((l) => l.startsWith('GOOGLE_SERVICE_ACCOUNT_JSON='));
  const decoded = JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString('utf8'));
  assert.equal(decoded.client_email, 'bot@x.iam.gserviceaccount.com');
  const bad = await call('/api/settings', { method: 'PUT', body: { env: { GOOGLE_SERVICE_ACCOUNT_JSON: '{"nope":1}' } } });
  assert.equal(bad.status, 400);
});

test('drafts can be listed and only safe fields can be changed', async () => {
  const { call, queue } = await start({ ctx: {} });
  const list = await call('/api/drafts');
  assert.equal(list.json.drafts.length, 1);
  assert.equal(list.json.drafts[0].row, 2);
  const ok = await call('/api/drafts/2', { method: 'PATCH', body: { image_url: 'https://img.example/a.jpg', status: 'ready', affiliate_link: 'https://evil' } });
  assert.equal(ok.status, 200);
  assert.equal(queue.drafts[0].status, 'READY');
  assert.equal(queue.drafts[0].image_url, 'https://img.example/a.jpg');
  assert.equal(queue.drafts[0].affiliate_link, undefined);
  assert.equal((await call('/api/drafts/2', { method: 'PATCH', body: { status: 'DELETED' } })).status, 400);
});

test('a hunt job runs in the background, and a second job waits its turn', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const slowAI = createAI({ provider: 'mock' });
  const { call, queue } = await start({
    ctx: {
      ai: () => ({
        ...slowAI,
        async chatJSON(s, u) {
          await gate;
          return slowAI.chatJSON(s, u);
        },
      }),
    },
  });
  const first = await call('/api/jobs', { method: 'POST', body: { type: 'hunt' } });
  assert.equal(first.status, 202);
  const second = await call('/api/jobs', { method: 'POST', body: { type: 'publish' } });
  assert.equal(second.status, 409);
  release();
  const job = await waitJob(call, first.json.id);
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.result.count, 5);
  assert.ok(job.log.some((l) => /Added 5 draft/.test(l)));
  assert.equal(queue.drafts.length, 6);
});

test('a failing job reports its error instead of crashing the server', async () => {
  const { call } = await start({ ctx: {} });
  const r = await call('/api/jobs', { method: 'POST', body: { type: 'publish' } });
  const job = await waitJob(call, r.json.id);
  assert.equal(job.status, 'error');
  assert.match(job.error, /Pinterest is not connected/);
  assert.equal((await call('/api/overview')).status, 200);
});

test('bad JSON and unknown routes get clear errors', async () => {
  const { call } = await start({ ctx: {} });
  assert.equal((await call('/api/settings', { method: 'PUT', body: '{not json' })).status, 400);
  assert.equal((await call('/api/nope')).status, 404);
});

test('the Pinterest callback refuses a wrong state and saves nothing', async () => {
  const { call, cwd } = await start({ env: 'PINTEREST_CLIENT_ID=1\nPINTEREST_CLIENT_SECRET=2\n' });
  const r = await call('/callback?code=abc&state=forged', { token: null });
  assert.equal(r.status, 400);
  assert.ok(!readFileSync(join(cwd, '.env'), 'utf8').includes('PINTEREST_ACCESS_TOKEN'));
});

test('connect returns a Pinterest login link with the dashboard callback', async () => {
  const { call, port } = await start({ env: 'PINTEREST_CLIENT_ID=1484\nPINTEREST_CLIENT_SECRET=2\n' });
  const r = await call('/api/pinterest/connect');
  assert.equal(r.status, 200);
  const u = new URL(r.json.url);
  assert.equal(u.host, 'www.pinterest.com');
  assert.equal(u.searchParams.get('client_id'), '1484');
  assert.equal(u.searchParams.get('redirect_uri'), `http://localhost:${port}/callback`);
  assert.ok(u.searchParams.get('state'));
  assert.ok(existsSync(join(process.cwd(), 'src/ui/public/index.html')));
});

test('demo mode hunts and publishes with sample data, no accounts', async () => {
  const { demoMakeContext } = await import('../src/cli/ui.js');
  const cwd = mkdtempSync(join(tmpdir(), 'ph-demo-'));
  const server = createUiServer({ cwd, token: TOKEN, makeContext: demoMakeContext() });
  servers.push(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = (path, init = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { 'x-pinhunter-token': TOKEN, 'content-type': 'application/json' } }).then((r) => r.json());
  const { id } = await call('/api/jobs', { method: 'POST', body: JSON.stringify({ type: 'hunt' }) });
  const job = await waitJob((p) => call(p).then((json) => ({ json })), id);
  assert.equal(job.status, 'done', job.error);
  assert.equal((await call('/api/drafts')).drafts.length, 5);
  assert.equal((await call('/api/boards')).boards.length, 3);
});
