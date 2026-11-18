import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { makeJWT, getGoogleToken } from '../src/sheets/auth.js';
import { COLUMNS, normStatus, draftToRow, rowToObject, createMemoryQueue, createSheetQueue, colLetter } from '../src/sheets/queue.js';
import { notify } from '../src/notify.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { client_email: 'bot@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };

test('makeJWT builds a valid RS256 token for the Sheets scope', () => {
  const jwt = makeJWT(sa, 1_700_000_000);
  const [h, p, s] = jwt.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(JSON.parse(Buffer.from(h, 'base64url').toString()).alg, 'RS256');
  assert.equal(payload.iss, sa.client_email);
  assert.equal(payload.scope, 'https://www.googleapis.com/auth/spreadsheets');
  assert.equal(payload.exp - payload.iat, 3600);
  const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'));
  assert.ok(ok, 'signature verifies');
});

test('getGoogleToken exchanges the JWT for an access token', async () => {
  let body;
  const fetchImpl = async (url, init) => { body = new URLSearchParams(init.body); return new Response(JSON.stringify({ access_token: 'ya29.x', expires_in: 3599 })); };
  assert.equal(await getGoogleToken(sa, fetchImpl), 'ya29.x');
  assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
});

test('normStatus tolerates case and spaces', () => {
  assert.equal(normStatus(' ready '), 'READY');
  assert.equal(normStatus('needs image'), 'NEEDS_IMAGE');
  assert.equal(normStatus(undefined), '');
});

test('draft <-> row round trip keeps every column in order', () => {
  const d = Object.fromEntries(COLUMNS.map((c, i) => [c, `v${i}`]));
  assert.deepEqual(rowToObject(COLUMNS, draftToRow(d)), d);
  assert.equal(COLUMNS[1], 'status');
  assert.equal(COLUMNS.length, 17);
});

test('colLetter maps indexes to spreadsheet columns', () => {
  assert.equal(colLetter(0), 'A');
  assert.equal(colLetter(16), 'Q');
  assert.equal(colLetter(26), 'AA');
});

test('memory queue appends, reads with row numbers and updates', async () => {
  const q = createMemoryQueue();
  await q.appendDrafts([{ product_key: 'a:1', status: 'NEEDS_IMAGE' }]);
  const [d] = await q.readDrafts();
  assert.equal(d.row, 2);
  await q.updateDraft(d.row, { status: 'POSTED', pin_url: 'u' });
  assert.equal((await q.readDrafts())[0].status, 'POSTED');
});

test('sheet queue appends RAW values (so product titles can never become formulas)', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    return new Response(JSON.stringify({}));
  };
  const q = createSheetQueue({ sheetId: 'SHEET', serviceAccount: sa }, fetchImpl);
  await q.appendDrafts([{ product: '=HYPERLINK("x")', status: 'NEEDS_IMAGE' }]);
  const append = calls.find((c) => c.url.includes(':append'));
  assert.match(append.url, /valueInputOption=RAW/);
  assert.match(decodeURIComponent(append.url), /'Drafts'!A1/);
  assert.equal(append.init.headers.authorization, 'Bearer t');
  assert.equal(JSON.parse(append.init.body).values[0][COLUMNS.indexOf('product')], '=HYPERLINK("x")');
});

test('sheet queue reads drafts by header name and gives 1-based row numbers', async () => {
  const header = COLUMNS;
  const row = COLUMNS.map((c) => (c === 'status' ? 'ready' : c === 'product_key' ? 'k:1' : ''));
  const fetchImpl = async (url) => {
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    return new Response(JSON.stringify({ values: [header, [], row] }));
  };
  const q = createSheetQueue({ sheetId: 'S', serviceAccount: sa }, fetchImpl);
  const drafts = await q.readDrafts();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].row, 3);
  assert.equal(drafts[0].product_key, 'k:1');
});

test('notify sends Discord "content" and Slack "text"', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response('ok'); };
  await notify('https://discord.com/api/webhooks/1/x', 'hi', fetchImpl);
  await notify('https://hooks.slack.com/services/x', 'hi', fetchImpl);
  assert.deepEqual(sent[0].body, { content: 'hi' });
  assert.deepEqual(sent[1].body, { text: 'hi' });
});

test('notify does nothing without a URL', async () => {
  await notify('', 'hi', () => { throw new Error('should not fetch'); });
});
