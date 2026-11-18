/** Post a short message to a Discord/Slack (or any JSON) webhook. Never throws: a failed ping must not fail a run. */
export async function notify(url, text, fetchImpl = fetch, log = () => {}) {
  if (!url) return false;
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  })();
  const body = /discord(app)?\.com$/.test(host) ? { content: text } : /slack\.com$/.test(host) ? { text } : { text, content: text };
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) log(`Notification webhook answered HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    log(`Notification failed: ${e.message}`);
    return false;
  }
}
