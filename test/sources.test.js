import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signAliExpress, parseAliExpress, aliexpressSource } from '../src/sources/aliexpress.js';
import { parseAmazon, withTag, amazonSource } from '../src/sources/amazon.js';
import { feedSource } from '../src/sources/feed.js';
import { getSources, huntAll } from '../src/sources/index.js';

test('AliExpress signature = uppercase HMAC-SHA256 of sorted key+value pairs', () => {
  const params = { b: '2', a: '1', sign_method: 'sha256' };
  const expected = createHmac('sha256', 'secret').update('a1b2sign_methodsha256').digest('hex').toUpperCase();
  assert.equal(signAliExpress(params, 'secret'), expected);
});

const aliResponse = {
  aliexpress_affiliate_product_query_response: {
    resp_result: {
      resp_code: 200,
      result: {
        products: {
          product: [
            { product_id: 1005001, product_title: 'LED Sunset Lamp', promotion_link: 'https://s.click.aliexpress.com/e/_abc', product_detail_url: 'https://www.aliexpress.com/item/1005001.html', target_sale_price: '12.99', target_sale_price_currency: 'USD', evaluate_rate: '96.4%', lastest_volume: 5321, commission_rate: '8.0%', product_main_image_url: 'https://ae01.alicdn.com/x.jpg', first_level_category_name: 'Home & Garden' },
            { product_id: 1005002, product_title: 'No promo link', product_detail_url: 'https://www.aliexpress.com/item/1005002.html' },
          ],
        },
      },
    },
  },
};

test('parseAliExpress normalizes products and drops ones without an affiliate link', () => {
  const ps = parseAliExpress(aliResponse, 'sunset lamp');
  assert.equal(ps.length, 1);
  const p = ps[0];
  assert.equal(p.source, 'aliexpress');
  assert.equal(p.sourceId, '1005001');
  assert.equal(p.affiliateUrl, 'https://s.click.aliexpress.com/e/_abc');
  assert.equal(p.price, 12.99);
  assert.equal(p.salesVolume, 5321);
  assert.ok(Math.abs(p.commissionRate - 0.08) < 1e-9);
  assert.equal(p.keyword, 'sunset lamp');
});

test('parseAliExpress throws a readable error on an API error', () => {
  assert.throws(() => parseAliExpress({ error_response: { code: 'IncompleteSignature', msg: 'bad sign' } }), /IncompleteSignature.*bad sign/);
});

test('aliexpress source sends a signed request with the tracking id', async () => {
  let seen;
  const fetchImpl = async (url) => { seen = new URL(url); return new Response(JSON.stringify(aliResponse)); };
  const src = aliexpressSource({ ALIEXPRESS_APP_KEY: 'k', ALIEXPRESS_APP_SECRET: 's', ALIEXPRESS_TRACKING_ID: 't' }, { market: { country: 'US', currency: 'USD', language: 'EN' }, priceRange: {} }, fetchImpl);
  const ps = await src.hunt(['sunset lamp']);
  assert.equal(ps.length, 1);
  assert.equal(seen.host, 'api-sg.aliexpress.com');
  assert.equal(seen.searchParams.get('method'), 'aliexpress.affiliate.product.query');
  assert.equal(seen.searchParams.get('tracking_id'), 't');
  assert.match(seen.searchParams.get('sign'), /^[0-9A-F]{64}$/);
});

const amazonResponse = {
  searchResult: {
    items: [
      {
        asin: 'B0TEST1234',
        detailPageURL: 'https://www.amazon.com/dp/B0TEST1234?tag=me-20',
        itemInfo: { title: { displayValue: 'Linen Throw Pillow Covers' }, classifications: { productGroup: { displayValue: 'Home' } } },
        offersV2: { listings: [{ price: { money: { amount: 19.99, currency: 'USD' } } }] },
        images: { primary: { large: { url: 'https://m.media-amazon.com/x.jpg' } } },
      },
    ],
  },
};

test('parseAmazon normalizes a Creators API search result', () => {
  const [p] = parseAmazon(amazonResponse, 'me-20', 'pillow covers');
  assert.equal(p.source, 'amazon');
  assert.equal(p.sourceId, 'B0TEST1234');
  assert.equal(p.title, 'Linen Throw Pillow Covers');
  assert.equal(p.price, 19.99);
  assert.equal(p.category, 'Home');
  assert.match(p.affiliateUrl, /tag=me-20/);
});

test('withTag adds the partner tag when it is missing', () => {
  assert.equal(withTag('https://www.amazon.com/dp/B01', 'me-20'), 'https://www.amazon.com/dp/B01?tag=me-20');
  assert.equal(withTag('https://www.amazon.com/dp/B01?tag=me-20', 'me-20'), 'https://www.amazon.com/dp/B01?tag=me-20');
});

test('amazon source fetches an LwA token for v3 credentials then searches', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/auth/o2/token')) return new Response(JSON.stringify({ access_token: 'tok' }));
    return new Response(JSON.stringify(amazonResponse));
  };
  const src = amazonSource({ AMAZON_CREDENTIAL_ID: 'id', AMAZON_CREDENTIAL_SECRET: 'sec', AMAZON_CREDENTIAL_VERSION: '3.1', AMAZON_PARTNER_TAG: 'me-20' }, { market: { country: 'US' } }, fetchImpl);
  const ps = await src.hunt(['pillow']);
  assert.equal(ps.length, 1);
  assert.equal(calls[0].url, 'https://api.amazon.com/auth/o2/token');
  assert.equal(calls[1].url, 'https://creatorsapi.amazon/catalog/v1/searchItems');
  assert.equal(calls[1].init.headers.authorization, 'Bearer tok');
  assert.equal(calls[1].init.headers['x-marketplace'], 'www.amazon.com');
  assert.equal(JSON.parse(calls[1].init.body).partnerTag, 'me-20');
});

test('feed source turns Products-tab rows into products and skips empty links', async () => {
  const queue = { async readProducts() { return [{ affiliate_link: 'https://gumroad.com/l/x?a=1', title: 'Notion Planner', price: '9', currency: 'USD', notes: 'digital download' }, { affiliate_link: '', title: 'empty' }]; } };
  const ps = await feedSource({ queue }).hunt([]);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].source, 'feed');
  assert.equal(ps[0].sourceId, 'https://gumroad.com/l/x?a=1');
  assert.equal(ps[0].affiliateUrl, 'https://gumroad.com/l/x?a=1');
});

test('getSources skips sources with missing credentials and reports why', () => {
  const warnings = [];
  const sources = getSources(['aliexpress', 'amazon', 'mock'], { env: {}, prefs: {}, fetch, queue: null, log: (m) => warnings.push(m) });
  assert.deepEqual(sources.map((s) => s.name), ['mock']);
  assert.equal(warnings.length, 2);
});

test('huntAll keeps going when one source throws', async () => {
  const bad = { name: 'bad', async hunt() { throw new Error('boom'); } };
  const good = { name: 'good', async hunt() { return [{ source: 'good', sourceId: '1', title: 'x', affiliateUrl: 'u' }]; } };
  const { products, errors } = await huntAll([bad, good], ['k'], { log: () => {} });
  assert.equal(products.length, 1);
  assert.deepEqual(errors, [{ source: 'bad', message: 'boom' }]);
});
