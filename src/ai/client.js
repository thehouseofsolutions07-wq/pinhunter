import { PROVIDERS } from './presets.js';
import { fetchJSON } from '../util/http.js';
import { mockReply } from './mock.js';

/** Pull the first JSON object/array out of a model reply (handles ```json fences and chatty prose). */
export function extractJSON(text) {
  const s = String(text ?? '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], s];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c.trim());
    } catch {
      /* fall through */
    }
    const start = c.search(/[[{]/);
    if (start === -1) continue;
    const open = c[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) {
        if (ch === '\\') i++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try {
          return JSON.parse(c.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error('AI reply did not contain valid JSON');
}

/**
 * Create an AI client.
 * @returns {{ provider: string, chatJSON(system: string, user: string): Promise<any> }}
 */
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True for errors worth retrying: rate limits, overloaded servers, timeouts and network failures. */
export function isRetryable(err) {
  if (err?.status) return RETRY_STATUS.has(err.status);
  return err?.name === 'TimeoutError' || err?.name === 'AbortError' || err instanceof TypeError;
}

export function createAI(
  { provider, apiKey, model, baseUrl, temperature = 0.7, retries = 4, timeoutMs = 90_000, sleep = defaultSleep } = {},
  fetchImpl = fetch,
) {
  const name = String(provider || '').toLowerCase();
  const preset = PROVIDERS[name];
  if (!preset) {
    throw new Error(`Unknown AI_PROVIDER "${provider}". Use one of: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  if (preset.style !== 'mock') {
    if (!model) throw new Error('AI_MODEL is not set (for example gemini-3.5-flash-lite, grok-4, gpt-4o-mini, claude-sonnet-5-5).');
    if (!apiKey && !preset.noKey) throw new Error(`AI_API_KEY is not set for provider "${name}".`);
  }
  const base = String(baseUrl || preset.baseUrl).replace(/\/+$/, '');
  if (preset.style !== 'mock' && !base) throw new Error('AI_BASE_URL is required for the "custom" provider.');

  const post = (url, init) => fetchJSON(fetchImpl, url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

  /** Call the model, retrying busy/rate-limited/network failures with exponential backoff (2s, 4s, 8s… max 30s). */
  async function complete(system, user) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await completeOnce(system, user);
      } catch (e) {
        if (attempt >= retries || !isRetryable(e)) throw e;
        await sleep(Math.min(30_000, 2000 * 2 ** attempt));
      }
    }
  }

  async function completeOnce(system, user) {
    if (preset.style === 'mock') return mockReply(system, user);
    if (preset.style === 'anthropic') {
      const data = await post(`${base}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: 4096, temperature, system, messages: [{ role: 'user', content: user }] }),
      });
      return (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    }
    const headers = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const data = await post(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    return data?.choices?.[0]?.message?.content ?? '';
  }

  return {
    provider: name,
    async chatJSON(system, user) {
      const sys = `${system}\n\nReply with JSON only. No markdown, no commentary.`;
      let lastErr;
      for (let attempt = 0; attempt < 2; attempt++) {
        const text = await complete(sys, attempt === 0 ? user : `${user}\n\nYour previous reply was not valid JSON. Reply with valid JSON only.`);
        try {
          return extractJSON(text);
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    },
  };
}
