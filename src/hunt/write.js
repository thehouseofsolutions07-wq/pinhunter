import { truncate, withDisclosure } from '../util/text.js';

/** Pick a board: niche mapping from config first, then the AI's choice if it exists, then the first board. */
export function chooseBoard(product, aiBoard, prefs, boardNames = []) {
  const haystack = `${product.niche || ''} ${product.keyword || ''} ${product.category || ''}`.toLowerCase();
  for (const [niche, board] of Object.entries(prefs.boards || {})) {
    if (niche && haystack.includes(niche.toLowerCase())) return board;
  }
  const wanted = String(aiBoard || '').trim();
  if (!boardNames.length) return wanted;
  const match = boardNames.find((b) => b.toLowerCase() === wanted.toLowerCase());
  return match || boardNames[0];
}

/** Have the AI write the pin copy for one product. Limits and disclosure are enforced here, not trusted to the AI. */
export async function writePin(ai, product, prefs, boardNames = []) {
  const out = await ai.chatJSON(
    `[task:write] You write high-converting Pinterest pins for affiliate products. Tone: ${prefs.tone}. Language: ${prefs.language || 'English'}.\n` +
      'Rules: title max 90 characters, keyword-rich, no ALL CAPS, no clickbait lies. Description 250-450 characters: ' +
      'benefit-led, natural search keywords, 3-5 relevant hashtags at the end, a soft call to action. ' +
      'Never invent specs, prices, discounts or claims that are not in the product data. Do not include any URL. ' +
      'alt_text: plain description of what the image should show (max 400 characters). ' +
      'image_brief: what picture the human should make (scene, angle, text overlay idea, vertical 2:3). ' +
      'board: pick the best one from the given board list (exact name), or suggest a board name if the list is empty. ' +
      'Return {"board","pin_title","pin_description","alt_text","image_brief"}.',
    `INPUT: ${JSON.stringify({
      product: { title: product.title, price: product.price, currency: product.currency, category: product.category, rating: product.rating, notes: product.notes, keyword: product.keyword },
      boards: boardNames,
    })}`,
  );
  return {
    board: chooseBoard(product, out?.board, prefs, boardNames),
    pin_title: truncate(out?.pin_title || product.title, 100),
    pin_description: withDisclosure(out?.pin_description || product.title, prefs.disclosure, 800),
    alt_text: truncate(out?.alt_text || product.title, 500),
    image_brief: truncate(out?.image_brief || '', 1000),
  };
}
