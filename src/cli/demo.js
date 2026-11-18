import { createAI } from '../ai/client.js';
import { mockSource } from '../sources/mock.js';
import { createMemoryQueue } from '../sheets/queue.js';
import { runHunt } from '../hunt/index.js';
import { runPublish } from '../publish.js';
import { DEFAULT_PREFS } from '../config.js';
import { truncate } from '../util/text.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5ee2a4b0000000049454e44ae426082', 'hex');

function table(drafts) {
  return drafts
    .map((d) => `  ${d.row ?? ''}\t${d.status.padEnd(11)}\t${String(d.score).padEnd(4)}\t${truncate(d.product, 34).padEnd(34)}\t${d.board}${d.pin_url ? `\t${d.pin_url}` : ''}`)
    .join('\n');
}

/** Whole loop with fake AI, fake products, an in-memory "Sheet" and a fake Pinterest. No accounts needed. */
export async function runDemo({ log = console.log } = {}) {
  const boards = [
    { id: '1', name: 'Home Decor Ideas' },
    { id: '2', name: 'Kitchen Finds' },
  ];
  const prefs = { ...DEFAULT_PREFS, boards: { 'home decor': 'Home Decor Ideas', kitchen: 'Kitchen Finds' }, postDelaySeconds: 0 };
  const queue = createMemoryQueue();

  log('— DEMO: step 1, hunt (offline mock AI and sample products) —');
  await runHunt({ ai: createAI({ provider: 'mock' }), sources: [mockSource()], queue, prefs, boardNames: boards.map((b) => b.name), log });
  log('\nYour Sheet now looks like this:');
  log(table(await queue.readDrafts()));
  const first = queue.drafts[0];
  log(`\nExample draft:\n  Title: ${first.pin_title}\n  Link:  ${first.affiliate_link}\n  Description:\n    ${first.pin_description.replace(/\n/g, '\n    ')}\n  Image brief: ${first.image_brief}`);

  log('\n— DEMO: step 2, you add images to two drafts and set them to READY —');
  for (const d of queue.drafts.slice(0, 2)) Object.assign(d, { image_url: 'https://example.com/my-pin.png', status: 'READY' });

  log('\n— DEMO: step 3, publish —');
  let n = 0;
  const pinterest = { async listBoards() { return boards; }, async createPin() { n++; return { id: `demo${n}`, url: `https://www.pinterest.com/pin/demo${n}/` }; } };
  await runPublish({ queue, pinterest, prefs, fetch: async () => new Response(PNG), log });
  log('\nFinal Sheet:');
  log(table(await queue.readDrafts()));
  log('\nThat is the whole loop. Run "pinhunter init" to set it up for real.');
}
