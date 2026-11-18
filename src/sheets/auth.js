import { sign } from 'node:crypto';
import { fetchJSON } from '../util/http.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** Service-account JWT (RS256), signed with node:crypto so no Google SDK is needed. */
export function makeJWT(serviceAccount, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = b64url({ alg: 'RS256', typ: 'JWT' });
  const payload = b64url({ iss: serviceAccount.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 });
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), serviceAccount.private_key).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

export async function getGoogleToken(serviceAccount, fetchImpl = fetch) {
  const data = await fetchJSON(fetchImpl, TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: makeJWT(serviceAccount) }).toString(),
  });
  return data.access_token;
}
