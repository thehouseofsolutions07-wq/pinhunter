import { normalizeProduct } from '../product.js';

/**
 * Your own affiliate links, pasted into the "Products" tab of the Sheet.
 * Works for any network without an API: Gumroad, ClickBank, Impact, CJ, ShareASale, Etsy, ...
 */
export function feedSource({ queue }) {
  return {
    name: 'feed',
    async hunt() {
      if (!queue?.readProducts) return [];
      const rows = await queue.readProducts();
      return rows
        .filter((r) => String(r.affiliate_link || '').trim() && String(r.title || '').trim())
        .map((r) =>
          normalizeProduct({
            source: 'feed',
            sourceId: String(r.affiliate_link).trim(),
            title: r.title,
            affiliateUrl: String(r.affiliate_link).trim(),
            price: r.price,
            currency: r.currency,
            category: r.category,
            notes: r.notes,
          }),
        );
    },
  };
}
