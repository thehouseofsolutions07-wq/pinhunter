/**
 * Offline stand-in for a real AI, used by `pinhunter demo` and the tests.
 * Prompts carry a "[task:...]" tag and a JSON payload after "INPUT:" so the mock can answer sensibly.
 */
export function mockReply(system, user) {
  const task = (system.match(/\[task:(\w+)\]/) || [])[1];
  let input = {};
  const at = user.indexOf('INPUT:');
  if (at !== -1) {
    try {
      input = JSON.parse(user.slice(at + 6));
    } catch {
      input = {};
    }
  }
  if (task === 'keywords') {
    const niches = input.niches?.length ? input.niches : ['home decor'];
    return JSON.stringify({ keywords: niches.map((n) => `${n} ideas`) });
  }
  if (task === 'rate') {
    return JSON.stringify({
      ratings: (input.products || []).map((p, i) => ({
        key: p.key,
        fit: 9 - (i % 4),
        why: `Visual, giftable and on-trend for "${p.category || 'this niche'}".`,
      })),
    });
  }
  if (task === 'write') {
    const p = input.product || {};
    return JSON.stringify({
      board: input.boards?.[0] || '',
      pin_title: `${p.title} — a must-have find`,
      pin_description: `Looking for ${String(p.title || 'this').toLowerCase()}? Loved for quality and value. Save this pin for later! #${String(p.category || 'finds').replace(/\s+/g, '')} #giftideas`,
      alt_text: `Photo of ${p.title}`,
      image_brief: `Bright lifestyle photo of the ${p.title} in use, vertical 1000x1500, short headline overlay.`,
    });
  }
  return '{}';
}
