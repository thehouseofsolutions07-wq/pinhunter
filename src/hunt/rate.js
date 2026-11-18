import { productKey } from '../product.js';

/** Ask the AI how well each product would do on Pinterest. Returns Map<key, {fit 0..10, why}>. */
export async function rateFit(ai, products, prefs, log = () => {}) {
  const result = new Map(products.map((p) => [productKey(p), { fit: 5, why: '' }]));
  if (!products.length) return result;
  try {
    const out = await ai.chatJSON(
      '[task:rate] You judge affiliate products for Pinterest. Score each 0-10 for Pinterest potential: is it visual, ' +
        'aspirational or giftable, does it photograph well, does it match the niches, is the price an easy impulse buy, ' +
        'is it trending or seasonal. Return {"ratings":[{"key":"...","fit":0-10,"why":"one short sentence"}]}.',
      `Niches: ${(prefs.niches || []).join(', ')}.\nINPUT: ${JSON.stringify({
        products: products.map((p) => ({ key: productKey(p), title: p.title, price: p.price, currency: p.currency, category: p.category, rating: p.rating, salesVolume: p.salesVolume, notes: p.notes })),
      })}`,
    );
    for (const r of out?.ratings || []) {
      if (!result.has(r.key)) continue;
      const fit = Math.max(0, Math.min(10, Number(r.fit) || 0));
      result.set(r.key, { fit, why: String(r.why || '').slice(0, 300) });
    }
  } catch (e) {
    log(`AI rating failed (${e.message}); ranking by sales data only.`);
  }
  return result;
}
