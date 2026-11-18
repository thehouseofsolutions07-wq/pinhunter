import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { buildContext, SetupError } from '../cli/context.js';
import { updateEnvFile } from '../cli/envfile.js';
import { readServiceAccount, DEFAULT_PREFS } from '../config.js';
import { runChecks, doHunt, doPublish } from '../actions.js';
import { STATUSES, normStatus } from '../sheets/queue.js';
import { loadImage } from '../pinterest/image.js';
import { createPinterest, PINTEREST_SCOPES } from '../pinterest/client.js';
import { ENV_GROUPS, ENV_FIELDS, FIELD_BY_KEY, PREF_CLEANERS } from './fields.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/icon.png': ['icon.png', 'image/png'],
};
const DRAFT_EDITABLE = ['status', 'image_url', 'board', 'pin_title', 'pin_description', 'alt_text'];
const MAX_BODY = 1024 * 1024;

class HttpErr extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** .env as it is on disk right now, layered over the process environment. */
export function readEnv(cwd) {
  const file = join(cwd, '.env');
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  return { ...process.env, ...fromFile };
}

const defaultMakeContext = ({ cwd, log }) => buildContext({ cwd, log, env: readEnv(cwd) });

function sameToken(given, token) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Compare two secrets of any length in constant time. */
function sameSecret(a, b) {
  const h = (v) => createHash('sha256').update(String(v ?? '')).digest();
  return timingSafeEqual(h(a), h(b));
}

const SESSION_COOKIE = 'ph_session';
const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 5;

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

/** The visitor's address. Behind Hostinger's proxy the last X-Forwarded-For entry is the one the proxy added. */
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  return xff.at(-1) || req.socket.remoteAddress || '?';
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpErr(413, 'Request is too large.');
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpErr(400, 'Request body is not valid JSON.');
  }
}

function settingsView(cwd) {
  const env = readEnv(cwd);
  let serviceAccountEmail = '';
  try {
    serviceAccountEmail = readServiceAccount(env, cwd)?.client_email || '';
  } catch {
    /* shown as not set */
  }
  const configFile = join(cwd, 'pinhunter.config.json');
  let prefs = { ...DEFAULT_PREFS };
  try {
    if (existsSync(configFile)) prefs = { ...prefs, ...JSON.parse(readFileSync(configFile, 'utf8')) };
  } catch {
    /* invalid file: show defaults */
  }
  const fields = ENV_FIELDS.map((f) => {
    const v = env[f.key] ?? '';
    return f.secret ? { ...f, set: Boolean(v), hint: v ? `…${String(v).slice(-4)}` : '' } : { ...f, set: Boolean(v), value: v };
  });
  return { groups: ENV_GROUPS.map(({ fields: _, ...g }) => g), fields, prefs, serviceAccountEmail };
}

function cleanEnv(input) {
  const out = {};
  for (const [key, raw] of Object.entries(input || {})) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) throw new HttpErr(400, `Unknown setting "${key}".`);
    let value = typeof raw === 'boolean' ? String(raw) : String(raw ?? '').trim();
    if (field.secret && !value) continue; // empty secret = keep the current one
    if (key === 'GOOGLE_SERVICE_ACCOUNT_JSON' && value.startsWith('{')) {
      let sa;
      try {
        sa = JSON.parse(value);
      } catch {
        throw new HttpErr(400, 'The service account key is not valid JSON.');
      }
      if (!sa.client_email || !sa.private_key) throw new HttpErr(400, 'That JSON is not a service account key (client_email or private_key is missing).');
      value = Buffer.from(JSON.stringify(sa)).toString('base64');
    }
    if (/[\r\n]/.test(value)) throw new HttpErr(400, `"${field.label}" cannot contain line breaks.`);
    out[key] = value;
  }
  return out;
}

