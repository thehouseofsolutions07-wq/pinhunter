import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUiServer, readEnv } from '../ui/server.js';
import { updateEnvFile } from './envfile.js';
import { openBrowser } from './auth.js';
import { createAI } from '../ai/client.js';
import { createMemoryQueue } from '../sheets/queue.js';
import { DEFAULT_PREFS } from '../config.js';

/** Context for "pinhunter ui --demo": sample AI and products, an in-memory Sheet and a fake Pinterest. */
export function demoMakeContext() {
  const queue = createMemoryQueue();
  const boards = [
    { id: '1', name: 'Home Decor Ideas' },
    { id: '2', name: 'Kitchen Finds' },
    { id: '3', name: 'Gift Ideas' },
  ];
  const prefs = { ...DEFAULT_PREFS, sources: ['mock'], boards: { 'home decor': 'Home Decor Ideas', kitchen: 'Kitchen Finds' }, postDelaySeconds: 1 };
  let n = 0;
  const pinterest = {
    async listBoards() {
      return boards;
    },
    async createPin() {
      n++;
      return { id: `demo${n}`, url: `https://www.pinterest.com/pin/demo${n}/` };
    },
  };
  return ({ cwd, log }) => ({
    cwd,
    env: { AI_PROVIDER: 'mock', AI_MODEL: 'demo' },
    prefs,
    log,
    ai: () => createAI({ provider: 'mock' }),
    queue: () => queue,
    hasPinterest: () => true,
    pinterest: () => pinterest,
  });
}

/**
 * Run the dashboard on a web host (Hostinger, Render, a VPS…). Needs PINHUNTER_PUBLIC_URL, PINHUNTER_PASSWORD
 * and PINHUNTER_UI_TOKEN in the environment or .env; listens on PORT.
 */
export async function runHosted({ cwd = process.cwd(), log = console.log } = {}) {
  const env = readEnv(cwd);
  const missing = ['PINHUNTER_PUBLIC_URL', 'PINHUNTER_PASSWORD', 'PINHUNTER_UI_TOKEN'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Set ${missing.join(', ')} in the host's environment variables.`);
  const server = createUiServer({ cwd, token: env.PINHUNTER_UI_TOKEN, publicUrl: env.PINHUNTER_PUBLIC_URL, password: env.PINHUNTER_PASSWORD });
  const p = Number(env.PORT || 3000);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(p, resolve);
  });
  log(`PinHunter dashboard is running on port ${p} for ${env.PINHUNTER_PUBLIC_URL}`);
  return server;
}

/** Start the local dashboard on 127.0.0.1 and open it in the browser. */
export async function runUi({ cwd = process.cwd(), log = console.log } = {}, { port, open = true, demo = false } = {}) {
  let token;
  let makeContext;
  if (demo) {
    cwd = mkdtempSync(join(tmpdir(), 'pinhunter-demo-'));
    token = randomBytes(24).toString('hex');
    makeContext = demoMakeContext();
  } else {
    const env = readEnv(cwd);
    token = env.PINHUNTER_UI_TOKEN;
    if (!token || token.length < 24) {
      token = randomBytes(24).toString('hex');
      updateEnvFile(join(cwd, '.env'), { PINHUNTER_UI_TOKEN: token });
    }
  }
  const p = Number(port || (demo ? 8086 : readEnv(cwd).PINHUNTER_UI_PORT) || 8085);
  const server = createUiServer({ cwd, token, makeContext });
  await new Promise((resolve, reject) => {
    server.once('error', (e) =>
      reject(e.code === 'EADDRINUSE' ? new Error(`Port ${p} is busy. PinHunter may already be running: open http://localhost:${p}/?t=${token} or use --port 8090.`) : e),
    );
    server.listen(p, '127.0.0.1', resolve);
  });
  const url = `http://localhost:${p}/?t=${token}`;
  log(`PinHunter dashboard${demo ? ' (DEMO: sample data, nothing is saved or posted)' : ''} is running: ${url}`);
  log('Keep this window open while you use it. Press Ctrl+C to stop.');
  if (!demo && p !== 8085) log(`Note: your Pinterest app's redirect URI must be http://localhost:${p}/callback for "Connect Pinterest" to work.`);
  if (open) openBrowser(url);
  return server;
}
