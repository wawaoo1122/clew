// End-to-end check: fake model server + real windows. Run with CLEW_SELFTEST=1.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

const OUT = path.join(__dirname, 'out');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function mockServer() {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body || '{}');
      calls.push({ url: req.url, auth: req.headers.authorization, body: j });
      const user = (j.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      let content = 'OK';
      const hasImage = (j.messages || []).some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url'));
      if (hasImage) content = '截图文字：Morgan Stanley 下调 NVIDIA FY28、FY29 营收预测约 10%。来源：@G2AIStack，X 帖子。';
      else if (j.messages && j.messages[0].role === 'system') {
        const newPart = user.split('【新碎片】')[1] || '';
        const cand = (user.split('【候选碎片（新到旧）】')[1] || '').split('【新碎片】')[0];
        const ids = [...cand.matchAll(/- (i_[a-z0-9]+) \|/g)].map((m) => m[1]);
        const mineId = (cand.match(/- (i_[a-z0-9]+) \|[^\n]*\| 我的想法 \|/) || [])[1];
        let r;
        if (/交期延长/.test(newPart)) r = { title: '衬底供应商交期延长', summary: '报道称 InP 衬底交期明显拉长，原因是下游光模块需求增加。部分客户开始提前下单锁产能。', source: '测试资讯站', event_date: '2026-09-01', publish_date: '2026-09-03', topics: [{ name: 'InP', existing_id: null }], chain: { new_name: '紧缺' }, relation: { type: 'none' }, future_dates: [] };
        else if (/我的判断/.test(newPart)) r = { title: '我的判断：紧缺持续到明年中', summary: '我认为紧缺可能持续到明年中，要盯扩产节奏。', source: null, topics: [{ name: 'InP' }], chain: { new_name: '紧缺' }, relation: { type: 'follow', to_id: ids[0], why: '看完交期新闻后写的' }, future_dates: [] };
        else if (/宣布扩产/.test(newPart)) r = { title: '某厂宣布扩产，报价松动', summary: '某衬底厂商宣布扩产，新产能预计明年释放，部分规格报价出现松动。小批量出货预计 2027 Q2。', source: '测试财经', event_date: '2026-07-15', publish_date: '2026-11-02', topics: [{ name: '磷化铟' }, { name: 'CPO' }], chain: { new_name: '紧缺' }, relation: { type: 'flip', to_id: mineId || ids[0], why: '和你 10/12 的判断方向相反：供给侧出现扩产信号' }, future_dates: [{ date: '2027 Q2', what: '小批量出货' }] };
        else if (/Morgan Stanley/.test(newPart)) r = { title: '大摩下调英伟达营收预测', summary: 'Morgan Stanley 下调 NVIDIA FY28、FY29 营收预测约 10%。', source: 'X @G2AIStack', topics: [{ name: 'NVIDIA' }], chain: { new_name: '卖方预期' }, relation: { type: 'none' }, future_dates: [] };
        else r = { title: '行情截图', summary: '用户截图，配文说明来自某行情软件。', source: '截图', topics: [{ name: '锂' }], chain: { new_name: '价格' }, relation: { type: 'none' }, future_dates: [] };
        content = '<think>let me think</think>Here you go:\n```json\n' + JSON.stringify(r) + '\n```';
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, calls, port: srv.address().port })));
}

function page(title, date, text) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + title + ' - 测试站</title><meta property="article:published_time" content="' + date + 'T08:00:00+08:00"><meta property="og:site_name" content="测试资讯站"></head><body><nav>首页 | 行业 | 关于</nav><article><h1>' + title + '</h1>' + text.map((p) => '<p>' + p + '</p>').join('') + '</article><footer>版权所有</footer></body></html>';
}