function savePrefs(cwd, input) {
  const file = join(cwd, 'pinhunter.config.json');
  let current = {};
  if (existsSync(file)) {
    try {
      current = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new HttpErr(400, 'pinhunter.config.json is not valid JSON. Fix or delete it first.');
    }
  }
  for (const [k, clean] of Object.entries(PREF_CLEANERS)) if (input[k] !== undefined) current[k] = clean(input[k]);
  writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
}

/**
 * The dashboard server. makeContext({cwd, log}) builds the same context the CLI uses (injectable for tests).
 * Local mode (default): bound to 127.0.0.1 by the caller; every /api call needs the session token.
 * Hosted mode (publicUrl set): only that host is served; /api needs the token or a password login cookie.
 */
export function createUiServer({ cwd = process.cwd(), token, makeContext = defaultMakeContext, fetchImpl = fetch, publicUrl = '', password = '' } = {}) {
  if (!token) throw new Error('createUiServer needs a token.');
  const hosted = Boolean(publicUrl);
  if (hosted && String(password).length < 10) throw new Error('Hosted mode needs PINHUNTER_PASSWORD (at least 10 characters).');
  const publicOrigin = hosted ? new URL(publicUrl).origin : '';
  const publicHost = hosted ? new URL(publicUrl).host.toLowerCase() : '';
  const jobs = new Map();
  let running = null;
  const oauthStates = new Map();
  const loginFails = new Map();

  const ctxFor = (log = () => {}) => {
    const ctx = makeContext({ cwd, log });
    if (hosted) ctx.allowFiles = false;
    return ctx;
  };

  const sign = (exp) => createHmac('sha256', token).update(`session:${exp}`).digest('hex');
  function hasSession(req) {
    if (!hosted) return false;
    const [exp, sig] = readCookie(req, SESSION_COOKIE).split('.');
    if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
    return sameToken(sig, sign(exp));
  }
  const cookie = (value, maxAge) => `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

  /** Who may call /api: the token header, or (hosted) a login cookie plus the CSRF header on changes. */
  function authorize(req) {
    if (sameToken(req.headers['x-pinhunter-token'], token)) return;
    if (hasSession(req)) {
      if (req.method !== 'GET' && req.headers['x-pinhunter-csrf'] !== '1') throw new HttpErr(403, 'Missing request header. Reload the page and try again.');
      return;
    }
    throw new HttpErr(401, hosted ? 'Please log in.' : 'Missing or wrong session token. Open PinHunter from the link "pinhunter ui" prints.');
  }

  /** Check the password (5 wrong tries per address per 15 minutes) and return the session cookie. */
  async function login(req) {
    if (!hosted) throw new HttpErr(404, 'Not found.');
    const ip = clientIp(req);
    const now = Date.now();
    for (const [k, v] of loginFails) if (now - v.first > LOGIN_WINDOW_MS) loginFails.delete(k);
    const fails = loginFails.get(ip);
    if (fails && fails.count >= LOGIN_MAX_FAILS) throw new HttpErr(429, 'Too many wrong passwords. Try again in 15 minutes.');
    const body = await readBody(req);
    if (!sameSecret(body.password, password)) {
      loginFails.set(ip, { first: fails?.first || now, count: (fails?.count || 0) + 1 });
      throw new HttpErr(401, 'Wrong password.');
    }
    loginFails.delete(ip);
    const exp = String(now + SESSION_DAYS * 24 * 3600 * 1000);
    return cookie(`${exp}.${sign(exp)}`, SESSION_DAYS * 24 * 3600);
  }

  function startJob(type, dryRun) {
    if (running) throw new HttpErr(409, `A ${running.type} is already running. Wait for it to finish.`);
    const job = { id: randomBytes(6).toString('hex'), type, dryRun, status: 'running', log: [], result: null, error: null, startedAt: new Date().toISOString() };
    const log = (line) => job.log.push(String(line));
    running = job;
    jobs.set(job.id, job);
    if (jobs.size > 20) jobs.delete(jobs.keys().next().value);
    (async () => {
      try {
        const ctx = ctxFor(log);
        if (type === 'hunt') {
          const r = await doHunt(ctx, { dryRun });
          job.result = { count: r.drafts.length, keywords: r.keywords || [], drafts: dryRun ? r.drafts : undefined };
        } else {
          job.result = await doPublish(ctx, { dryRun });
        }
        job.status = 'done';
      } catch (e) {
        job.status = 'error';
        job.error = e.message;
        log(`Error: ${e.message}`);
      } finally {
        job.finishedAt = new Date().toISOString();
        running = null;
      }
    })();
    return job;
  }

  async function api(req, url, server) {
    const path = url.pathname;
    const method = req.method;

    if (path === '/api/settings' && method === 'GET') return settingsView(cwd);
    if (path === '/api/settings' && method === 'PUT') {
      const body = await readBody(req);
      const env = cleanEnv(body.env);
      if (Object.keys(env).length) updateEnvFile(join(cwd, '.env'), env);
      if (body.prefs && typeof body.prefs === 'object') savePrefs(cwd, body.prefs);
      return settingsView(cwd);
    }
    if (path === '/api/checks' && method === 'GET') return { checks: await runChecks(ctxFor()) };

    if (path === '/api/overview' && method === 'GET') {
      const ctx = ctxFor();
      const out = { counts: null, total: 0, sheetUrl: '', recent: [], error: '', running: running && { id: running.id, type: running.type } };
      try {
        const q = ctx.queue();
        const drafts = await q.readDrafts();
        out.sheetUrl = q.url || '';
        out.total = drafts.length;
        out.counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
        for (const d of drafts) {
          const s = normStatus(d.status);
          if (s in out.counts) out.counts[s]++;
        }
        out.recent = drafts.filter((d) => normStatus(d.status) === 'POSTED').slice(-5).reverse();
      } catch (e) {
        out.error = e.message;
      }
      return out;
    }

    if (path === '/api/drafts' && method === 'GET') {
      const q = ctxFor().queue();
      return { drafts: await q.readDrafts(), sheetUrl: q.url || '' };
    }
    const draftMatch = path.match(/^\/api\/drafts\/(\d+)$/);
    if (draftMatch && method === 'PATCH') {
      const row = Number(draftMatch[1]);
      if (row < 2) throw new HttpErr(400, 'Invalid row.');
      const body = await readBody(req);
      const fields = {};
      for (const k of DRAFT_EDITABLE) if (body[k] !== undefined) fields[k] = String(body[k]);
      if (fields.status !== undefined) {
        fields.status = normStatus(fields.status);
        if (!STATUSES.includes(fields.status)) throw new HttpErr(400, `Status must be one of ${STATUSES.join(', ')}.`);
      }
      if (!Object.keys(fields).length) throw new HttpErr(400, 'Nothing to change.');
      await ctxFor().queue().updateDraft(row, fields);
      return { ok: true, row, fields };
    }

    if (path === '/api/boards' && method === 'GET') {
      const ctx = ctxFor();
      if (!ctx.hasPinterest()) return { boards: [], connected: false };
      return { boards: await ctx.pinterest().listBoards(), connected: true };
    }

    if (path === '/api/jobs' && method === 'POST') {
      const body = await readBody(req);
      if (!['hunt', 'publish'].includes(body.type)) throw new HttpErr(400, 'type must be "hunt" or "publish".');
      const job = startJob(body.type, Boolean(body.dryRun));
      return [202, { id: job.id }];
    }
    const jobMatch = path.match(/^\/api\/jobs\/([a-f0-9]+)$/);
    if (jobMatch && method === 'GET') {
      const job = jobs.get(jobMatch[1]);
      if (!job) throw new HttpErr(404, 'No such job.');
      return job;
    }

    if (path === '/api/pinterest/connect' && method === 'GET') {
      const env = readEnv(cwd);
      if (!env.PINTEREST_CLIENT_ID || !env.PINTEREST_CLIENT_SECRET) throw new HttpErr(400, 'Save your Pinterest App ID and App secret first.');
      const redirectUri = env.PINTEREST_REDIRECT_URI || (hosted ? `${publicOrigin}/callback` : `http://localhost:${server.address().port}/callback`);
      const state = randomBytes(16).toString('hex');
      oauthStates.set(state, { redirectUri, at: Date.now() });
      const authUrl =
        'https://www.pinterest.com/oauth/?' +
        new URLSearchParams({ client_id: env.PINTEREST_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: PINTEREST_SCOPES.join(','), state });
      return { url: authUrl, redirectUri };
    }

    throw new HttpErr(404, 'Not found.');
  }

  async function callback(url, res) {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const saved = state && oauthStates.get(state);
    if (saved) oauthStates.delete(state);
    if (!saved || !code || Date.now() - saved.at > 10 * 60 * 1000) {
      const why = url.searchParams.get('error_description') || 'The login link expired or did not come from this dashboard.';
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<h2>Pinterest was not connected</h2><p>${why.replace(/[<>&]/g, '')}</p><p><a href="/#setup">Back to PinHunter</a></p>`);
      return;
    }
    const env = readEnv(cwd);
    try {
      const client = createPinterest({ clientId: env.PINTEREST_CLIENT_ID, clientSecret: env.PINTEREST_CLIENT_SECRET }, fetchImpl);
      const tokens = await client.exchangeCode(code, saved.redirectUri);
      updateEnvFile(join(cwd, '.env'), { PINTEREST_ACCESS_TOKEN: tokens.access_token, PINTEREST_REFRESH_TOKEN: tokens.refresh_token });
      res.writeHead(302, { location: '/?connected=pinterest#setup' });
      res.end();
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<h2>Pinterest login failed</h2><p>${String(e.message).replace(/[<>&]/g, '')}</p><p><a href="/#setup">Back to PinHunter</a></p>`);
    }
  }

  const server = createServer(async (req, res) => {
    const port = server.address()?.port;
    const host = String(req.headers.host || '').toLowerCase();
    if (hosted ? host !== publicHost : host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden host.');
      return;
    }
    const url = new URL(req.url, `http://${host}`);
    const sec = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', ...(hosted ? { 'strict-transport-security': 'max-age=31536000' } : {}) };
    const json = (status, body, extra = {}) => {
      res.writeHead(status, { ...sec, 'content-type': 'application/json; charset=utf-8', ...extra });
      res.end(JSON.stringify(body));
    };
    try {
      if (url.pathname === '/callback') return await callback(url, res);

      if (url.pathname === '/api/session' && req.method === 'GET') {
        return json(200, { hosted, loggedIn: sameToken(req.headers['x-pinhunter-token'], token) || hasSession(req) });
      }
      if (url.pathname === '/api/login' && req.method === 'POST') return json(200, { ok: true }, { 'set-cookie': await login(req) });
      if (url.pathname === '/api/logout' && req.method === 'POST') return json(200, { ok: true }, { 'set-cookie': cookie('', 0) });

      if (url.pathname.startsWith('/api/')) {
        authorize(req);
        if (url.pathname === '/api/image' && req.method === 'GET') {
          const img = await loadImage(url.searchParams.get('url'), fetchImpl, { cwd, allowFiles: !hosted }).catch((e) => {
            throw new HttpErr(422, e.message);
          });
          res.writeHead(200, { ...sec, 'content-type': img.contentType });
          res.end(Buffer.from(img.base64, 'base64'));
          return;
        }
        const out = await api(req, url, server);
        const [status, body] = Array.isArray(out) ? out : [200, out];
        return json(status, body);
      }

      const file = req.method === 'GET' && STATIC[url.pathname];
      if (!file) throw new HttpErr(404, 'Not found.');
      res.writeHead(200, {
        ...sec,
        'content-type': file[1],
        'content-security-policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
      });
      res.end(readFileSync(join(PUBLIC, file[0])));
    } catch (e) {
      const status = e instanceof HttpErr ? e.status : e instanceof SetupError ? 400 : 500;
      if (!res.headersSent) res.writeHead(status, { ...sec, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message, setup: e instanceof SetupError }));
    }
  });
  return server;
}
