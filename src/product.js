/**
 * @typedef {Object} Product
 * @property {string} source        e.g. "aliexpress"
 * @property {string} sourceId      id inside that source
 * @property {string} title
 * @property {string} productUrl
 * @property {string} affiliateUrl  the tagged link that goes on the pin
 * @property {number|null} price
 * @property {string} currency
 * @property {number|null} rating        0..5
 * @property {number|null} reviewCount
 * @property {number|null} salesVolume
 * @property {number|null} commissionRate  fraction, 0.07 = 7%
 * @property {string} category
 * @property {string} imageRefUrl   product photo, for reference only (never posted)
 * @property {string} keyword       keyword that found it
 * @property {string} notes
 */

export const productKey = (p) => `${p.source}:${p.sourceId}`;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function percentToFraction(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = num(v);
  if (n === null) return null;
  return String(v).includes('%') || n > 1 ? n / 100 : n;
}

function toFiveStar(v) {
  const n = num(v);
  if (n === null) return null;
  if (String(v).includes('%') || n > 5) return Math.min(5, (n / 100) * 5);
  return n;
}

/** @returns {Product} */
export function normalizeProduct(p) {
  return {
    source: String(p.source || ''),
    sourceId: String(p.sourceId ?? ''),
    title: String(p.title || '').trim(),
    productUrl: String(p.productUrl || p.affiliateUrl || ''),
    affiliateUrl: String(p.affiliateUrl || p.productUrl || ''),
    price: num(p.price),
    currency: String(p.currency || ''),
    rating: toFiveStar(p.rating),
    reviewCount: num(p.reviewCount),
    salesVolume: num(p.salesVolume),
    commissionRate: percentToFraction(p.commissionRate),
    category: String(p.category || ''),
    imageRefUrl: String(p.imageRefUrl || ''),
    keyword: String(p.keyword || ''),
    notes: String(p.notes || ''),
  };
}
