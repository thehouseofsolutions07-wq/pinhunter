/** Cut text to at most `max` characters, preferring a word boundary, ending with "…". */
export function truncate(text, max) {
  const s = String(text ?? '').trim();
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,.;:–—-]+$/, '') + '…';
}

/** Make sure a pin description ends with the affiliate disclosure and fits in `max` chars. */
export function withDisclosure(description, disclosure, max = 800) {
  const desc = String(description ?? '').trim();
  const disc = String(disclosure ?? '').trim();
  if (!disc) return truncate(desc, max);
  const body = desc.endsWith(disc) ? desc.slice(0, -disc.length).trim() : desc;
  const room = max - disc.length - 2; // two newlines
  const trimmed = room > 0 ? truncate(body, room) : '';
  return trimmed ? `${trimmed}\n\n${disc}` : disc.slice(0, max);
}
