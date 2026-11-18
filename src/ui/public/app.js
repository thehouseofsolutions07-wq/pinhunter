// PinHunter dashboard: plain JS, no build step. All dynamic text goes in through textContent.

// ---------- session token ----------
const params = new URLSearchParams(location.search);
if (params.get('t')) {
  try { localStorage.setItem('ph_token', params.get('t')); } catch {}
}
if (params.has('t') || params.has('connected')) {
  if (params.get('connected') === 'pinterest') sessionStorage.setItem('ph_flash', 'Pinterest is connected.');
  history.replaceState(null, '', location.pathname + location.hash);
}
let TOKEN = '';
try { TOKEN = localStorage.getItem('ph_token') || ''; } catch {}
// Hosted mode (pinhunter on a web host): logged in with a password cookie instead of the token.
let HOSTED = false;
let LOGGED_IN = Boolean(TOKEN);

// ---------- helpers ----------
const main = document.getElementById('main');

/** Replace a node's children, skipping null/false so they never show up as text. */
function put(node, ...kids) {
  node.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
}

/** Tiny element builder: el('div', {class: 'x', onclick}, 'text', child). Strings become text nodes. */
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = Boolean(v);
    else if (k === 'style') n.style.cssText = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) n.append(kid instanceof Node ? kid : String(kid));
  return n;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { ...(TOKEN ? { 'x-pinhunter-token': TOKEN } : {}), 'x-pinhunter-csrf': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && HOSTED && !path.startsWith('/api/login')) {
    LOGGED_IN = false;
    showLogin();
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.setup = data.setup;
    throw err;
  }
  return data;
}

function toast(msg, bad = false) {
  const t = el('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), bad ? 7000 : 3500);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    toast('Could not copy. Select the text and copy it yourself.', true);
  }
}

const STATUS_LABEL = { NEEDS_IMAGE: 'Needs image', READY: 'Ready', POSTED: 'Posted', ERROR: 'Error', SKIP: 'Skipped' };
const normStatus = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '_');
const statusPill = (s) => el('span', { class: `pill st-${normStatus(s)}` }, STATUS_LABEL[normStatus(s)] || s || '—');
const head = (title, lead, ...right) => el('div', { class: 'head' }, el('div', {}, el('h1', {}, title), lead ? el('p', { class: 'lead' }, lead) : null), right.length ? el('div', { class: 'actions' }, right) : null);
const loading = (text = 'Loading…') => el('p', { class: 'muted' }, el('span', { class: 'spin' }), ' ', text);
const errorBox = (e) =>
  el('div', { class: 'panel' }, el('h2', {}, e.setup ? 'Setup needed' : 'Something went wrong'), el('p', { class: 'muted' }, e.message), e.setup ? el('a', { class: 'btn primary', href: '#setup' }, 'Go to Keys & connections') : null);

function setNavCounts(counts) {
  document.getElementById('nav-needs').textContent = counts?.NEEDS_IMAGE || '';
  document.getElementById('nav-ready').textContent = counts?.READY || '';
}

