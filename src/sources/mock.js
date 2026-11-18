import { normalizeProduct } from '../product.js';

const SAMPLE = [
  ['Sunset Projection Lamp', 'home decor', 18.99, 12400, '95.1%', '9%'],
  ['Ceramic Pour-Over Coffee Set', 'kitchen gadgets', 32.5, 3100, '97.2%', '7%'],
  ['Boho Macrame Wall Hanging', 'home decor', 24.0, 5800, '96.0%', '8%'],
  ['Magnetic Spice Jar Rack', 'kitchen gadgets', 21.99, 8700, '94.3%', '6%'],
  ['Linen Throw Pillow Covers (Set of 4)', 'home decor', 19.99, 15200, '97.8%', '8%'],
  ['Electric Milk Frother Wand', 'kitchen gadgets', 9.99, 41000, '95.5%', '5%'],
  ['Mini Herb Garden Kit', 'gardening', 15.49, 2600, '93.0%', '10%'],
  ['Silicone Stretch Lids (12 pack)', 'kitchen gadgets', 7.99, 63000, '92.1%', '4%'],
];

/** Offline sample products for the demo and tests. */
export function mockSource() {
  return {
    name: 'mock',
    async hunt(keywords = []) {
      return SAMPLE.map(([title, category, price, sales, rating, commission], i) =>
        normalizeProduct({
          source: 'mock',
          sourceId: String(i + 1),
          title,
          category,
          price,
          currency: 'USD',
          salesVolume: sales,
          rating,
          commissionRate: commission,
          productUrl: `https://example.com/product/${i + 1}`,
          affiliateUrl: `https://example.com/product/${i + 1}?aff=demo`,
          keyword: keywords.find((k) => k.includes(category)) || category,
        }),
      );
    },
  };
}
