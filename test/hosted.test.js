import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUiServer } from '../src/ui/server.js';

const TOKEN = 'hosted-token-0123456789abcdef';
const PASSWORD = 'correct horse battery';
const PUBLIC = 'https://pins.example.com';
const servers = [];
after(() => servers.forEach((s) => s.close()));

async function start(env = 'PINTEREST_CLIENT_ID=1484\nPINTEREST_CLIENT_SECRET=2\n') {
  const cwd = mkdtempSync(join(tmpdir(), 'ph-hosted-'));
  writeFileSync(join(cwd, '.env'), env);
  const server = createUiServer({ cwd, token: TOKEN, publicUrl: PUBLIC, password: PASSWORD });
  servers.push(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = (path, { method = 'GET', body, cookie, csrf = true, host = 'pins.example.com', ip } = {}) =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const headers = { host, ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-pinhunter-csrf': '1' } : {}), ...(data ? { 'content-type': 'application/json' } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}) };
      const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  const login = async (ip = '10.0.0.1') => {
    const r = await call('/api/login', { method: 'POST', body: { password: PASSWORD }, ip });
    assert.equal(r.status, 200, r.text);
    return r.headers['set-cookie'][0].split(';')[0];
  };
  return { call, login, cwd };
}

test('hosted mode needs a real password', () => {
  assert.throws(() => createUiServer({ token: TOKEN, publicUrl: PUBLIC, password: 'short' }), /PINHUNTER_PASSWORD/);
});

test('hosted mode serves only its public host', async () => {
  const { call } = await start();
  assert.equal((await call('/')).status, 200);
  assert.equal((await call('/', { host: 'evil.example' })).status, 403);
});

test('the API is closed until you log in, and the cookie is locked down', async () => {
  const { call, login } = await start();
  assert.equal((await call('/api/settings')).status, 401);
  const s = await call('/api/session');
  assert.deepEqual(s.json, { hosted: true, loggedIn: false });
  const wrong = await call('/api/login', { method: 'POST', body: { password: 'nope' } });
  assert.equal(wrong.status, 401);
  const r = await call('/api/login', { method: 'POST', body: { password: PASSWORD } });
  const set = r.headers['set-cookie'][0];
  assert.match(set, /HttpOnly/);
  assert.match(set, /Secure/);
  assert.match(set, /SameSite=Strict/);
  const cookie = await login();
  assert.equal((await call('/api/settings', { cookie })).status, 200);
  assert.deepEqual((await call('/api/session', { cookie })).json, { hosted: true, loggedIn: true });
});

test('a forged or tampered cookie is refused', async () => {
  const { call, login } = await start();
  const cookie = await login();
  const [name, value] = cookie.split('=');
  const [exp, sig] = value.split('.');
  const later = `${name}=${Number(exp) + 999999}.${sig}`;
  assert.equal((await call('/api/settings', { cookie: later })).status, 401);
  assert.equal((await call('/api/settings', { cookie: 'ph_session=1.abc' })).status, 401);
});

test('changes made with the cookie need the CSRF header', async () => {
  const { call, login } = await start();
  const cookie = await login();
  const r = await call('/api/settings', { method: 'PUT', body: { env: { AI_MODEL: 'x' } }, cookie, csrf: false });
  assert.equal(r.status, 403);
  assert.equal((await call('/api/settings', { method: 'PUT', body: { env: { AI_MODEL: 'x' } }, cookie })).status, 200);
});

test('too many wrong passwords lock the login for a while', async () => {
  const { call } = await start();
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/login', { method: 'POST', body: { password: 'bad' }, ip: '9.9.9.9' })).status, 401);
  const locked = await call('/api/login', { method: 'POST', body: { password: PASSWORD }, ip: '9.9.9.9' });
  assert.equal(locked.status, 429);
  assert.equal((await call('/api/login', { method: 'POST', body: { password: PASSWORD }, ip: '8.8.8.8' })).status, 200);
});

test('Pinterest connect uses the public callback', async () => {
  const { call, login } = await start();
  const cookie = await login();
  const r = await call('/api/pinterest/connect', { cookie });
  assert.equal(new URL(r.json.url).searchParams.get('redirect_uri'), 'https://pins.example.com/callback');
});

test('the hosted image preview never reads files on the server', async () => {
  const { call, login } = await start();
  const cookie = await login();
  const r = await call(`/api/image?url=${encodeURIComponent('.env')}`, { cookie });
  assert.equal(r.status, 422);
  assert.match(r.json.error, /link/i);
});

test('logging out clears the cookie', async () => {
  const { call, login } = await start();
  const cookie = await login();
  const r = await call('/api/logout', { method: 'POST', cookie });
  assert.equal(r.status, 200);
  assert.match(r.headers['set-cookie'][0], /Max-Age=0/);
});
