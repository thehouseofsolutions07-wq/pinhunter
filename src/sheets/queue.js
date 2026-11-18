import { fetchJSON } from '../util/http.js';
import { getGoogleToken } from './auth.js';

export const DRAFTS_TAB = 'Drafts';
export const PRODUCTS_TAB = 'Products';
export const COLUMNS = [
  'created_at', 'status', 'source', 'product_key', 'product', 'price', 'score', 'why_picked', 'affiliate_link',
  'board', 'pin_title', 'pin_description', 'alt_text', 'image_brief', 'image_url', 'pin_url', 'error',
];
export const PRODUCT_COLUMNS = ['affiliate_link', 'title', 'price', 'currency', 'category', 'notes'];
export const STATUSES = ['NEEDS_IMAGE', 'READY', 'POSTED', 'ERROR', 'SKIP'];

export const normStatus = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '_');
export const draftToRow = (d) => COLUMNS.map((c) => (d[c] === undefined || d[c] === null ? '' : String(d[c])));
export function rowToObject(header, row) {
  const o = {};
  header.forEach((h, i) => {
    const key = String(h || '').trim().toLowerCase();
    if (key) o[key] = row?.[i] ?? '';
  });
  return o;
}
export function colLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const isBlank = (row) => !row || row.every((v) => String(v ?? '').trim() === '');

/** In-memory queue with the same interface as the Sheet queue (demo, dry runs, tests). */
export function createMemoryQueue({ drafts = [], products = [] } = {}) {
  const rows = drafts.map((d) => ({ ...d }));
  return {
    kind: 'memory',
    drafts: rows,
    async ensure() {},
    async readDrafts() {
      return rows.map((d, i) => ({ ...d, row: i + 2 }));
    },
    async appendDrafts(list) {
      rows.push(...list.map((d) => ({ ...d })));
    },
    async updateDraft(row, fields) {
      Object.assign(rows[row - 2], fields);
    },
    async readProducts() {
      return products;
    },
  };
}

/** Google Sheet queue: the Drafts tab is the to-do list, the Products tab is your own link feed. */
export function createSheetQueue({ sheetId, serviceAccount }, fetchImpl = fetch) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
  let token;
  let tokenAt = 0;
  let header = COLUMNS;

  async function api(path, init = {}) {
    if (!token || Date.now() - tokenAt > 50 * 60 * 1000) {
      token = await getGoogleToken(serviceAccount, fetchImpl);
      tokenAt = Date.now();
    }
    return fetchJSON(fetchImpl, `${base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
  }
  const range = (tab, a1) => encodeURIComponent(`'${tab}'!${a1}`);

  return {
    kind: 'sheet',
    url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
    async ensure() {
      const meta = await api('?fields=sheets.properties(sheetId,title)');
      const tabs = new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));
      const requests = [];
      for (const t of [DRAFTS_TAB, PRODUCTS_TAB]) if (!tabs.has(t)) requests.push({ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } });
      if (requests.length) {
        const res = await api(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
        for (const r of res.replies || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, r.addSheet.properties.sheetId);
      }
      for (const [tab, cols] of [[DRAFTS_TAB, COLUMNS], [PRODUCTS_TAB, PRODUCT_COLUMNS]]) {
        const got = await api(`/values/${range(tab, '1:1')}`);
        if (isBlank(got.values?.[0])) {
          await api(`/values/${range(tab, 'A1')}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [cols] }) });
        }
      }
      // Status dropdown so nobody has to remember the exact words.
      const statusCol = COLUMNS.indexOf('status');
      await api(':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              setDataValidation: {
                range: { sheetId: tabs.get(DRAFTS_TAB), startRowIndex: 1, startColumnIndex: statusCol, endColumnIndex: statusCol + 1 },
                rule: { condition: { type: 'ONE_OF_LIST', values: STATUSES.map((v) => ({ userEnteredValue: v })) }, strict: false, showCustomUi: true },
              },
            },
          ],
        }),
      });
    },
    async readDrafts() {
      const got = await api(`/values/${range(DRAFTS_TAB, 'A1:ZZ')}`);
      const values = got.values || [];
      if (values.length && !isBlank(values[0])) header = values[0].map((h) => String(h).trim().toLowerCase());
      const out = [];
      values.slice(1).forEach((row, i) => {
        if (!isBlank(row)) out.push({ ...rowToObject(header, row), row: i + 2 });
      });
      return out;
    },
    async appendDrafts(list) {
      if (!list.length) return;
      await api(`/values/${range(DRAFTS_TAB, 'A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: JSON.stringify({ values: list.map(draftToRow) }),
      });
    },
    async updateDraft(row, fields) {
      const data = Object.entries(fields)
        .map(([k, v]) => ({ col: header.indexOf(k), v }))
        .filter((x) => x.col !== -1)
        .map(({ col, v }) => ({ range: `'${DRAFTS_TAB}'!${colLetter(col)}${row}`, values: [[v == null ? '' : String(v)]] }));
      if (!data.length) return;
      await api('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
    },
    async readProducts() {
      const got = await api(`/values/${range(PRODUCTS_TAB, 'A1:ZZ')}`);
      const [head, ...rows] = got.values || [];
      if (!head) return [];
      const h = head.map((x) => String(x).trim().toLowerCase());
      return rows.filter((r) => !isBlank(r)).map((r) => rowToObject(h, r));
    },
  };
}
