import { fetchJSON, HttpError } from '../util/http.js';

const OAUTH_TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token';
export const PINTEREST_SCOPES = ['boards:read', 'boards:write', 'pins:read', 'pins:write', 'user_accounts:read'];

/**
 * Minimal Pinterest API v5 client.
 * onTokens({access_token, refresh_token}) is called whenever tokens are refreshed, so the caller can save them.
 */
export function createPinterest({ accessToken, refreshToken, clientId, clientSecret, sandbox = false, onTokens } = {}, fetchImpl = fetch) {
  const base = sandbox ? 'https://api-sandbox.pinterest.com/v5' : 'https://api.pinterest.com/v5';
  let access = accessToken;
  let refreshTok = refreshToken;
  const canRefresh = () => Boolean(refreshTok && clientId && clientSecret);

  async function tokenRequest(params) {
    return fetchJSON(fetchImpl, OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams(params).toString(),
    });
  }

  async function refresh() {
    if (!canRefresh()) throw new Error('Pinterest token expired. Run "pinhunter auth" again.');
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshTok });
    access = t.access_token;
    if (t.refresh_token) refreshTok = t.refresh_token;
    onTokens?.({ access_token: access, refresh_token: refreshTok });
    return access;
  }

  async function api(path, init = {}, retried = false) {
    if (!access) await refresh();
    try {
      return await fetchJSON(fetchImpl, `${base}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${access}`, ...(init.headers || {}) },
      });
    } catch (e) {
      if (e instanceof HttpError && e.status === 401 && !retried && canRefresh()) {
        await refresh();
        return api(path, init, true);
      }
      throw e;
    }
  }

  return {
    refresh,
    async exchangeCode(code, redirectUri) {
      const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      access = t.access_token;
      refreshTok = t.refresh_token;
      return t;
    },
    async me() {
      return api('/user_account');
    },
    async listBoards() {
      const boards = [];
      let bookmark;
      do {
        const qs = new URLSearchParams({ page_size: '100', ...(bookmark ? { bookmark } : {}) });
        const page = await api(`/boards?${qs}`);
        boards.push(...(page.items || []).map((b) => ({ id: String(b.id), name: b.name, privacy: b.privacy })));
        bookmark = page.bookmark;
      } while (bookmark);
      return boards;
    },
    async createPin({ board_id, title, description, link, alt_text, image }) {
      const pin = await api('/pins', {
        method: 'POST',
        body: JSON.stringify({
          board_id,
          title,
          description,
          link,
          alt_text,
          media_source: { source_type: 'image_base64', content_type: image.contentType, data: image.base64 },
        }),
      });
      return { id: String(pin.id), url: `https://www.pinterest.com/pin/${pin.id}/` };
    },
  };
}
