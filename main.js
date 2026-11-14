const { app, BrowserWindow, ipcMain, session, safeStorage, protocol, net, shell } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const { Store, PROVIDERS, uid } = require('./src/store');
const llm = require('./src/llm');
const pipeline = require('./src/pipeline');
const { extractUrl, EXTRACT_SCRIPT } = require('./src/extract');

const PARTITION = 'persist:clew-web';
let store, mainWin, browserWin;

protocol.registerSchemesAsPrivileged([{ scheme: 'clew-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// Sites sometimes block "Electron" in the user agent; look like plain Chrome instead.
app.userAgentFallback = app.userAgentFallback.replace(/\s?(Electron|clew|Clew)\/\S+/g, '');

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---------- API keys (encrypted with Windows' own protection when available) ----------
function setKey(p, key) {
  if (!key) { p.keyEnc = ''; p.keyPlain = ''; return; }
  if (safeStorage.isEncryptionAvailable()) { p.keyEnc = safeStorage.encryptString(key).toString('base64'); p.keyPlain = ''; }
  else { p.keyPlain = key; p.keyEnc = ''; }
}
function getKey(p) {
  try { if (p.keyEnc) return safeStorage.decryptString(Buffer.from(p.keyEnc, 'base64')); } catch (e) { return ''; }
  return p.keyPlain || '';
}

// ---------- State sent to the window (never includes keys) ----------
function publicState() {
  const d = store.data;
  const providers = {};
  for (const [id, p] of Object.entries(d.settings.providers)) {
    providers[id] = { label: PROVIDERS[id].label, baseUrl: p.baseUrl, model: p.model, visionModel: p.visionModel || '', hasKey: !!(p.keyEnc || p.keyPlain), status: p.status, message: p.message };
  }
  return {
    items: d.items, topics: d.topics, chains: d.chains, reminders: d.reminders, today: today(),
    settings: { providers, roles: d.settings.roles, lateDays: d.settings.lateDays, minTopic: d.settings.minTopic, dataDir: store.dir, encrypted: safeStorage.isEncryptionAvailable() }
  };
}
function push() {
  store.save();
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('state', publicState());
}

// ---------- Processing queue ----------
let running = false;
async function runQueue() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const item = store.data.items.find((x) => x.status === 'queued');
      if (!item) break;
      item.status = 'processing';
      push();
      try { await processItem(item); }
      catch (e) { item.status = 'error'; item.error = String(e.message || e).slice(0, 300); }
      push();
    }
  } finally { running = false; }
}

// Which models to try for reading screenshots, best first.
function eyesCandidates() {
  const s = store.data.settings;
  const mode = s.roles.eyes || 'auto';
  if (mode === 'off') return [];
  const ids = mode === 'auto'
    ? [s.roles.brain].concat(Object.keys(s.providers)).filter((id, i, a) => id && a.indexOf(id) === i)
    : [mode];
  const out = [];
  for (const id of ids) {
    const p = s.providers[id];
    if (!p) continue;
    const key = getKey(p);
    const model = (p.visionModel || '').trim();
    if (!key || !model) continue;
    if (mode === 'auto' && p.status === 'fail') continue;
    out.push({ id, p, key, model });
  }
  return mode === 'auto' ? out.slice(0, 2) : out;
}

function brainProvider() {
  const s = store.data.settings;
  const id = s.roles.brain;
  if (!id) throw new Error('No model picked yet. Open Settings, add an API key, and choose a model for "Brain".');
  const p = s.providers[id];
  const key = getKey(p);
  if (!key) throw new Error('The model picked for "Brain" (' + PROVIDERS[id].label + ') has no API key.');
  return { p, key };
}

async function processItem(item) {
  // 1. Get the text
  if (item.kind === 'link' && !item.rawText) {
    const r = await extractUrl(BrowserWindow, session.fromPartition(PARTITION), item.url);
    item.rawTitle = r.title; item.rawText = r.text; item.siteName = r.siteName; item.pageDate = r.pub; item.url = r.url || item.url;
  }
  if (item.kind === 'shot' && !item.rawText) {
    const cands = eyesCandidates();
    item.visionNote = cands.length ? null : 'No model that can read images is connected (MiMo or Kimi can), so only your caption was used.';
    const file = path.join(store.imgDir, item.image);
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
    for (const c of cands) {
      try {
        const b64 = fs.readFileSync(file).toString('base64');
        const r = await llm.chat({ baseUrl: c.p.baseUrl, model: c.model }, c.key, [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } },
          { type: 'text', text: '把这张截图里的文字完整提取出来，然后用一两句话说明截图在讲什么。如果截图里有日期、发布者或来源，也写出来。只输出提取结果。' }
        ] }], { maxTokens: 6000, timeoutMs: 180000 });
        if (!r.text || r.text.trim().length < 2) throw new Error('the model returned nothing');
        item.rawText = r.text;
        item.visionNote = null;
        item.visionBy = PROVIDERS[c.id].label + ' · ' + c.model;
        break;
      } catch (e) {
        item.visionNote = 'Couldn\'t read the screenshot with ' + PROVIDERS[c.id].label + ' (' + c.model + '): ' + String(e.message).slice(0, 200);
      }
    }
    if (!item.rawText && !String(item.userText || '').trim()) {
      throw new Error((item.visionNote || 'The screenshot couldn\'t be read') + ' — Check "Eyes" in Settings, or add a caption, then hit Try again.');
    }
  }
  // 2. Ask the model to tidy and link it
  const { p, key } = brainProvider();
  const r = await llm.chat(p, key, [
    { role: 'system', content: pipeline.SYSTEM_PROMPT },
    { role: 'user', content: pipeline.buildUserPrompt(store.data, item, today()) }
  ], { maxTokens: 8000, timeoutMs: 180000 });
  let parsed;
  try { parsed = llm.parseJSON(r.text); }
  catch (e) { throw new Error(e.message + (r.finish === 'length' ? ' (the reply was cut off — try a non-thinking model)' : '')); }
  pipeline.applyResult(store.data, item, parsed, today());
}

