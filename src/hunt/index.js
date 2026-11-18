import { productKey } from '../product.js';
import { huntAll } from '../sources/index.js';
import { planKeywords } from './plan.js';
import { rateFit } from './rate.js';
import { writePin } from './write.js';
import { dataScore, finalScore } from './score.js';
import { notify } from '../notify.js';

function inPriceRange(p, range = {}) {
  if (p.price == null) return true;
  if (range.min && p.price < range.min) return false;
  if (range.max && p.price > range.max) return false;
  return true;
}

function fallbackWhy(p) {
  const bits = [];
  if (p.salesVolume) bits.push(`${p.salesVolume.toLocaleString('en-US')} sold`);
  if (p.rating) bits.push(`${p.rating.toFixed(1)}★`);
  if (p.commissionRate) bits.push(`${Math.round(p.commissionRate * 100)}% commission`);
  return bits.join(', ');
}

const stamp = (d) => d.toISOString().slice(0, 16).replace('T', ' ');

/** Plan keywords → hunt → score → write pins → add NEEDS_IMAGE rows to the Sheet → ping. */
export async function runHunt({ ai, sources, queue, prefs, boardNames = [], notifyUrl, sheetUrl, fetch: fetchImpl = fetch, log = console.log, dryRun = false, now = new Date() }) {
  const existing = new Set((await queue.readDrafts()).map((d) => d.product_key).filter(Boolean));

  const keywords = await planKeywords(ai, prefs, now, log);
  log(`Keywords: ${keywords.join(' · ')}`);

  log('Hunting products…');
  const { products, errors } = await huntAll(sources, keywords, { log });

  const seen = new Set();
  const fresh = products.filter((p) => {
    const k = productKey(p);
    if (!p.title || !p.affiliateUrl || existing.has(k) || seen.has(k)) return false;
    seen.add(k);
    return inPriceRange(p, prefs.priceRange);
  });
  log(`${products.length} found, ${fresh.length} new after removing duplicates and out-of-range prices.`);
  if (!fresh.length) return { drafts: [], keywords, errors };

  const want = Math.max(1, prefs.draftsPerRun || 5);
  const pool = fresh.sort((a, b) => dataScore(b) - dataScore(a)).slice(0, Math.max(want * 4, 20));
  const fits = await rateFit(ai, pool, prefs, log);
  const ranked = pool
    .map((p) => {
      const f = fits.get(productKey(p)) || { fit: 5, why: '' };
      return { p, score: finalScore(dataScore(p), f.fit), why: f.why };
    })
    .sort((a, b) => b.score - a.score);

  const drafts = [];
  for (const { p, score, why } of ranked) {
    if (drafts.length >= want) break;
    try {
      const pin = await writePin(ai, p, prefs, boardNames);
      const ref = p.imageRefUrl ? `\nProduct photo for reference: ${p.imageRefUrl}` : '';
      drafts.push({
        created_at: stamp(now),
        status: 'NEEDS_IMAGE',
        source: p.source,
        product_key: productKey(p),
        product: p.title,
        price: p.price != null ? `${p.price} ${p.currency}`.trim() : '',
        score: score.toFixed(1),
        why_picked: [why, fallbackWhy(p)].filter(Boolean).join(' — '),
        affiliate_link: p.affiliateUrl,
        board: pin.board,
        pin_title: pin.pin_title,
        pin_description: pin.pin_description,
        alt_text: pin.alt_text,
        image_brief: pin.image_brief + ref,
        image_url: '',
        pin_url: '',
        error: '',
      });
    } catch (e) {
      log(`  skipped "${p.title}": could not write the pin (${e.message})`);
    }
  }

  if (dryRun) {
    log(`[dry run] ${drafts.length} drafts prepared; nothing written.`);
    return { drafts, keywords, errors };
  }
  await queue.appendDrafts(drafts);
  log(`Added ${drafts.length} draft(s) to the Sheet with status NEEDS_IMAGE.`);
  if (drafts.length) {
    await notify(
      notifyUrl,
      `📌 ${drafts.length} new pin drafts are ready. Add an image to each and set its status to READY${sheetUrl ? `: ${sheetUrl}` : '.'}`,
      fetchImpl,
      log,
    );
  }
  return { drafts, keywords, errors };
}
