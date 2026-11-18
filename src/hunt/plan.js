const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Ask the AI for product search keywords that fit the niches and the season. Falls back to the niches. */
export async function planKeywords(ai, prefs, date = new Date(), log = () => {}) {
  const fixed = (prefs.keywords || []).filter(Boolean);
  const max = Math.max(1, prefs.keywordsPerRun || 3);
  let aiKeywords = [];
  try {
    const out = await ai.chatJSON(
      '[task:keywords] You are a Pinterest affiliate marketing strategist. Suggest short product search keywords ' +
        '(2-4 words, the kind you would type into a shop search box) for products that sell well on Pinterest right now. ' +
        'Favour visual, giftable, seasonal and trending products. Return {"keywords": ["..."]}.',
      `Month: ${MONTHS[date.getMonth()]} ${date.getFullYear()}. Market: ${prefs.market?.country || 'US'}. ` +
        `Give ${max} keywords.\nINPUT: ${JSON.stringify({ niches: prefs.niches || [] })}`,
    );
    aiKeywords = (out?.keywords || []).map((k) => String(k).trim()).filter(Boolean);
  } catch (e) {
    log(`AI keyword planning failed (${e.message}); using your niches as keywords.`);
  }
  const merged = [...new Set([...fixed, ...aiKeywords])];
  if (!merged.length) merged.push(...(prefs.niches || []));
  return merged.slice(0, Math.max(max, fixed.length));
}