function addItem(fields) {
  const item = Object.assign({ id: uid('i'), createdAt: new Date().toISOString(), status: 'queued', topics: [], pendingTopics: [], notes: [] }, fields);
  item.sortDate = today();
  store.data.items.push(item);
  push();
  runQueue();
  return item.id;
}

// ---------- IPC ----------
function wireIpc() {
  ipcMain.handle('state', () => publicState());

  ipcMain.handle('add-text', (e, text) => addItem({ kind: 'text', userText: String(text).slice(0, 20000) }));
  ipcMain.handle('add-link', (e, url, note) => addItem({ kind: 'link', url: String(url), userText: note ? String(note).slice(0, 4000) : '' }));
  ipcMain.handle('add-shot', (e, dataUrl, caption) => {
    const m = String(dataUrl).match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);
    if (!m) throw new Error('That clipboard item is not an image');
    const file = uid('img') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    fs.writeFileSync(path.join(store.imgDir, file), Buffer.from(m[2], 'base64'));
    return addItem({ kind: 'shot', image: file, userText: caption ? String(caption).slice(0, 4000) : '' });
  });
  ipcMain.handle('add-page', (e, page, note) => addItem({ kind: 'link', url: page.url, rawTitle: page.title, rawText: page.text, siteName: page.siteName, pageDate: page.pub, userText: note || '' }));

  ipcMain.handle('retry', (e, id) => { const it = store.item(id); if (it) { it.status = 'queued'; it.error = null; if (it.kind === 'shot') { it.rawText = ''; it.visionNote = null; } push(); runQueue(); } });
  ipcMain.handle('delete-item', (e, id) => {
    const d = store.data;
    const it = store.item(id);
    if (!it) return;
    if (it.image) { try { fs.unlinkSync(path.join(store.imgDir, it.image)); } catch (err) {} }
    d.items = d.items.filter((x) => x.id !== id);
    for (const x of d.items) if (x.rel && x.rel.to === id) x.rel = null;
    d.reminders = d.reminders.filter((r) => r.itemId !== id);
    d.chains = d.chains.filter((c) => d.items.some((x) => x.chainId === c.id));
    push();
  });
  ipcMain.handle('add-note', (e, id, text) => {
    const it = store.item(id);
    if (it && String(text).trim()) { it.notes = it.notes || []; it.notes.push({ at: new Date().toISOString(), text: String(text).trim().slice(0, 4000) }); push(); }
  });
  ipcMain.handle('reminder', (e, id, action, date) => {
    const r = store.data.reminders.find((x) => x.id === id);
    if (!r) return;
    if (action === 'confirm') { r.status = 'pending'; if (date) r.dueDate = date; if (!r.dueDate) r.dueDate = today(); }
    if (action === 'dismiss') r.status = 'dismissed';
    if (action === 'done') r.status = 'done';
    push();
  });
  ipcMain.handle('add-reminder', (e, itemId, date, text) => {
    const it = store.item(itemId);
    if (!it || !date) return;
    store.data.reminders.push({ id: uid('r'), itemId, kind: 'manual', status: 'pending', dueDate: date, createdAt: new Date().toISOString(), text: text || ('回看：' + (it.title || '这一条')) });
    push();
  });
  ipcMain.handle('mark-viewed', (e, ids) => { const now = new Date().toISOString(); for (const id of ids) { const t = store.topic(id); if (t) t.lastViewedAt = now; } push(); });
  ipcMain.handle('update-topic', (e, id, name, aliases) => {
    const t = store.topic(id);
    if (!t) return;
    if (String(name).trim()) t.name = String(name).trim().slice(0, 30);
    t.aliases = String(aliases || '').split(/[,，、;；\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
    push();
  });

  ipcMain.handle('save-provider', (e, id, fields) => {
    const p = store.data.settings.providers[id];
    if (!p) return;
    if (fields.baseUrl) p.baseUrl = String(fields.baseUrl).trim();
    if (fields.model) p.model = String(fields.model).trim();
    if (typeof fields.visionModel === 'string') p.visionModel = fields.visionModel.trim();
    if (typeof fields.key === 'string' && fields.key.trim()) setKey(p, fields.key.trim());
    if (fields.clearKey) setKey(p, '');
    p.status = 'untested'; p.message = '';
    push();
  });
  ipcMain.handle('test-provider', async (e, id) => {
    const s = store.data.settings;
    const p = s.providers[id];
    p.status = 'testing'; p.message = ''; push();
    try {
      await llm.testProvider(p, getKey(p));
      p.status = 'ok'; p.message = 'Connected';
      if (!s.roles.brain) s.roles.brain = id;
    } catch (err) {
      p.status = 'fail'; p.message = String(err.message).slice(0, 240);
      if (id === 'kimi' && /HTTP 401/.test(p.message)) p.message += ' — Kimi keys only work with the site they came from: platform.moonshot.cn keys → https://api.moonshot.cn/v1, platform.kimi.ai / moonshot.ai keys → https://api.moonshot.ai/v1. Try switching the Base URL.';
    }
    push();
    // Anything that failed for lack of a model gets another go.
    if (p.status === 'ok') { for (const it of store.data.items) if (it.status === 'error' && /No model picked|no API key|Eyes/.test(it.error || '')) { it.status = 'queued'; if (it.kind === 'shot') it.rawText = ''; } push(); runQueue(); }
    return { status: p.status, message: p.message };
  });
  ipcMain.handle('set-role', (e, role, id) => { store.data.settings.roles[role] = id || null; push(); });
  ipcMain.handle('set-rule', (e, k, v) => {
    const n = Math.max(1, Math.min(365, parseInt(v, 10) || 0));
    if (k === 'lateDays') { store.data.settings.lateDays = n; pipeline.relayoutAll(store.data); }
    if (k === 'minTopic') { store.data.settings.minTopic = Math.min(n, 20); pipeline.promotePending(store.data); }
    push();
  });
  ipcMain.handle('open-data-folder', () => shell.openPath(store.dir));
  ipcMain.handle('open-browser', (e, url) => openBrowser(url));
  ipcMain.handle('extract-script', () => EXTRACT_SCRIPT);
}

// ---------- Windows ----------
function createMain() {
  mainWin = new BrowserWindow({
    width: 480, height: 940, minWidth: 380, minHeight: 600, title: 'Clew', backgroundColor: '#FFFFFF', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) openBrowser(url); return { action: 'deny' }; });
  mainWin.webContents.on('will-navigate', (e) => e.preventDefault());
}

