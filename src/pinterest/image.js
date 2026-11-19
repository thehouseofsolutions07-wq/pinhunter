import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_BYTES = 20 * 1024 * 1024;

/** Turn Google Drive / Dropbox "share page" links into direct-download links. */
export function directImageUrl(url) {
  const s = String(url || '').trim();
  const drive = s.match(/drive\.google\.com\/(?:file\/d\/([\w-]+)|(?:open|uc)\?(?:.*&)?id=([\w-]+))/);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1] || drive[2]}`;
  if (/dropbox\.com\//.test(s)) {
    const u = new URL(s);
    u.searchParams.set('dl', '1');
    return u.toString();
  }
  return s;
}

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  return null;
}

/** Load an image from a URL or a local file path and return it base64-encoded for Pinterest. JPG/PNG only. */
export async function loadImage(src, fetchImpl = fetch, { cwd = process.cwd(), allowFiles = true } = {}) {
  const s = String(src || '').trim();
  if (!s) throw new Error('No image: paste an image link into the image_url column.');
  let buf;
  if (/^https?:\/\//i.test(s)) {
    let res;
    try {
      // Ask for JPG/PNG only: CDNs (AliExpress, Shopify…) turn "*/*" into WebP, which Pinterest rejects.
      res = await fetchImpl(directImageUrl(s), { redirect: 'follow', headers: { accept: 'image/jpeg,image/png' } });
    } catch (e) {
      throw new Error(`Could not download the image (${e.message}).`);
    }
    if (!res.ok) throw new Error(`Image link answered HTTP ${res.status}. Is the file shared publicly?`);
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    if (!allowFiles) throw new Error('Paste an image link (https://…). File paths only work when PinHunter runs on your own computer.');
    const p = resolve(cwd, s);
    if (!existsSync(p)) throw new Error(`Image file not found: ${s}`);
    if (statSync(p).size > MAX_BYTES) throw new Error('Image is larger than 20 MB.');
    buf = readFileSync(p);
  }
  if (buf.length > MAX_BYTES) throw new Error('Image is larger than 20 MB.');
  const contentType = sniff(buf);
  if (!contentType) {
    const looksHtml = buf.subarray(0, 200).toString('utf8').trimStart().startsWith('<');
    throw new Error(
      looksHtml
        ? 'That link opens a web page, not an image. Use a direct image link, or for Google Drive set sharing to "Anyone with the link".'
        : 'That file is not an image Pinterest accepts. Please use a JPG or PNG.',
    );
  }
  return { contentType, base64: buf.toString('base64') };
}
