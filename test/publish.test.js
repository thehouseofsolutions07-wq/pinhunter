import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPublish, resolveBoard } from '../src/publish.js';
import { directImageUrl, loadImage } from '../src/pinterest/image.js';
import { createPinterest } from '../src/pinterest/client.js';
import { createMemoryQueue } from '../src/sheets/queue.js';
import { DEFAULT_PREFS } from '../src/config.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const imageFetch = async (url) =>
  url.includes('bad') ? new Response('<html>sign in</html>', { headers: { 'content-type': 'text/html' } }) : new Response(PNG, { headers: { 'content-type': 'application/octet-stream' } });

const boards = [{ id: '111', name: 'Home Decor Ideas' }, { id: '222', name: 'Kitchen Finds' }];
function fakePinterest() {
  const pins = [];
  return { pins, async listBoards() { return boards; }, async createPin(p) { pins.push(p); return { id: `p${pins.length}`, url: `https://www.pinterest.com/pin/p${pins.length}/` }; } };
}
const draft = (over = {}) => ({ status: 'READY', product_key: 'k', affiliate_link: 'https://aff.example/x', board: 'Kitchen Finds', pin_title: 'Title', pin_description: 'Desc', alt_text: 'Alt', image_url: 'https://img.example/ok.png', ...over });
const prefs = { ...DEFAULT_PREFS, postDelaySeconds: 0 };
const noSleep = async () => {};

test('directImageUrl converts Google Drive and Dropbox share links', () => {
  assert.equal(directImageUrl('https://drive.google.com/file/d/ABC123/view?usp=sharing'), 'https://drive.google.com/uc?export=download&id=ABC123');
  assert.equal(directImageUrl('https://drive.google.com/open?id=XYZ'), 'https://drive.google.com/uc?export=download&id=XYZ');
  assert.equal(directImageUrl('https://www.dropbox.com/s/k/pin.jpg?dl=0'), 'https://www.dropbox.com/s/k/pin.jpg?dl=1');
  assert.equal(directImageUrl('https://i.imgur.com/a.png'), 'https://i.imgur.com/a.png');
});

test('loadImage sniffs PNG bytes even when the server says octet-stream', async () => {
  const img = await loadImage('https://img.example/ok', imageFetch);
  assert.equal(img.contentType, 'image/png');
  assert.equal(img.base64, PNG.toString('base64'));
});

test('loadImage asks for JPG/PNG only, so image CDNs do not send WebP', async () => {
  // AliExpress and other CDNs answer "Accept: */*" with WebP, which Pinterest rejects.
  let sent;
  const negotiating = async (url, init = {}) => {
    sent = new Headers(init.headers).get('accept') || '*/*';
    const webp = Buffer.from('RIFF\0\0\0\0WEBPVP8X');
    return /\*\/\*|webp/.test(sent) ? new Response(webp, { headers: { 'content-type': 'image/webp' } }) : new Response(PNG, { headers: { 'content-type': 'image/png' } });
  };
  const img = await loadImage('https://cdn.example/photo.jpg', negotiating);
  assert.equal(img.contentType, 'image/png');
  assert.doesNotMatch(sent, /\*\/\*|webp/);
});

test('loadImage explains when a link is a web page instead of an image', async () => {
  await assert.rejects(loadImage('https://drive.google.com/file/d/bad/view', imageFetch), /not an image.*Anyone with the link/s);
});

test('resolveBoard matches id, exact name, or name in any case', () => {
  assert.equal(resolveBoard('222', boards).id, '222');
  assert.equal(resolveBoard('kitchen finds', boards).id, '222');
  assert.equal(resolveBoard('  Home Decor Ideas ', boards).id, '111');
  assert.equal(resolveBoard('nope', boards), null);
});

test('publish posts READY rows only and writes back POSTED + pin URL', async () => {
  const queue = createMemoryQueue({ drafts: [draft(), draft({ status: 'NEEDS_IMAGE', image_url: '' }), draft({ status: ' ready ' })] });
  const pinterest = fakePinterest();
  const r = await runPublish({ queue, pinterest, prefs, fetch: imageFetch, log: () => {}, sleep: noSleep });
  assert.equal(r.posted, 2);
  assert.equal(pinterest.pins.length, 2);
  assert.equal(pinterest.pins[0].board_id, '222');
  assert.equal(pinterest.pins[0].link, 'https://aff.example/x');
  assert.ok(pinterest.pins[0].description.endsWith(DEFAULT_PREFS.disclosure), 'disclosure re-added at publish time');
  assert.equal(queue.drafts[0].status, 'POSTED');
  assert.equal(queue.drafts[0].pin_url, 'https://www.pinterest.com/pin/p1/');
  assert.equal(queue.drafts[1].status, 'NEEDS_IMAGE');
});

