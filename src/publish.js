import { normStatus } from './sheets/queue.js';
import { loadImage } from './pinterest/image.js';
import { truncate, withDisclosure } from './util/text.js';

export function resolveBoard(value, boards) {
  const v = String(value || '').trim();
  if (!v) return null;
  return boards.find((b) => b.id === v) || boards.find((b) => b.name === v) || boards.find((b) => b.name.toLowerCase() === v.toLowerCase()) || null;
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Post every READY row (up to maxPostsPerRun) and write the result back to the Sheet. */
export async function runPublish({ queue, pinterest, prefs, fetch: fetchImpl = fetch, log = console.log, dryRun = false, sleep = realSleep, cwd, allowFiles = true }) {
  const drafts = await queue.readDrafts();
  const ready = drafts.filter((d) => normStatus(d.status) === 'READY');
  const result = { posted: 0, failed: 0, waiting: ready.length };
  if (!ready.length) {
    log('No drafts with status READY. Add an image link to a draft and set its status to READY.');
    return result;
  }
  const batch = ready.slice(0, Math.max(1, prefs.maxPostsPerRun || 5));
  log(`${ready.length} READY draft(s); posting ${batch.length} this run${dryRun ? ' (dry run — nothing will be posted)' : ''}.`);
  const boards = await pinterest.listBoards();

  for (const [i, d] of batch.entries()) {
    const label = `row ${d.row} "${truncate(d.pin_title || d.product, 50)}"`;
    try {
      if (!String(d.image_url || '').trim()) throw new Error('No image yet: paste an image link into image_url, then set status to READY.');
      if (!/^https?:\/\//i.test(String(d.affiliate_link || '').trim())) throw new Error('affiliate_link is empty or not a web link.');
      const board = resolveBoard(d.board, boards);
      if (!board) throw new Error(`Board "${d.board}" not found. Your boards: ${boards.map((b) => b.name).join(', ') || '(none — create one on Pinterest first)'}`);
      const image = await loadImage(d.image_url, fetchImpl, { cwd, allowFiles });
      const pin = {
        board_id: board.id,
        title: truncate(d.pin_title, 100),
        description: withDisclosure(d.pin_description, prefs.disclosure, 800),
        link: String(d.affiliate_link).trim(),
        alt_text: truncate(d.alt_text, 500),
        image,
      };
      if (dryRun) {
        log(`  [dry run] would post ${label} to board "${board.name}"`);
        continue;
      }
      const created = await pinterest.createPin(pin);
      await queue.updateDraft(d.row, { status: 'POSTED', pin_url: created.url, error: '' });
      result.posted++;
      log(`  ✓ posted ${label} → ${created.url}`);
    } catch (e) {
      result.failed++;
      log(`  ✗ ${label}: ${e.message}`);
      if (!dryRun) await queue.updateDraft(d.row, { status: 'ERROR', error: e.message.slice(0, 500) });
    }
    if (!dryRun && i < batch.length - 1 && prefs.postDelaySeconds > 0) await sleep(prefs.postDelaySeconds * 1000);
  }
  return result;
}