function openBrowser(url) {
  if (browserWin && !browserWin.isDestroyed()) {
    browserWin.focus();
    if (url) browserWin.webContents.send('browser-open', url);
    return;
  }
  browserWin = new BrowserWindow({
    width: 1200, height: 900, title: 'Clew · Browser', backgroundColor: '#FFFFFF', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'browser-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true }
  });
  browserWin.loadFile(path.join(__dirname, 'renderer', 'browser.html'), { query: { url: url || '' } });
}

app.on('web-contents-created', (e, contents) => {
  // Lock down any <webview>: no node, our partition only.
  contents.on('will-attach-webview', (ev, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    params.partition = PARTITION;
  });
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => { contents.loadURL(url); return { action: 'deny' }; });
  }
});

app.whenReady().then(() => {
  store = new Store(process.env.CLEW_DATA_DIR || path.join(app.getPath('userData'), 'data'));
  protocol.handle('clew-img', (req) => {
    const name = path.basename(decodeURIComponent(new URL(req.url).pathname));
    return net.fetch(pathToFileURL(path.join(store.imgDir, name)).toString());
  });
  wireIpc();
  createMain();
  runQueue();
  if (process.env.CLEW_SELFTEST) require('./test/selftest')(app, mainWin, store, { addItem, publicState });
});

app.on('window-all-closed', () => app.quit());