test('publish marks an unknown board as ERROR and lists the real boards', async () => {
  const queue = createMemoryQueue({ drafts: [draft({ board: 'Gadgets' })] });
  const r = await runPublish({ queue, pinterest: fakePinterest(), prefs, fetch: imageFetch, log: () => {}, sleep: noSleep });
  assert.equal(r.failed, 1);
  assert.equal(queue.drafts[0].status, 'ERROR');
  assert.match(queue.drafts[0].error, /Gadgets.*Home Decor Ideas.*Kitchen Finds/);
});

test('publish marks READY rows without an image as ERROR instead of crashing', async () => {
  const queue = createMemoryQueue({ drafts: [draft({ image_url: '' })] });
  await runPublish({ queue, pinterest: fakePinterest(), prefs, fetch: imageFetch, log: () => {}, sleep: noSleep });
  assert.equal(queue.drafts[0].status, 'ERROR');
  assert.match(queue.drafts[0].error, /image_url/);
});

test('publish marks a non-image link as ERROR with a helpful message', async () => {
  const queue = createMemoryQueue({ drafts: [draft({ image_url: 'https://drive.google.com/file/d/bad/view' })] });
  await runPublish({ queue, pinterest: fakePinterest(), prefs, fetch: imageFetch, log: () => {}, sleep: noSleep });
  assert.equal(queue.drafts[0].status, 'ERROR');
  assert.match(queue.drafts[0].error, /not an image/);
});

test('publish respects maxPostsPerRun and dry-run changes nothing', async () => {
  const queue = createMemoryQueue({ drafts: [draft(), draft(), draft()] });
  const pinterest = fakePinterest();
  const r = await runPublish({ queue, pinterest, prefs: { ...prefs, maxPostsPerRun: 2 }, fetch: imageFetch, log: () => {}, sleep: noSleep });
  assert.equal(r.posted, 2);
  assert.equal(queue.drafts[2].status, 'READY');
  const q2 = createMemoryQueue({ drafts: [draft()] });
  const p2 = fakePinterest();
  await runPublish({ queue: q2, pinterest: p2, prefs, fetch: imageFetch, log: () => {}, sleep: noSleep, dryRun: true });
  assert.equal(p2.pins.length, 0);
  assert.equal(q2.drafts[0].status, 'READY');
});

test('pinterest client refreshes the token on 401 and sends a base64 image pin', async () => {
  const calls = [];
  let first = true;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r2' }));
    if (first) { first = false; return new Response('{"code":2}', { status: 401 }); }
    return new Response(JSON.stringify({ id: '987' }));
  };
  const saved = [];
  const pt = createPinterest({ accessToken: 'old', refreshToken: 'r1', clientId: 'c', clientSecret: 's', onTokens: (t) => saved.push(t) }, fetchImpl);
  const pin = await pt.createPin({ board_id: '1', title: 't', description: 'd', link: 'https://x', alt_text: 'a', image: { contentType: 'image/png', base64: 'AAA' } });
  assert.equal(pin.url, 'https://www.pinterest.com/pin/987/');
  const post = calls.at(-1);
  assert.equal(post.init.headers.authorization, 'Bearer new');
  const body = JSON.parse(post.init.body);
  assert.deepEqual(body.media_source, { source_type: 'image_base64', content_type: 'image/png', data: 'AAA' });
  assert.equal(saved[0].refresh_token, 'r2');
});

test('pinterest sandbox mode uses the sandbox host', async () => {
  let seen;
  const pt = createPinterest({ accessToken: 't', sandbox: true }, async (url) => { seen = url; return new Response(JSON.stringify({ items: [] })); });
  await pt.listBoards();
  assert.match(seen, /^https:\/\/api-sandbox\.pinterest\.com\/v5\/boards/);
});
