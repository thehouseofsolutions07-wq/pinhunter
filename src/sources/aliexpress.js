import { createHmac } from 'node:crypto';
import { fetchJSON } from '../util/http.js';
import { normalizeProduct } from '../product.js';

const ENDPOINT = 'https://api-sg.aliexpress.com/sync';
const METHOD = 'aliexpress.affiliate.product.query';

/** AliExpress Open Platform signature: HMAC-SHA256(secret, sorted "key+value" pairs), uppercase hex. */
export function signAliExpress(params, secret) {
  const base = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return createHmac('sha256', secret).update(base, 'utf8').digest('hex').toUpperCase();
}

export function parseAliExpress(data, keyword = '') {
  if (data?.error_response) {
    const e = data.error_response;
    throw new Error(`AliExpress API error ${e.code}: ${e.msg || e.sub_msg || ''}`.trim());
  }
  const resp = data?.aliexpress_affiliate_product_query_response?.resp_result;
  if (!resp) throw new Error('AliExpress: unexpected response shape');
  if (resp.resp_code && Number(resp.resp_code) !== 200) throw new Error(`AliExpress: ${resp.resp_code} ${resp.resp_msg || ''}`.trim());
  const list = resp.result?.products?.product || [];
  return list
    .filter((p) => p.promotion_link) // no affiliate link = no commission; never pin it
    .map((p) =>
      normalizeProduct({
        source: 'aliexpress',
        sourceId: p.product_id,
        title: p.product_title,
        productUrl: p.product_detail_url,
        affiliateUrl: p.promotion_link,
        price: p.target_sale_price ?? p.sale_price,
        currency: p.target_sale_price_currency ?? p.sale_price_currency,
        rating: p.evaluate_rate,
        salesVolume: p.lastest_volume,
        commissionRate: p.commission_rate,
        category: p.second_level_category_name || p.first_level_category_name,
        imageRefUrl: p.product_main_image_url,
        keyword,
      }),
    );
}

export function aliexpressSource(env, prefs, fetchImpl = fetch) {
  const { ALIEXPRESS_APP_KEY: appKey, ALIEXPRESS_APP_SECRET: secret, ALIEXPRESS_TRACKING_ID: trackingId } = env;
  return {
    name: 'aliexpress',
    async hunt(keywords) {
      const out = [];
      for (const keyword of keywords) {
        const params = {
          app_key: appKey,
          method: METHOD,
          timestamp: String(Date.now()),
          sign_method: 'sha256',
          format: 'json',
          v: '2.0',
          keywords: keyword,
          page_no: '1',
          page_size: '20',
          sort: 'LAST_VOLUME_DESC',
          target_currency: prefs.market?.currency || 'USD',
          target_language: prefs.market?.language || 'EN',
          ship_to_country: prefs.market?.country || 'US',
          tracking_id: trackingId,
          min_sale_price: prefs.priceRange?.min ? String(prefs.priceRange.min) : undefined,
          max_sale_price: prefs.priceRange?.max ? String(prefs.priceRange.max) : undefined,
        };
        params.sign = signAliExpress(params, secret);
        const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
        const data = await fetchJSON(fetchImpl, `${ENDPOINT}?${qs}`, { method: 'POST' });
        out.push(...parseAliExpress(data, keyword));
      }
      return out;
    },
  };
}
aliexpressSource.required = ['ALIEXPRESS_APP_KEY', 'ALIEXPRESS_APP_SECRET', 'ALIEXPRESS_TRACKING_ID'];
