import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createPinterest, PINTEREST_SCOPES } from '../pinterest/client.js';
import { updateEnvFile } from './envfile.js';
import { SetupError } from './context.js';

function openBrowser(url) {
  try {
    const [cmd, args] =
      process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* user can copy the link */
  }
}

/** One-time Pinterest login: local callback server, code exchange, tokens saved to .env. */
export async function runAuth(ctx) {
  const { env, cwd, log } = ctx;
  if (!env.PINTEREST_CLIENT_ID || !env.PINTEREST_CLIENT_SECRET) {
    throw new SetupError('Set PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET in .env first (from https://developers.pinterest.com/apps/).');
  }
  const redirectUri = env.PINTEREST_REDIRECT_URI || 'http://localhost:8085/callback';
  const { port, pathname } = new URL(redirectUri);
  const state = randomBytes(16).toString('hex');
  const authUrl =
    'https://www.pinterest.com/oauth/?' +
    new URLSearchParams({ client_id: env.PINTEREST_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: PINTEREST_SCOPES.join(','), state });

  const code = await new Promise((resolveCode, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, redirectUri);
      if (u.pathname !== pathname) {
        res.writeHead(404).end();
        return;
      }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(ok ? '<h2>PinHunter is connected to Pinterest ✅</h2><p>You can close this tab.</p>' : '<h2>Login failed</h2><p>Please run "pinhunter auth" again.</p>');
      server.close();
      ok ? resolveCode(u.searchParams.get('code')) : reject(new Error(u.searchParams.get('error_description') || 'Pinterest login was cancelled or the state did not match.'));
    });
    server.on('error', reject);
    server.listen(Number(port) || 80, () => {
      log(`Add this redirect URI to your Pinterest app if you have not already: ${redirectUri}`);
      log(`Opening Pinterest login… If nothing opens, visit:\n${authUrl}`);
      openBrowser(authUrl);
    });
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for the Pinterest login (5 minutes).'));
    }, 5 * 60 * 1000).unref();
  });

  const client = createPinterest({ clientId: env.PINTEREST_CLIENT_ID, clientSecret: env.PINTEREST_CLIENT_SECRET });
  const tokens = await client.exchangeCode(code, redirectUri);
  updateEnvFile(join(cwd, '.env'), { PINTEREST_ACCESS_TOKEN: tokens.access_token, PINTEREST_REFRESH_TOKEN: tokens.refresh_token });
  log('Saved PINTEREST_ACCESS_TOKEN and PINTEREST_REFRESH_TOKEN to .env.');
  log('For GitHub Actions, copy PINTEREST_REFRESH_TOKEN into your repository secrets.');
}