// ---------- jobs (hunt / publish) ----------
async function runJob(type, dryRun, logBox, onDone) {
  put(logBox, el('span', { class: 'muted' }, `Starting ${type}…`));
  let job;
  try {
    const { id } = await api('/api/jobs', { method: 'POST', body: { type, dryRun } });
    for (;;) {
      job = await api(`/api/jobs/${id}`);
      const lines = job.log.map((line) => el('div', { class: /✓|Added|posted/.test(line) ? 'ok' : /✗|Error|skipped|failed/i.test(line) ? 'bad' : '' }, line));
      if (job.status === 'running') lines.push(el('div', { class: 'muted' }, el('span', { class: 'spin' }), ' working…'));
      put(logBox, ...lines);
      logBox.scrollTop = logBox.scrollHeight;
      if (job.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (e) {
    logBox.append(el('div', { class: 'bad' }, e.message));
    toast(e.message, true);
    return onDone?.(null);
  }
  if (job.status === 'error') toast(job.error, true);
  onDone?.(job);
}

// ---------- views ----------
const views = {
  async overview() {
    const tiles = el('div', { class: 'tiles' });
    const checks = el('ul', { class: 'checks' }, el('li', {}, loading('Checking your connections…')));
    const recent = el('div', {});
    put(main, 
      head('Overview', 'Find products, finish the pin, post it. Here is where things stand.', el('a', { class: 'btn primary', href: '#hunt' }, '⌕ Hunt now'), el('a', { class: 'btn', href: '#publish' }, '➚ Publish')),
      tiles,
      el('div', { class: 'grid g2' },
        el('section', { class: 'panel' }, el('div', { class: 'group-head' }, el('h2', {}, 'Connections'), el('button', { onclick: () => loadChecks() }, 'Re-check')), checks),
        el('section', { class: 'panel' }, el('h2', {}, 'How it works'),
          el('ol', { class: 'small' },
            el('li', {}, el('b', {}, 'Hunt'), ' finds products and writes pin drafts (title, description, link, board).'),
            el('li', {}, el('b', {}, 'You'), ' make the picture, paste its link on the draft, and mark it Ready.'),
            el('li', {}, el('b', {}, 'Publish'), ' posts Ready pins to Pinterest and saves the pin link.')),
          el('h3', {}, 'Recently posted'), recent)),
    );
    async function loadChecks() {
      put(checks, el('li', {}, loading('Checking your connections…')));
      try {
        const { checks: list } = await api('/api/checks');
        put(checks, ...list.map((c) =>
          el('li', {}, el('span', { class: `dot ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : ''}` }), el('div', {}, el('b', {}, c.name), el('div', { class: 'note' }, c.note)))));
      } catch (e) {
        put(checks, el('li', {}, e.message));
      }
    }
    loadChecks();
    try {
      const o = await api('/api/overview');
      setNavCounts(o.counts);
      if (!o.counts) {
        tiles.replaceWith(el('div', { class: 'panel', style: 'margin-bottom:18px' }, el('b', {}, 'Your Google Sheet is not connected yet. '), el('span', { class: 'muted' }, o.error), ' ', el('a', { href: '#setup' }, 'Set it up →')));
        return;
      }
      const tile = (key, cls, label) => el('a', { class: `tile ${cls}`, href: `#drafts/${key}` }, el('div', { class: 'n' }, o.counts[key] || 0), el('div', { class: 'l' }, label));
      put(tiles, tile('NEEDS_IMAGE', 'needs', 'Need an image'), tile('READY', 'ready', 'Ready to post'), tile('POSTED', 'posted', 'Posted'), tile('ERROR', 'error', 'Errors'), tile('SKIP', '', 'Skipped'));
      put(recent, 
        o.recent.length
          ? el('ul', { class: 'small' }, o.recent.map((d) => el('li', {}, d.pin_url ? el('a', { href: d.pin_url, target: '_blank', rel: 'noopener' }, d.pin_title || d.product) : d.pin_title || d.product)))
          : el('p', { class: 'muted small' }, 'Nothing posted yet.'),
        o.sheetUrl ? el('a', { class: 'btn', href: o.sheetUrl, target: '_blank', rel: 'noopener' }, 'Open the Google Sheet ↗') : null,
      );
    } catch (e) {
      tiles.replaceWith(errorBox(e));
    }
  },

  async drafts(filter = 'NEEDS_IMAGE') {
    put(main, head('Drafts', 'Add a picture to each pin, check it, then mark it Ready.'), loading());
    let data, boards = [];
    try {
      [data, { boards }] = await Promise.all([api('/api/drafts'), api('/api/boards').catch(() => ({ boards: [] }))]);
    } catch (e) {
      put(main, head('Drafts'), errorBox(e));
      return;
    }
    const drafts = data.drafts.slice().reverse();
    const counts = {};
    for (const d of drafts) counts[normStatus(d.status)] = (counts[normStatus(d.status)] || 0) + 1;
    setNavCounts(counts);
    const list = el('div', { class: 'cards' });
    const tabs = el('div', { class: 'tabs', role: 'tablist' });
    const tabDefs = [['NEEDS_IMAGE', 'Needs image'], ['READY', 'Ready'], ['ERROR', 'Errors'], ['POSTED', 'Posted'], ['SKIP', 'Skipped'], ['ALL', 'All']];
    function show(f) {
      filter = f;
      history.replaceState(null, '', `#drafts/${f}`);
      put(tabs, ...tabDefs.map(([k, label]) => el('button', { class: k === f ? 'on' : '', role: 'tab', 'aria-selected': String(k === f), onclick: () => show(k) }, `${label} ${k === 'ALL' ? drafts.length : counts[k] || 0}`)));
      const shown = f === 'ALL' ? drafts : drafts.filter((d) => normStatus(d.status) === f);
      put(list, ...(shown.length ? shown.map((d) => draftCard(d, boards)) : [el('div', { class: 'empty panel', style: 'grid-column:1/-1' }, el('div', { class: 'big' }, '∅'), el('p', {}, f === 'NEEDS_IMAGE' ? 'No drafts waiting for a picture. Run a hunt to get new ones.' : 'Nothing here.'), el('a', { class: 'btn primary', href: '#hunt' }, 'Hunt for products'))]));
    }
    put(main, head('Drafts', 'Add a picture to each pin, check it, then mark it Ready.', data.sheetUrl ? el('a', { class: 'btn', href: data.sheetUrl, target: '_blank', rel: 'noopener' }, 'Open Sheet ↗') : null), tabs, list);
    show(tabDefs.some(([k]) => k === filter) ? filter : 'NEEDS_IMAGE');
  },

  hunt() {
    const logBox = el('div', { class: 'log', role: 'log' }, el('span', { class: 'muted' }, 'The hunt log appears here.'));
    const dry = el('input', { type: 'checkbox', id: 'dry' });
    const result = el('div', {});
    const btn = el('button', {
      class: 'primary',
      onclick: () => {
        btn.disabled = true;
        put(result, );
        runJob('hunt', dry.checked, logBox, (job) => {
          btn.disabled = false;
          if (job?.status !== 'done') return;
          if (!job.result.count) {
            put(result, el('div', { class: 'panel' }, el('h2', {}, 'No new products this time'),
              el('p', { class: 'muted' }, 'Turn on a product source that has keys (AliExpress or Amazon on the Keys page), add your own affiliate links to the Products tab of your Sheet, or widen the price range in Settings.'),
              el('div', { class: 'actions' }, el('a', { class: 'btn primary', href: '#setup' }, 'Add product keys'), el('a', { class: 'btn', href: '#settings' }, 'Settings'))));
            return;
          }
          if (job.dryRun) {
            put(result, el('h2', {}, `Preview: ${job.result.count} drafts (not saved)`), el('div', { class: 'cards' }, (job.result.drafts || []).map((d) => draftCard(d, [], true))));
          } else {
            toast(`${job.result.count} new drafts added`);
            put(result, el('div', { class: 'panel' }, el('h2', {}, `${job.result.count} new drafts are ready for pictures`), el('a', { class: 'btn primary', href: '#drafts/NEEDS_IMAGE' }, 'Go to drafts →')));
          }
        });
      },
    }, '⌕ Start hunt');
    put(main, 
      head('Hunt for products', 'The AI picks search words from your niches, finds best-selling products, scores them, and writes a pin draft for the best ones.'),
      el('div', { class: 'panel stack' },
        el('div', { class: 'actions' }, btn, el('label', { class: 'check', for: 'dry' }, dry, 'Dry run (preview only, nothing is saved)'), el('a', { href: '#settings', class: 'small' }, 'Change niches and sources')),
        logBox),
      el('div', { style: 'margin-top:18px' }, result),
    );
  },

  async publish() {
    const logBox = el('div', { class: 'log', role: 'log' }, el('span', { class: 'muted' }, 'The publish log appears here.'));
    const dry = el('input', { type: 'checkbox', id: 'dry' });
    const info = el('p', { class: 'muted' }, loading('Counting ready pins…'));
    const btn = el('button', {
      class: 'primary',
      onclick: () => {
        btn.disabled = true;
        runJob('publish', dry.checked, logBox, (job) => {
          btn.disabled = false;
          if (job?.status === 'done' && !job.dryRun) toast(`${job.result.posted} posted, ${job.result.failed} failed`, job.result.failed > 0);
          refresh();
        });
      },
    }, '➚ Publish ready pins');
    put(main, 
      head('Publish', 'Posts every draft marked Ready to its Pinterest board, then saves the live pin link.'),
      el('div', { class: 'panel stack' }, info, el('div', { class: 'actions' }, btn, el('label', { class: 'check', for: 'dry' }, dry, 'Dry run (check everything, post nothing)')), logBox),
    );
    async function refresh() {
      try {
        const o = await api('/api/overview');
        setNavCounts(o.counts);
        const n = o.counts?.READY || 0;
        put(info, n ? `${n} pin${n === 1 ? ' is' : 's are'} ready to post.` : 'No pins are Ready yet. Add a picture to a draft and mark it Ready first. ', n ? null : el('a', { href: '#drafts' }, 'Open drafts →'));
      } catch (e) {
        put(info, e.message);
      }
    }
    refresh();
  },

  async setup() {
    put(main, head('Keys & connections', 'Paste each key once. Saved keys stay on this computer in .env and are never shown again.'), loading());
    let s;
    try {
      s = await api('/api/settings');
    } catch (e) {
      put(main, head('Keys & connections'), errorBox(e));
      return;
    }
    const statusByGroup = {};
    const checkMap = { ai: 'AI', sheet: 'Google Sheet', pinterest: 'Pinterest', aliexpress: 'Source: aliexpress', amazon: 'Source: amazon', notify: 'Notifications' };
    const groups = s.groups.map((g) => {
      const fields = s.fields.filter((f) => f.group === g.id);
      const inputs = {};
      const pill = el('span', { class: 'pill' }, '…');
      statusByGroup[g.id] = pill;
      const rows = fields.map((f) => {
        const id = `f-${f.key}`;
        let input;
        if (f.type === 'select') input = el('select', { id }, el('option', { value: '' }, '— choose —'), f.options.map((o) => el('option', { value: o }, o)));
        else if (f.type === 'bool') input = el('input', { type: 'checkbox', id, checked: /^(1|true|yes|on)$/i.test(f.value || '') });
        else if (f.type === 'textarea') input = el('textarea', { id, placeholder: f.set ? `Saved (${f.hint}). Leave empty to keep it.` : 'Paste here' });
        else input = el('input', { type: f.secret ? 'password' : 'text', id, autocomplete: 'off', spellcheck: 'false', placeholder: f.secret ? (f.set ? `Saved (${f.hint}). Leave empty to keep it.` : 'Not set') : f.placeholder || '' });
        if (!f.secret && f.type !== 'bool') input.value = f.value || '';
        inputs[f.key] = input;
        return f.type === 'bool'
          ? el('div', { class: 'field' }, el('label', { class: 'check', for: id }, input, f.label))
          : el('div', { class: 'field' }, el('label', { for: id }, f.label, f.secret && f.set ? el('span', { class: 'pill ok', style: 'margin-left:6px' }, 'saved') : null), input);
      });
      const extras = [];
      if (g.id === 'sheet') {
        extras.push(s.serviceAccountEmail
          ? el('div', {}, el('div', { class: 'small muted' }, 'Share your Sheet with this email as Editor:'), el('div', { class: 'copy' }, el('code', {}, s.serviceAccountEmail), el('button', { type: 'button', onclick: () => copy(s.serviceAccountEmail) }, 'Copy')))
          : el('p', { class: 'small muted' }, 'Add the service account key to see the email to share your Sheet with.'));
      }
      if (g.id === 'pinterest') {
        const redirect = fields.find((f) => f.key === 'PINTEREST_REDIRECT_URI')?.value || `${location.origin}/callback`;
        extras.push(
          el('div', { class: 'small muted' }, 'Add this redirect URI to your Pinterest app:'),
          el('div', { class: 'copy' }, el('code', {}, redirect), el('button', { type: 'button', onclick: () => copy(redirect) }, 'Copy')),
          el('div', { class: 'actions', style: 'margin-bottom:12px' }, el('button', {
            type: 'button',
            class: 'primary',
            onclick: async () => {
              try {
                const { url } = await api('/api/pinterest/connect');
                location.href = url;
              } catch (e) {
                toast(e.message, true);
              }
            },
          }, 'Connect Pinterest')),
        );
      }
      const save = el('button', {
        class: 'primary',
        onclick: async () => {
          const env = {};
          for (const f of fields) {
            const inp = inputs[f.key];
            env[f.key] = f.type === 'bool' ? String(inp.checked) : inp.value;
          }
          save.disabled = true;
          try {
            await api('/api/settings', { method: 'PUT', body: { env } });
            toast(`${g.title} saved`);
            views.setup();
          } catch (e) {
            toast(e.message, true);
            save.disabled = false;
          }
        },
      }, 'Save');
      return el('section', { class: 'panel' },
        el('div', { class: 'group-head' }, el('div', {}, el('h2', {}, g.title), el('p', { class: 'small muted', style: 'margin:0' }, g.help)), pill),
        g.link ? el('p', { class: 'small', style: 'margin-top:0' }, el('a', { href: g.link, target: '_blank', rel: 'noopener' }, 'Where to get these keys ↗')) : null,
        extras, rows, el('div', { class: 'actions' }, save));
    });
    put(main, 
      head('Keys & connections', 'Paste each key once. Saved keys stay on this computer in .env and are never shown again.', el('button', { onclick: () => loadChecks() }, 'Test connections')),
      el('div', { class: 'grid g2' }, groups),
    );
    async function loadChecks() {
      Object.values(statusByGroup).forEach((p) => put(p, el('span', { class: 'spin' })));
      try {
        const { checks } = await api('/api/checks');
        for (const [gid, name] of Object.entries(checkMap)) {
          const c = checks.find((x) => x.name === name);
          const p = statusByGroup[gid];
          if (!p) continue;
          if (!c) {
            p.className = 'pill';
            p.textContent = gid === 'aliexpress' || gid === 'amazon' ? 'not enabled' : '—';
            p.title = gid === 'aliexpress' || gid === 'amazon' ? 'Turn this source on in Settings.' : '';
          } else {
            p.className = `pill ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : ''}`;
            p.textContent = c.ok === true ? 'connected' : c.ok === false ? 'not working' : 'optional';
            p.title = c.note;
          }
        }
      } catch (e) {
        toast(e.message, true);
      }
    }
    loadChecks();
  },

  async settings() {
    put(main, head('Settings', 'What to hunt for and how pins are written.'), loading());
    let s, boards = [];
    try {
      [s, { boards }] = await Promise.all([api('/api/settings'), api('/api/boards').catch(() => ({ boards: [] }))]);
    } catch (e) {
      put(main, head('Settings'), errorBox(e));
      return;
    }
    const p = s.prefs;
    const f = {};
    const field = (key, label, input, hint) => {
      f[key] = input;
      input.id = `p-${key}`;
      return el('div', { class: 'field' }, el('label', { for: input.id }, label), input, hint ? el('div', { class: 'hint' }, hint) : null);
    };
    const srcBoxes = ['aliexpress', 'amazon', 'feed', 'mock'].map((name) => {
      const box = el('input', { type: 'checkbox', checked: (p.sources || []).includes(name) });
      box.dataset.name = name;
      const label = { aliexpress: 'AliExpress (needs AliExpress keys)', amazon: 'Amazon (beta, needs Creators API keys)', feed: 'My own links (Products tab of the Sheet: Gumroad, ClickBank…)', mock: 'Sample products (for trying it out)' }[name];
      return el('label', { class: 'check' }, box, label);
    });
    const boardList = el('datalist', { id: 'boardnames' }, boards.map((b) => el('option', { value: b.name })));
    const mapRows = el('div', {});
    const addMap = (niche = '', board = '') => {
      const row = el('div', { class: 'map-row' }, el('input', { type: 'text', value: niche, placeholder: 'niche (e.g. kitchen)', 'aria-label': 'Niche' }), el('input', { type: 'text', value: board, placeholder: 'board name', list: 'boardnames', 'aria-label': 'Board' }), el('button', { type: 'button', class: 'danger', 'aria-label': 'Remove', onclick: () => row.remove() }, '✕'));
      mapRows.append(row);
    };
    for (const [k, v] of Object.entries(p.boards || {})) addMap(k, v);
    if (!Object.keys(p.boards || {}).length) addMap();

    const save = el('button', {
      class: 'primary',
      onclick: async () => {
        const boardsMap = {};
        for (const row of mapRows.children) {
          const [a, b] = row.querySelectorAll('input');
          if (a.value.trim() && b.value.trim()) boardsMap[a.value.trim()] = b.value.trim();
        }
        const prefs = {
          niches: f.niches.value.split('\n'),
          keywords: f.keywords.value.split('\n'),
          sources: srcBoxes.map((l) => l.querySelector('input')).filter((b) => b.checked).map((b) => b.dataset.name),
          draftsPerRun: f.draftsPerRun.value,
          keywordsPerRun: f.keywordsPerRun.value,
          maxPostsPerRun: f.maxPostsPerRun.value,
          postDelaySeconds: f.postDelaySeconds.value,
          priceRange: { min: f.priceMin.value, max: f.priceMax.value },
          market: { country: f.country.value, currency: f.currency.value, language: f.marketLang.value },
          boards: boardsMap,
          disclosure: f.disclosure.value,
          tone: f.tone.value,
          language: f.language.value,
        };
        if (!prefs.sources.length) return toast('Choose at least one product source.', true);
        save.disabled = true;
        try {
          await api('/api/settings', { method: 'PUT', body: { prefs } });
          toast('Settings saved');
        } catch (e) {
          toast(e.message, true);
        }
        save.disabled = false;
      },
    }, 'Save settings');

    put(main, 
      head('Settings', 'What to hunt for and how pins are written.'),
      el('div', { class: 'grid g2' },
        el('section', { class: 'panel' }, el('h2', {}, 'What to hunt'),
          field('niches', 'Niches (one per line)', el('textarea', { value: (p.niches || []).join('\n') }), 'The AI turns these into search words each run.'),
          field('keywords', 'Fixed search words (optional, one per line)', el('textarea', { value: (p.keywords || []).join('\n') })),
          el('div', { class: 'field' }, el('label', {}, 'Where products come from'), srcBoxes),
          el('div', { class: 'row' },
            field('priceMin', 'Min price', el('input', { type: 'number', min: 0, step: 'any', value: p.priceRange?.min ?? 0 })),
            field('priceMax', 'Max price (0 = no limit)', el('input', { type: 'number', min: 0, step: 'any', value: p.priceRange?.max ?? 0 }))),
          el('div', { class: 'row' },
            field('country', 'Country', el('input', { type: 'text', value: p.market?.country || 'US' })),
            field('currency', 'Currency', el('input', { type: 'text', value: p.market?.currency || 'USD' })),
            field('marketLang', 'Shop language', el('input', { type: 'text', value: p.market?.language || 'EN' })))),
        el('section', { class: 'panel' }, el('h2', {}, 'How much and how often'),
          el('div', { class: 'row' },
            field('draftsPerRun', 'Drafts per hunt', el('input', { type: 'number', min: 1, value: p.draftsPerRun ?? 5 })),
            field('keywordsPerRun', 'Search words per hunt', el('input', { type: 'number', min: 1, value: p.keywordsPerRun ?? 3 }))),
          el('div', { class: 'row' },
            field('maxPostsPerRun', 'Max pins per publish', el('input', { type: 'number', min: 1, value: p.maxPostsPerRun ?? 5 })),
            field('postDelaySeconds', 'Seconds between pins', el('input', { type: 'number', min: 0, value: p.postDelaySeconds ?? 30 }))),
          el('h2', { style: 'margin-top:8px' }, 'Pin writing'),
          field('tone', 'Tone', el('input', { type: 'text', value: p.tone || '' })),
          field('language', 'Language of the pins', el('input', { type: 'text', value: p.language || 'English' })),
          field('disclosure', 'Affiliate disclosure (added to every pin)', el('input', { type: 'text', value: p.disclosure || '' }), 'Required by Pinterest and the FTC. Keep it short.')),
        el('section', { class: 'panel', style: 'grid-column:1/-1' }, el('h2', {}, 'Which board each niche goes to'),
          el('p', { class: 'small muted' }, boards.length ? 'Start typing to pick one of your boards.' : 'Connect Pinterest to pick from your boards. Otherwise type the exact board name.'),
          boardList, mapRows, el('button', { type: 'button', onclick: () => addMap() }, '+ Add a niche'))),
      el('div', { class: 'actions', style: 'margin-top:16px' }, save),
    );
  },
};

// ---------- draft card ----------
function draftCard(d, boards = [], readOnly = false) {
  const status = normStatus(d.status);
  const thumb = el('div', { class: 'thumb' }, 'No picture yet');
  const imageInput = el('input', { type: 'url', value: d.image_url || '', placeholder: 'Paste the image link (Google Drive, Dropbox, Canva…)', 'aria-label': 'Image link' });
  const title = el('input', { type: 'text', value: d.pin_title || '', maxlength: 100, 'aria-label': 'Pin title' });
  const desc = el('textarea', { value: d.pin_description || '', maxlength: 800, 'aria-label': 'Pin description' });
  const alt = el('input', { type: 'text', value: d.alt_text || '', maxlength: 500, 'aria-label': 'Alt text' });
  const boardInput = boards.length
    ? el('select', { 'aria-label': 'Board' }, !boards.some((b) => b.name === d.board) && d.board ? el('option', { value: d.board }, `${d.board} (not found)`) : null, boards.map((b) => el('option', { value: b.name }, b.name)))
    : el('input', { type: 'text', value: d.board || '', 'aria-label': 'Board' });
  boardInput.value = d.board || boardInput.value;
  const imgMsg = el('div', { class: 'small muted' });

  async function preview() {
    const url = imageInput.value.trim();
    if (!url) return;
    put(imgMsg, el('span', { class: 'spin' }), ' checking image…');
    try {
      const res = await fetch(`/api/image?url=${encodeURIComponent(url)}`, { headers: TOKEN ? { 'x-pinhunter-token': TOKEN } : {} });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load the image.');
      const blobUrl = URL.createObjectURL(await res.blob());
      put(thumb, );
      thumb.classList.add('has');
      thumb.style.backgroundImage = `url("${blobUrl}")`;
      put(imgMsg, el('span', { class: 'pill ok' }, '✓ image works'));
      return true;
    } catch (e) {
      thumb.classList.remove('has');
      thumb.style.backgroundImage = '';
      put(thumb, 'No picture yet');
      put(imgMsg, el('span', { class: 'err' }, e.message));
      return false;
    }
  }

  async function save(newStatus) {
    const body = { image_url: imageInput.value.trim(), pin_title: title.value, pin_description: desc.value, alt_text: alt.value, board: boardInput.value };
    if (newStatus) body.status = newStatus;
    if (newStatus === 'READY') {
      if (!body.image_url) return toast('Paste an image link first.', true);
      if (!(await preview())) return toast('That image link does not work yet. Fix it, then mark Ready.', true);
    }
    try {
      await api(`/api/drafts/${d.row}`, { method: 'PATCH', body });
      toast(newStatus === 'READY' ? 'Marked Ready' : newStatus === 'SKIP' ? 'Skipped' : 'Saved');
      const current = (location.hash.split('/')[1] || 'NEEDS_IMAGE');
      views.drafts(current);
    } catch (e) {
      toast(e.message, true);
    }
  }

  if (d.image_url && !readOnly) setTimeout(preview, 0);
  const facts = [d.price ? el('span', { class: 'pill' }, d.price) : null, d.score ? el('span', { class: 'pill brand', title: 'PinHunter score out of 10' }, `★ ${d.score}`) : null, d.source ? el('span', { class: 'pill' }, d.source) : null];

  return el('article', { class: 'card' },
    el('div', { class: 'top' }, thumb,
      el('div', { class: 'meta' }, el('div', { class: 'actions', style: 'justify-content:space-between' }, statusPill(d.status), d.row ? el('span', { class: 'small muted' }, `row ${d.row}`) : null),
        el('div', { class: 'product', title: d.product }, d.product), el('div', { class: 'facts' }, facts), d.why_picked ? el('div', { class: 'why' }, d.why_picked) : null)),
    el('div', { class: 'body' },
      status === 'ERROR' && d.error ? el('div', { class: 'err', style: 'margin-bottom:10px' }, d.error) : null,
      status === 'POSTED' && d.pin_url ? el('p', {}, el('a', { href: d.pin_url, target: '_blank', rel: 'noopener' }, 'View the live pin ↗')) : null,
      d.image_brief ? el('div', { class: 'field' }, el('label', {}, 'Picture to make'), el('div', { class: 'brief' }, d.image_brief)) : null,
      readOnly
        ? [el('h3', {}, d.pin_title), el('p', { class: 'small' }, d.pin_description), el('p', { class: 'small muted' }, `Board: ${d.board}`)]
        : [
            el('div', { class: 'field' }, el('label', {}, 'Image link'), el('div', { class: 'row' }, imageInput, el('button', { type: 'button', style: 'flex:none', onclick: preview }, 'Check')), imgMsg),
            el('div', { class: 'field' }, el('label', {}, 'Board'), boardInput),
            el('details', {}, el('summary', {}, 'Edit title, description and alt text'),
              el('div', { class: 'field' }, el('label', {}, 'Title (100 max)'), title),
              el('div', { class: 'field' }, el('label', {}, 'Description (800 max)'), desc),
              el('div', { class: 'field' }, el('label', {}, 'Alt text'), alt)),
          ],
      d.affiliate_link ? el('p', { class: 'small', style: 'margin:6px 0 0;overflow-wrap:anywhere' }, el('a', { href: d.affiliate_link, target: '_blank', rel: 'noopener' }, 'Open the product link ↗')) : null),
    readOnly || status === 'POSTED'
      ? null
      : el('div', { class: 'foot actions' },
          status === 'READY'
            ? el('button', { onclick: () => save('NEEDS_IMAGE') }, '↩ Not ready yet')
            : el('button', { class: 'primary', onclick: () => save('READY') }, '✓ Mark Ready'),
          el('button', { onclick: () => save() }, 'Save'),
          status !== 'SKIP' ? el('button', { class: 'danger', onclick: () => save('SKIP') }, 'Skip') : el('button', { onclick: () => save('NEEDS_IMAGE') }, 'Restore')),
  );
}

// ---------- login (hosted mode) ----------
function showLogin(message = '') {
  for (const a of document.querySelectorAll('#nav a')) a.classList.remove('on');
  const pw = el('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true, autofocus: true });
  const msg = el('p', { class: 'muted', role: 'alert' }, message);
  const btn = el('button', { class: 'primary', type: 'submit' }, 'Log in');
  const form = el('form', {
    class: 'panel login',
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        await api('/api/login', { method: 'POST', body: { password: pw.value } });
        LOGGED_IN = true;
        route();
      } catch (err) {
        put(msg, err.message);
        pw.select();
      } finally {
        btn.disabled = false;
      }
    },
  }, el('h1', {}, 'Log in to PinHunter'), el('label', { for: 'pw' }, 'Password'), pw, btn, msg);
  put(main, form);
  pw.focus();
}

async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  LOGGED_IN = false;
  showLogin('You are logged out.');
}

// ---------- router ----------
function route() {
  if (HOSTED && !LOGGED_IN) return showLogin();
  if (!LOGGED_IN) {
    put(main, el('div', { class: 'panel' }, el('h1', {}, 'Open PinHunter from your terminal'), el('p', {}, 'Run ', el('code', {}, 'npm run ui'), ' (or ', el('code', {}, 'pinhunter ui'), ') in the PinHunter folder. It opens this page with your private session link.')));
    return;
  }
  const [name, arg] = (location.hash.slice(1) || 'overview').split('/');
  const view = views[name] ? name : 'overview';
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('on', a.dataset.view === view);
  Promise.resolve()
    .then(() => views[view](arg))
    .catch((e) => put(main, errorBox(e)));
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
fetch('/api/session', { headers: TOKEN ? { 'x-pinhunter-token': TOKEN } : {} })
  .then((r) => r.json())
  .catch(() => ({}))
  .then((s) => {
    HOSTED = Boolean(s.hosted);
    LOGGED_IN = Boolean(s.loggedIn);
    if (HOSTED) {
      document.querySelector('.side-foot').textContent = 'Online version. Keys stay on your server.';
      document.getElementById('nav').append(el('a', { href: '#', onclick: (e) => { e.preventDefault(); logout(); } }, el('span', { class: 'ico' }, '⏻'), 'Log out'));
    }
    route();
  });
const flash = sessionStorage.getItem('ph_flash');
if (flash) {
  sessionStorage.removeItem('ph_flash');
  toast(flash);
}