module.exports = async function selftest(app, win, store, h) {
  const log = (...a) => console.log('[selftest]', ...a);
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'clewpages-'));
    fs.writeFileSync(path.join(tmp, 'a.html'), page('InP 衬底交期延长', '2026-09-03', ['据行业人士透露，InP 衬底的交期较此前明显拉长，主要原因是下游光模块需求增加、扩产跟不上。', '部分客户已经开始提前下单锁定产能，但文中没有给出具体交期数字。'.repeat(3), '业内认为，这一情况短期内难以缓解。'.repeat(4)]));
    fs.writeFileSync(path.join(tmp, 'b.html'), page('某厂宣布扩产，报价松动', '2026-11-02', ['某衬底厂商宣布扩产，新产能预计明年释放；渠道反馈部分规格报价出现松动。', '该厂表示小批量出货预计在 2027 Q2 前后。'.repeat(3), '幅度和涉及的规格没有披露。'.repeat(5)]));
    const { srv, calls, port } = await mockServer();
    const pages = http.createServer((req, res) => { const f = path.join(tmp, path.basename(req.url)); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(f)); });
    await new Promise((r) => pages.listen(0, '127.0.0.1', r));
    const PG = 'http://127.0.0.1:' + pages.address().port + '/';
    await new Promise((r) => win.webContents.once('did-finish-load', r)).catch(() => {});
    await wait(800);
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const shot = async (name) => { await wait(700); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); log('saved', name); };
    await shot('0-empty');

    // Settings: point DeepSeek at the fake server, save a key, test it — all through the real UI.
    await js(`document.getElementById('gear').click()`);
    await wait(300);
    await js(`document.getElementById('u-deepseek').value='http://127.0.0.1:${port}/v1'; document.getElementById('k-deepseek').value='sk-test-123'; document.querySelector('[data-act="prov-save"][data-id="deepseek"]').click();`);
    await wait(1500);
    await js(`document.getElementById('u-mimo').value='http://127.0.0.1:${port}/v1'; document.getElementById('k-mimo').value='mimo-key'; document.querySelector('[data-act="prov-save"][data-id="mimo"]').click();`);
    await wait(1500);
    const st = store.data.settings;
    log('deepseek status:', st.providers.deepseek.status, '| brain:', st.roles.brain, '| key encrypted:', !!st.providers.deepseek.keyEnc, '| plain stored:', !!st.providers.deepseek.keyPlain);
    if (fs.readFileSync(store.file, 'utf8').includes('sk-test-123') && st.providers.deepseek.keyEnc) throw new Error('key leaked in plain text');
    await shot('5-settings');
    await js(`document.querySelector('[data-tab="feed"]').click()`);

    // Log 4 bits through the composer.
    const logIt = async (text) => { await js(`(function(){const i=document.getElementById('input'); i.value=${JSON.stringify(text)}; document.getElementById('logBtn').click();})()`); await wait(400); };
    await logIt(PG + 'a.html');
    await logIt('我的判断：紧缺可能持续到明年中，盯扩产节奏。');
    await logIt(PG + 'b.html 朋友转的');
    // Screenshot via IPC (paste is hard to fake): 1x1 PNG
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await js(`window.clew.addShot(${JSON.stringify(png)}, '')`);
    for (let i = 0; i < 80; i++) { if (!store.data.items.some((x) => x.status === 'queued' || x.status === 'processing')) break; await wait(500); }
    for (const x of store.data.items) log('item', x.kind, x.status, x.error || '', '|', x.title, '|', x.sortDate, x.dateBasis, '| topics', (x.topics || []).map((t) => store.topic(t).name).join(','), '| pending', (x.pendingTopics || []).join(','), '| rel', x.rel ? x.rel.type : '-');
    log('topics:', store.data.topics.map((t) => t.name).join(', '), '| chains:', store.data.chains.map((c) => c.name).join(', '));
    log('reminders:', store.data.reminders.map((r) => r.kind + ':' + r.status + ':' + r.dueDate).join(', '));
    const a = store.data.items[0];
    log('extracted page A: title=', a.rawTitle, '| site=', a.siteName, '| pageDate=', a.pageDate, '| text chars=', (a.rawText || '').length, '| nav stripped=', !/首页 \| 行业/.test(a.rawText || ''));
    const shotItem = store.data.items.find((x) => x.kind === 'shot');
    log('screenshot:', shotItem.status, '| read by:', shotItem.visionBy, '| title:', shotItem.title, '| image call model:', (calls.find((c) => JSON.stringify(c.body).includes('image_url')) || {body:{}}).body.model);
    log('model calls:', calls.length, '| auth ok:', calls.every((c) => c.auth === 'Bearer sk-test-123' || c.auth === 'Bearer mimo-key'), '| paths:', [...new Set(calls.map((c) => c.url))].join(','));
    await js(`window.scrollTo(0,0)`);
    await shot('1-feed');

    // Open the chain on the "flip" item.
    const flip = store.data.items.find((x) => x.rel && x.rel.type === 'flip');
    if (flip) {
      await js(`document.querySelector('[data-act="toggle"][data-id="${flip.id}"]').click()`);
      await wait(300);
      await js(`(function(){const b=document.querySelector('.panel [data-act="peek"]'); if(b) b.click(); const el=document.querySelector('article[data-id="${flip.id}"]'); if(el) el.scrollIntoView();})()`);
      await shot('2-chain');
    }
    // Filter chip
    await js(`(function(){const c=document.querySelector('[data-act="chip"]'); if(c) c.click(); document.getElementById('view').scrollTop=0;})()`);
    await shot('2b-filter');
    await js(`document.querySelector('[data-tab="remind"]').click()`);
    await shot('3-reminders');
    await js(`document.querySelector('[data-tab="topics"]').click()`);
    await shot('4-topics');

    // Browser window
    const { ipcMain } = require('electron');
    win.webContents.executeJavaScript(`window.clew.openBrowser(${JSON.stringify(PG + 'a.html')})`);
    await wait(3500);
    const bw = BrowserWindow.getAllWindows().find((w) => w !== win && w.isVisible());
    if (bw) {
      const before = store.data.items.length;
      await bw.webContents.executeJavaScript(`document.getElementById('note').value='from the browser'; document.getElementById('log').click();`);
      await wait(1500);
      log('browser log added item:', store.data.items.length === before + 1, '| rawTitle:', store.data.items[store.data.items.length - 1].rawTitle);
      const img = await bw.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, '6-browser.png'), img.toPNG());
    } else log('browser window not found');
    for (let i = 0; i < 40; i++) { if (!store.data.items.some((x) => x.status === 'queued' || x.status === 'processing')) break; await wait(500); }

    // Restart-safety: the data file parses.
    JSON.parse(fs.readFileSync(store.file, 'utf8'));
    log('DONE');
    srv.close(); pages.close();
  } catch (e) {
    console.log('[selftest] FAILED', e && e.stack);
  }
  setTimeout(() => app.exit(0), 300);
};
