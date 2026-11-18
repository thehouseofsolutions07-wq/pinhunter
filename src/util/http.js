export class HttpError extends Error {
  constructor(status, url, body) {
    const snippet = typeof body === 'string' ? body : JSON.stringify(body);
    super(`HTTP ${status} from ${new URL(url).host}: ${String(snippet).slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

/** fetch + JSON parse; throws HttpError on non-2xx. */
export async function fetchJSON(fetchImpl, url, init = {}) {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new HttpError(res.status, url, data);
  return data;
}
