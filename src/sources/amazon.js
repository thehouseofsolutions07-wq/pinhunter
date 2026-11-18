/**
 * Amazon Creators API (successor of PA-API 5, which Amazon retired in 2026). BETA:
 * request shapes follow Amazon's migration guide and the open-source "vacuum" client;
 * please open an issue if Amazon changes them.
 */
import { fetchJSON } from '../util/http.js';
import { normalizeProduct } from '../product.js';

const API = 'https://creatorsapi.amazon/catalog/v1';
const AUTH = {
  '2.1': 'https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token',
  '2.2': 'https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token',
  '2.3': 'https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token',
  '3.1': 'https://api.amazon.com/auth/o2/token',
  '3.2': 'https://api.amazon.co.uk/auth/o2/token',
  '3.3': 'https://api.amazon.co.jp/auth/o2/token',
};
const MARKETPLACES = {
  US: 'www.amazon.com', CA: 'www.amazon.ca', MX: 'www.amazon.com.mx', BR: 'www.amazon.com.br',
  UK: 'www.amazon.co.uk', GB: 'www.amazon.co.uk', DE: 'www.amazon.de', FR: 'www.amazon.fr', IT: 'www.amazon.it',
  ES: 'www.amazon.es', NL: 'www.amazon.nl', SE: 'www.amazon.se', PL: 'www.amazon.pl', BE: 'www.amazon.com.be',
  TR: 'www.amazon.com.tr', AE: 'www.amazon.ae', SA: 'www.amazon.sa', EG: 'www.amazon.eg', IN: 'www.amazon.in',
  JP: 'www.amazon.co.jp', AU: 'www.amazon.com.au', SG: 'www.amazon.sg',
};
const RESOURCES = ['itemInfo.title', 'itemInfo.classifications', 'offersV2.listings.price', 'images.primary.large', 'browseNodeInfo.websiteSalesRank'];

export function withTag(url, tag) {
  if (!url || !tag) return url;
  const u = new URL(url);
  if (!u.searchParams.get('tag')) u.searchParams.set('tag', tag);
  return u.toString();
}

export function parseAmazon(data, tag, keyword = '') {
  const items = data?.searchResult?.items || data?.SearchResult?.Items || [];
  return items.map((it) => {
    const listing = it.offersV2?.listings?.[0];
    const money = listing?.price?.money || listing?.price || {};
    const url = it.detailPageURL || it.detailPageUrl || `https://www.amazon.com/dp/${it.asin}`;
    return normalizeProduct({
      source: 'amazon',
      sourceId: it.asin || it.ASIN,
      title: it.itemInfo?.title?.displayValue,
      productUrl: url,
      affiliateUrl: withTag(url, tag),
      price: money.amount,
      currency: money.currency,
      category: it.itemInfo?.classifications?.productGroup?.displayValue,
      imageRefUrl: it.images?.primary?.large?.url,
      keyword,
    });
  });
}

export function amazonSource(env, prefs, fetchImpl = fetch) {
  const version = env.AMAZON_CREDENTIAL_VERSION || '3.1';
  const tag = env.AMAZON_PARTNER_TAG;
  const marketplace = env.AMAZON_MARKETPLACE || MARKETPLACES[(prefs.market?.country || 'US').toUpperCase()] || 'www.amazon.com';
  let token;

  async function getToken() {
    if (token) return token;
    const url = AUTH[version];
    if (!url) throw new Error(`Unknown AMAZON_CREDENTIAL_VERSION "${version}" (use one of ${Object.keys(AUTH).join(', ')})`);
    const data = version.startsWith('3.')
      ? await fetchJSON(fetchImpl, url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grant_type: 'client_credentials', client_id: env.AMAZON_CREDENTIAL_ID, client_secret: env.AMAZON_CREDENTIAL_SECRET, scope: 'creatorsapi::default' }),
        })
      : await fetchJSON(fetchImpl, url, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            authorization: `Basic ${Buffer.from(`${env.AMAZON_CREDENTIAL_ID}:${env.AMAZON_CREDENTIAL_SECRET}`).toString('base64')}`,
          },
          body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'creatorsapi/default' }).toString(),
        });
    token = data.access_token;
    return token;
  }

  return {
    name: 'amazon',
    async hunt(keywords) {
      const out = [];
      for (const keyword of keywords) {
        const t = await getToken();
        const data = await fetchJSON(fetchImpl, `${API}/searchItems`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: version.startsWith('3.') ? `Bearer ${t}` : `Bearer ${t}, Version ${version}`,
            'x-marketplace': marketplace,
          },
          body: JSON.stringify({ keywords: keyword, marketplace, partnerTag: tag, itemCount: 10, resources: RESOURCES }),
        });
        out.push(...parseAmazon(data, tag, keyword));
      }
      return out;
    },
  };
}
amazonSource.required = ['AMAZON_CREDENTIAL_ID', 'AMAZON_CREDENTIAL_SECRET', 'AMAZON_PARTNER_TAG'];
