/** 0..10 score from hard data (sales, rating × review confidence, commission per sale). 5 = unknown. */
export function dataScore(p) {
  const parts = [];
  if (p.salesVolume != null) parts.push(Math.min(10, 2.5 * Math.log10(1 + p.salesVolume)));
  if (p.rating != null) {
    const confidence = p.reviewCount != null ? Math.min(1, Math.log10(1 + p.reviewCount) / 3) : 0.5;
    parts.push(Math.min(10, p.rating * 2 * confidence));
  }
  if (p.price != null && p.commissionRate != null) parts.push(Math.min(10, p.price * p.commissionRate));
  if (!parts.length) return 5;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export const finalScore = (data, fit) => 0.6 * data + 0.4 * fit;
