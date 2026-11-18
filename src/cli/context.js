import { join } from 'node:path';
import { loadConfig, readServiceAccount } from '../config.js';
import { createAI } from '../ai/client.js';
import { createSheetQueue } from '../sheets/queue.js';
import { createPinterest } from '../pinterest/client.js';
import { updateEnvFile } from './envfile.js';

export class SetupError extends Error {}

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || ''));

export function buildContext({ cwd = process.cwd(), log = console.log, env: givenEnv } = {}) {
  const { env, prefs, configFile } = loadConfig({ cwd, ...(givenEnv ? { env: givenEnv } : {}) });
  return {
    cwd,
    env,
    prefs,
    configFile,
    log,
    ai() {
      if (!env.AI_PROVIDER) throw new SetupError('AI_PROVIDER is not set. Run "pinhunter init" and fill in .env (for example AI_PROVIDER=gemini).');
      return createAI({ provider: env.AI_PROVIDER, apiKey: env.AI_API_KEY, model: env.AI_MODEL, baseUrl: env.AI_BASE_URL });
    },
    queue() {
      if (!env.GOOGLE_SHEET_ID) throw new SetupError('GOOGLE_SHEET_ID is not set. Create a Google Sheet, share it with your service account email, and put its ID in .env.');
      const serviceAccount = readServiceAccount(env, cwd);
      if (!serviceAccount) throw new SetupError('Set GOOGLE_SERVICE_ACCOUNT_FILE (path to the JSON key) or GOOGLE_SERVICE_ACCOUNT_JSON in .env.');
      return createSheetQueue({ sheetId: env.GOOGLE_SHEET_ID, serviceAccount });
    },
    hasPinterest() {
      return Boolean(env.PINTEREST_ACCESS_TOKEN || (env.PINTEREST_REFRESH_TOKEN && env.PINTEREST_CLIENT_ID && env.PINTEREST_CLIENT_SECRET));
    },
    pinterest() {
      if (!this.hasPinterest()) throw new SetupError('Pinterest is not connected. Set PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET in .env, then run "pinhunter auth".');
      return createPinterest({
        accessToken: env.PINTEREST_ACCESS_TOKEN,
        refreshToken: env.PINTEREST_REFRESH_TOKEN,
        clientId: env.PINTEREST_CLIENT_ID,
        clientSecret: env.PINTEREST_CLIENT_SECRET,
        sandbox: truthy(env.PINTEREST_SANDBOX),
        onTokens: (t) => {
          if (process.env.GITHUB_ACTIONS) {
            if (t.refresh_token && t.refresh_token !== env.PINTEREST_REFRESH_TOKEN) {
              log('Note: Pinterest issued a new refresh token. Update the PINTEREST_REFRESH_TOKEN secret if runs start failing.');
            }
            return;
          }
          try {
            updateEnvFile(join(cwd, '.env'), { PINTEREST_ACCESS_TOKEN: t.access_token, PINTEREST_REFRESH_TOKEN: t.refresh_token });
          } catch {
            /* read-only folder: tokens still work for this run */
          }
        },
      });
    },
  };
}
