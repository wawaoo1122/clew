(function () {
  const wv = document.getElementById('wv');
  const url = document.getElementById('url');
  const note = document.getElementById('note');
  const msg = document.getElementById('msg');
  let script = null;
  function say(t) { msg.textContent = t; msg.classList.add('show'); clearTimeout(say.t); say.t = setTimeout(() => msg.classList.remove('show'), 2600); }
  function go(u) {
    u = String(u || '').trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = /\s/.test(u) || !/\./.test(u) ? 'https://www.bing.com/search?q=' + encodeURIComponent(u) : 'https://' + u;
    wv.loadURL(u);
  }
  const start = new URLSearchParams(location.search).get('url');
  wv.addEventListener('dom-ready', function once() {
    wv.removeEventListener('dom-ready', once);
    if (start) go(start);
  });
  window.clewBrowser.onOpen(go);
  url.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(url.value); });
  document.getElementById('back').onclick = () => wv.canGoBack() && wv.goBack();
  document.getElementById('fwd').onclick = () => wv.canGoForward() && wv.goForward();
  document.getElementById('reload').onclick = () => wv.reload();
  function sync() {
    try { const u = wv.getURL(); if (document.activeElement !== url) url.value = u === 'about:blank' ? '' : u; } catch (e) {}
    try { document.getElementById('back').disabled = !wv.canGoBack(); document.getElementById('fwd').disabled = !wv.canGoForward(); } catch (e) {}
  }
  wv.addEventListener('did-navigate', sync);
  wv.addEventListener('did-navigate-in-page', sync);
  wv.addEventListener('did-stop-loading', sync);
  document.getElementById('log').onclick = async () => {
    const u = wv.getURL();
    if (!u || u === 'about:blank') { say('Open a page first'); return; }
    try {
      if (!script) script = await window.clewBrowser.extractScript();
      const page = await wv.executeJavaScript(script);
      if (!page || (!page.text && !page.title)) { say('Couldn\'t read this page'); return; }
      await window.clewBrowser.logPage(page, note.value.trim());
      note.value = '';
      say('Logged — it\'s in your feed');
    } catch (e) { say('Couldn\'t log this page: ' + (e.message || e)); }
  };
})();
