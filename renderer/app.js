/* Clew renderer: draws everything from the state the main process sends. */
(function () {
  const api = window.clew;
  let S = null; // state from main
  const ui = { tab: 'feed', sel: [], allChips: false, open: null, peek: null, prevViewed: {}, form: null, confirmDel: null, editTopic: null, bigShot: null, attach: null };
  const SHOW = 4;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const KIND = { link: 'Link', shot: 'Screenshot', text: 'My take' };
  const $ = (id) => document.getElementById(id);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function md(d) {
    if (!d) return '';
    const p = String(d).slice(0, 10).split('-');
    if (p.length < 3) return d;
    const s = MON[Number(p[1]) - 1] + ' ' + Number(p[2]);
    return p[0] === S.today.slice(0, 4) ? s : s + ', ' + p[0];
  }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
  async function call(p) { try { return await p; } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } }

  // ---------- helpers over state ----------
  const topicById = (id) => S.topics.find((t) => t.id === id);
  const chainById = (id) => S.chains.find((c) => c.id === id);
  const itemById = (id) => S.items.find((x) => x.id === id);
  const itemsOfTopic = (t) => S.items.filter((x) => (x.topics || []).includes(t.id));
  const unsorted = () => S.items.filter((x) => x.status === 'done' && !(x.topics || []).length);
  function newIn(t, since) { const s = since === undefined ? t.lastViewedAt : since; return itemsOfTopic(t).filter((x) => x.status === 'done' && (!s || x.createdAt > s)); }
  function isNew(x) {
    if (x.status !== 'done') return false;
    const ts = (x.topics || []).map(topicById).filter(Boolean);
    if (!ts.length) return Date.now() - new Date(x.createdAt) < 86400000;
    return ts.some((t) => !t.lastViewedAt || x.createdAt > t.lastViewedAt);
  }
  function lastActivity(t) { return itemsOfTopic(t).reduce((m, x) => (x.sortDate > m ? x.sortDate : m), ''); }
  function sortItems(list) {
    return list.slice().sort((a, b) => {
      const pa = a.status !== 'done' ? 1 : 0, pb = b.status !== 'done' ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return (b.sortDate || '').localeCompare(a.sortDate || '') || (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }
  const remindersDue = () => S.reminders.filter((r) => r.status === 'pending' && r.dueDate && r.dueDate <= S.today);
  const remindersSuggested = () => S.reminders.filter((r) => r.status === 'suggested');
  const hasBrain = () => !!(S.settings.roles.brain && S.settings.providers[S.settings.roles.brain] && S.settings.providers[S.settings.roles.brain].hasKey);

  // ---------- tabs ----------
  function renderTabs() {
    const n = remindersDue().length + remindersSuggested().length;
    const tabs = [['feed', 'Feed', 0], ['remind', 'Reminders', n], ['topics', 'Topics', 0]];
    $('tabs').innerHTML = tabs.map(([id, label, c]) => '<button type="button" data-tab="' + id + '" class="' + (ui.tab === id ? 'on' : '') + '" aria-pressed="' + (ui.tab === id) + '">' + label + (c ? '<span class="count">' + c + '</span>' : '') + '</button>').join('');
    $('gear').classList.toggle('on', ui.tab === 'settings');
  }

  // ---------- feed ----------
  function chipList() {
    const ts = S.topics.slice().sort((a, b) => newIn(b).length - newIn(a).length || lastActivity(b).localeCompare(lastActivity(a)));
    const list = ts.map((t) => ({ id: t.id, name: t.name, dot: newIn(t).length > 0 }));
    if (unsorted().length) list.push({ id: '__unsorted', name: 'Unsorted', dot: false });
    return list;
  }

  function relPill(x) {
    if (!x.rel) return '';
    const tgt = itemById(x.rel.to);
    if (!tgt) return '';
    const flip = x.rel.type === 'flip';
    const icon = flip
      ? '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16"/><path d="M3 16l4 4 4-4"/><path d="M17 20V4"/><path d="M13 8l4-4 4 4"/></svg>'
      : '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v7a4 4 0 0 0 4 4h10"/><path d="M15 11l4 4-4 4"/></svg>';
    return '<span class="rel' + (flip ? ' flip' : '') + '">' + icon + '<b>' + (flip ? 'Flips' : 'Follows') + '</b><span>' + esc(md(tgt.sortDate) + '　' + tgt.title) + '</span></span>';
  }

  function topicLabel(x) {
    const names = (x.topics || []).map((id) => (topicById(id) || {}).name).filter(Boolean);
    if (names.length) return names.join(' · ');
    if ((x.pendingTopics || []).length) {
      const min = S.settings.minTopic;
      return 'Unsorted · ' + x.pendingTopics.map((n) => n + ' ' + S.items.filter((y) => (y.pendingTopics || []).includes(n)).length + '/' + min).join(', ');
    }
    return x.status === 'done' ? 'Unsorted' : 'New';
  }

  function card(x) {
    const open = ui.open === x.id;
    const done = x.status === 'done';
    const title = done ? x.title : (x.rawTitle || (x.kind === 'text' ? String(x.userText).slice(0, 40) : x.url) || 'Screenshot');
    let h = '<article class="card" data-id="' + x.id + '"><div class="inner">';
    h += '<div class="meta">' + (isNew(x) ? '<span class="new" role="img" aria-label="New"></span>' : '') +
      '<span class="t">' + esc(topicLabel(x)) + '</span><span aria-hidden="true">/</span><span>' + KIND[x.kind] + '</span><span aria-hidden="true">/</span><span>' + esc(md(x.sortDate)) + '</span>' +
      (x.dateBasis === 'pub' ? '<span class="badge">late news</span>' : '') + '</div>';
    h += '<h2>' + esc(title) + '</h2>';
    if (done) h += relPill(x);
    if (done) h += '<p class="sum">' + esc(x.summary || '') + '</p>';
    else if (x.kind === 'text') h += '<p class="sum">' + esc(x.userText) + '</p>';
    else if (x.userText) h += '<p class="sum">' + esc(x.userText) + '</p>';
    if (x.kind === 'shot' && x.image) h += '<img class="shot' + (ui.bigShot === x.id ? ' big' : '') + '" data-act="shot" data-id="' + x.id + '" src="clew-img://img/' + encodeURIComponent(x.image) + '" alt="Screenshot you logged">';
    const srcBits = [];
    if (x.source) srcBits.push('<span>— ' + esc(x.source) + '</span>');
    if (x.url) srcBits.push('<button type="button" data-act="open-url" data-id="' + x.id + '">Open</button>');
    if (srcBits.length) h += '<div class="src">' + srcBits.join('') + '</div>';
    if (x.visionNote && x.status === 'done') h += '<div class="status">' + esc(x.visionNote) + '</div>';
    for (const n of x.notes || []) h += '<div class="note"><span class="h">My note · ' + esc(md(n.at)) + '</span><span class="b">' + esc(n.text) + '</span></div>';
    if (x.kind !== 'text' && x.userText && done) h += '<div class="note"><span class="h">What you added</span><span class="b">' + esc(x.userText) + '</span></div>';
    if (x.status === 'queued' || x.status === 'processing') h += '<div class="status"><span class="spin" aria-hidden="true"></span>' + (x.status === 'queued' ? 'Waiting in line…' : (x.kind === 'link' && !x.rawText ? 'Reading the page…' : 'Connecting the dots…')) + '</div>';
    if (x.status === 'error') h += '<div class="status err"><span>Couldn\'t finish this one: ' + esc(x.error) + '</span><button type="button" class="pill" data-act="retry" data-id="' + x.id + '">Try again</button></div>';
    for (const r of S.reminders.filter((r) => r.itemId === x.id && r.status === 'suggested')) {
      h += '<div class="suggest"><span>Spotted a date: <b>' + esc(r.dateText || r.dueDate) + '</b> · ' + esc(r.text) + '</span><button type="button" class="pill" data-act="r-confirm" data-id="' + r.id + '">Remind me</button><button type="button" class="pill ghost" data-act="r-dismiss" data-id="' + r.id + '" aria-label="Dismiss">✕</button></div>';
    }
    h += '</div>';

    // footer + panel
    const ch = x.chainId ? chainById(x.chainId) : null;
    const chainItems = ch ? sortItems(S.items.filter((y) => y.chainId === ch.id)).reverse() : [];
    const chName = ch ? ((topicById(ch.topicId) || {}).name || '') + ' · ' + ch.name : null;
    const linkIcon = '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
    if (chainItems.length > 1) h += '<button type="button" class="foot" data-act="toggle" data-id="' + x.id + '" aria-expanded="' + open + '">' + linkIcon + '<span>' + esc(chName) + ' · ' + chainItems.length + '</span><span class="spacer"></span><span class="go">' + (open ? 'Hide' : 'See the chain') + '</span></button>';
    else h += '<button type="button" class="foot" data-act="toggle" data-id="' + x.id + '" aria-expanded="' + open + '"><span>' + (chName ? esc(chName) + ' · only one so far' : (done ? 'Not in a chain yet' : '')) + '</span><span class="spacer"></span><span class="go">' + (open ? 'Hide' : 'More') + '</span></button>';

    if (open) {
      h += '<div class="panel">';
      if (x.dateBasis === 'pub') h += '<span class="line"><b>Late news</b>　Happened ' + esc(md(x.eventDate)) + ', reported ' + esc(md(x.pubDate)) + ' (' + x.lateGap + ' days later, over ' + S.settings.lateDays + ') — so it sits at the publish date.</span>';
      else if (x.dateBasis === 'capture') h += '<span class="line">No date found in it, so it sits at the day you logged it.</span>';
      else if (x.dateBasis === 'pubonly') h += '<span class="line">Only a publish date was found, so it sits there.</span>';
      if (x.rel && x.rel.why) h += '<span class="line"><b>Why linked</b>　' + esc(x.rel.why) + '</span>';
      if (chainItems.length > 1) {
        h += '<div style="height:6px"></div>';
        for (const y of chainItems) {
          const me = y.id === x.id;
          const tag = !y.rel ? 'Start' : y.rel.type === 'flip' ? 'Flip' : 'Follow-up';
          h += '<div class="tl"><div class="rail"><i class="' + (me ? 'me' : '') + '"></i></div><div class="col">';
          if (me) h += '<div class="row me"><span class="d">' + esc(md(y.sortDate)) + '</span><span class="x">You\'re here</span></div>';
          else {
            h += '<button type="button" class="row" data-act="peek" data-id="' + y.id + '" aria-expanded="' + (ui.peek === y.id) + '"><span class="d">' + esc(md(y.sortDate)) + '</span><span class="x">' + esc(y.title || y.rawTitle || '') + '</span><span class="tag">' + tag + '</span></button>';
            if (ui.peek === y.id) h += '<p class="peek">' + esc(y.summary || y.userText || '') + '</p>';
          }
          h += '</div></div>';
        }
      }
      // actions
      const f = ui.form && ui.form.id === x.id ? ui.form.type : null;
      if (f === 'note') h += '<div class="inline-form"><label class="sr" for="noteInput">Your note</label><textarea class="field" id="noteInput" placeholder="What do you make of it? It shows up next to the bit when you look back."></textarea><div class="r"><button type="button" class="pill solid" data-act="note-save" data-id="' + x.id + '">Save note</button><button type="button" class="pill ghost" data-act="form-cancel">Cancel</button></div></div>';
      else if (f === 'remind') h += '<div class="inline-form"><div class="r"><label class="sr" for="remindDate">Remind me on</label><input class="field" type="date" id="remindDate" min="' + S.today + '"><button type="button" class="pill solid" data-act="remind-save" data-id="' + x.id + '">Set</button><button type="button" class="pill ghost" data-act="form-cancel">Cancel</button></div></div>';
      else {
        h += '<div class="actions"><button type="button" class="pill" data-act="form-note" data-id="' + x.id + '">Add a note</button><button type="button" class="pill" data-act="form-remind" data-id="' + x.id + '">Revisit on…</button>';
        if (x.status === 'done') h += '<button type="button" class="pill" data-act="retry" data-id="' + x.id + '">Redo</button>';
        h += '<button type="button" class="pill ghost" data-act="delete" data-id="' + x.id + '">' + (ui.confirmDel === x.id ? 'Sure? Delete it' : 'Delete') + '</button></div>';
      }
      h += '</div>';
    }
    return h + '</article>';
  }

  function viewFeed() {
    if (!S.items.length) {
      return '<div class="empty"><h2>Nothing here yet</h2>Paste a link, jot a thought, or press Ctrl+V on a screenshot below, then hit Log.' +
        (hasBrain() ? '' : '<br><br>First, add an API key in Settings so Clew can sort things for you.<br><br><button type="button" class="pill solid" data-act="go-settings">Open Settings</button>') + '</div>';
    }
    let h = '';
    if (!hasBrain()) h += '<div class="summary" style="margin-top:14px"><span class="h">Heads-up</span><ul style="list-style:none;padding:0"><li>No model is set up yet, so new bits can\'t be sorted. <button type="button" class="textbtn strong" data-act="go-settings">Open Settings</button></li></ul></div>';
    const chips = chipList();
    if (chips.length) {
      const vis = chips.filter((c, i) => ui.allChips || i < SHOW || ui.sel.includes(c.id));
      h += '<div class="chips" role="group" aria-label="Filter by topic">' + vis.map((c) => '<button type="button" class="chip' + (ui.sel.includes(c.id) ? ' on' : '') + '" data-act="chip" data-id="' + c.id + '" aria-pressed="' + ui.sel.includes(c.id) + '"><span>' + esc(c.name) + '</span>' + (c.dot ? '<span class="dot" aria-label="has new"></span>' : '') + '</button>').join('');
      if (chips.length > SHOW) h += '<button type="button" class="textbtn" data-act="all-chips">' + (ui.allChips ? 'Less' : 'All ' + chips.length + ' ›') + '</button>';
      if (ui.sel.length) h += '<button type="button" class="textbtn strong" data-act="clear">Clear</button>';
      h += '</div>';
    }
    for (const id of ui.sel) {
      const t = topicById(id);
      if (!t) continue;
      const since = ui.prevViewed[id];
      const fresh = newIn(t, since === undefined ? t.lastViewedAt : since);
      const head = since ? (fresh.length ? fresh.length + ' new since ' + md(since) : 'nothing new since ' + md(since)) : 'first look';
      h += '<div class="summary"><span class="h">' + esc(t.name) + ' · ' + esc(head) + '</span>' + (fresh.length && since ? '<ul>' + fresh.slice(0, 3).map((x) => '<li>' + esc(x.title) + '</li>').join('') + '</ul>' : '') + '</div>';
    }
    let list = S.items;
    if (ui.sel.length) list = list.filter((x) => (ui.sel.includes('__unsorted') && x.status === 'done' && !(x.topics || []).length) || (x.topics || []).some((t) => ui.sel.includes(t)));
    h += '<div class="list">' + sortItems(list).map(card).join('') + '</div>';
    h += '<p class="end">That\'s everything. You\'re all caught up.</p>';
    return h;
  }

  // ---------- reminders ----------
  function viewRemind() {
    const due = remindersDue(), sug = remindersSuggested();
    const later = S.reminders.filter((r) => r.status === 'pending' && r.dueDate > S.today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const K = { clash: 'Clashes with your take', manual: 'You set this', date: 'Date you asked for' };
    let h = '<p class="intro">' + (due.length + sug.length ? 'Here\'s what needs a look.' : 'Nothing needs you right now.') + ' Tap “Take a look” to jump to the bit in the feed.</p>';
    if (due.length) {
      h += '<div class="section-h">Today</div><div class="list">' + due.map((r) => '<div class="row-item"><span class="k">' + K[r.kind] + (r.dueDate < S.today ? ' · since ' + esc(md(r.dueDate)) : '') + '</span><span class="txt">' + esc(r.text) + '</span><div class="btns"><button type="button" class="pill" data-act="r-look" data-id="' + r.id + '">Take a look</button><button type="button" class="pill solid" data-act="r-done" data-id="' + r.id + '">Done</button></div></div>').join('') + '</div>';
    }
    if (sug.length) {
      h += '<div class="section-h">Dates spotted · want a nudge?</div><div class="list">' + sug.map((r) => '<div class="row-item"><span class="k">' + esc(r.dateText || r.dueDate || 'No exact date') + (r.dueDate ? ' · would remind on ' + esc(md(r.dueDate)) : '') + '</span><span class="txt">' + esc(r.text) + '</span><div class="btns"><button type="button" class="pill solid" data-act="r-confirm" data-id="' + r.id + '">Remind me</button><button type="button" class="pill" data-act="r-look" data-id="' + r.id + '">Take a look</button><button type="button" class="pill ghost" data-act="r-dismiss" data-id="' + r.id + '">Dismiss</button></div></div>').join('') + '</div>';
    }
    if (later.length) {
      h += '<div class="section-h">Coming up</div><div class="list">' + later.map((r) => '<div class="row-item"><span class="k">' + esc(md(r.dueDate)) + ' · ' + K[r.kind] + '</span><span class="txt">' + esc(r.text) + '</span><div class="btns"><button type="button" class="pill" data-act="r-look" data-id="' + r.id + '">Take a look</button><button type="button" class="pill ghost" data-act="r-dismiss" data-id="' + r.id + '">Remove</button></div></div>').join('') + '</div>';
    }
    return h;
  }

  // ---------- topics ----------
  function viewTopics() {
    const ts = S.topics.slice().sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
    let h = '<p class="intro">Topics Clew pulled together on its own, and what\'s changed since you last looked. Fix a name or add synonyms with “Edit”.</p><div class="list">';
    for (const t of ts) {
      const items = itemsOfTopic(t);
      const chains = S.chains.filter((c) => c.topicId === t.id).length;
      const fresh = newIn(t);
      const since = t.lastViewedAt ? (fresh.length ? fresh.length + ' new since ' + md(t.lastViewedAt) : 'nothing new since ' + md(t.lastViewedAt)) : fresh.length + ' new · not opened yet';
      h += '<div class="row-item"><div class="topic-head"><span class="topic-name">' + esc(t.name) + '</span><span class="small-cap">' + chains + (chains === 1 ? ' chain' : ' chains') + ' · ' + items.length + ' bits</span></div>';
      h += '<span class="small-cap ink">' + esc(since) + '</span>';
      if ((t.aliases || []).length) h += '<span class="small-cap">Also: ' + esc(t.aliases.join(' · ')) + '</span>';
      const recent = sortItems(items.filter((x) => x.status === 'done')).slice(0, 2);
      if (recent.length) h += '<ul class="recent">' + recent.map((x) => '<li>' + esc(md(x.sortDate)) + '　' + esc(x.title) + '</li>').join('') + '</ul>';
      if (ui.editTopic === t.id) {
        h += '<div class="inline-form"><label class="small-cap" for="tName">Name</label><input class="field" id="tName" value="' + esc(t.name) + '"><label class="small-cap" for="tAlias">Synonyms (comma separated)</label><input class="field" id="tAlias" value="' + esc((t.aliases || []).join(', ')) + '"><div class="r"><button type="button" class="pill solid" data-act="topic-save" data-id="' + t.id + '">Save</button><button type="button" class="pill ghost" data-act="topic-cancel">Cancel</button></div></div>';
      } else {
        h += '<div class="btns"><button type="button" class="pill solid" data-act="topic-open" data-id="' + t.id + '">See it in the feed</button><button type="button" class="pill" data-act="topic-edit" data-id="' + t.id + '">Edit</button></div>';
      }
      h += '</div>';
    }
    const un = unsorted();
    if (un.length || !ts.length) {
      const pend = {};
      for (const x of S.items) for (const n of x.pendingTopics || []) pend[n] = (pend[n] || 0) + 1;
      h += '<div class="row-item"><div class="topic-head"><span class="topic-name">Unsorted</span><span class="small-cap">' + un.length + ' bits</span></div><span style="font-size:13px;line-height:1.7;color:var(--body)">Bits that don\'t have enough company yet. Once ' + S.settings.minTopic + ' line up under the same name, Clew turns them into a topic.</span>';
      const names = Object.keys(pend);
      if (names.length) h += '<ul class="recent">' + names.map((n) => '<li>' + esc(n) + ' — ' + pend[n] + '/' + S.settings.minTopic + '</li>').join('') + '</ul>';
      if (un.length) h += '<div class="btns"><button type="button" class="pill" data-act="topic-open" data-id="__unsorted">See them in the feed</button></div>';
      h += '</div>';
    }
    return h + '</div>';
  }

  // ---------- settings ----------
  function viewSettings() {
    const st = S.settings;
    const STL = { ok: 'Connected', fail: 'Failed', testing: 'Testing…', untested: 'Not tested' };
    let h = '<div class="settings"><h1>Settings</h1><p class="lead">Paste an API key and hit “Save &amp; test”. Keys are stored on this computer' + (st.encrypted ? ', encrypted by Windows.' : '. (Encryption isn\'t available on this system, so keys are stored as plain text.)') + '</p>';
    h += '<section><h3>01 · Model providers</h3><p class="hint">All three use the OpenAI-style API. Base URL and model can be changed if the provider renames things. Kimi: keys from platform.moonshot.cn use api.moonshot.cn; keys from platform.kimi.ai / moonshot.ai use https://api.moonshot.ai/v1.</p>';
    for (const id of Object.keys(st.providers)) {
      const p = st.providers[id];
      h += '<div class="prov" data-prov="' + id + '"><div class="name">' + esc(p.label) + '<span class="st' + (p.status === 'ok' ? ' ok' : '') + '">' + (STL[p.status] || p.status) + '</span></div>' +
        '<div class="grid"><label for="u-' + id + '">Base URL</label><input class="field" id="u-' + id + '" value="' + esc(p.baseUrl) + '"><label for="m-' + id + '">Model</label><input class="field" id="m-' + id + '" value="' + esc(p.model) + '"><label for="v-' + id + '">Image model</label><input class="field" id="v-' + id + '" value="' + esc(p.visionModel) + '" placeholder="' + (id === 'deepseek' ? 'Leave empty: not known to read images' : 'Model that can read screenshots') + '"><label for="k-' + id + '">API key</label><input class="field" type="password" id="k-' + id + '" placeholder="' + (p.hasKey ? 'Saved · paste a new one to replace it' : 'Paste your API key') + '"></div>' +
        '<div class="actions" style="padding-top:2px"><button type="button" class="pill solid" data-act="prov-save" data-id="' + id + '">Save &amp; test</button>' + (p.hasKey ? '<button type="button" class="pill ghost" data-act="prov-clear" data-id="' + id + '">Remove key</button>' : '') + '</div>' +
        (p.message ? '<div class="msg">' + esc(p.message) + '</div>' : '') + '</div>';
    }
    h += '</section>';
    const opts = (sel, allowNone) => (allowNone ? '<option value="">None</option>' : '<option value="">Pick one</option>') + Object.keys(st.providers).map((id) => '<option value="' + id + '"' + (sel === id ? ' selected' : '') + '>' + esc(st.providers[id].label) + (st.providers[id].hasKey ? '' : ' (no key)') + '</option>').join('');
    const eyesOpts = (sel) => '<option value="auto"' + (!sel || sel === 'auto' ? ' selected' : '') + '>Auto (recommended)</option>' + Object.keys(st.providers).filter((id) => st.providers[id].visionModel).map((id) => '<option value="' + id + '"' + (sel === id ? ' selected' : '') + '>' + esc(st.providers[id].label) + ' · ' + esc(st.providers[id].visionModel) + (st.providers[id].hasKey ? '' : ' (no key)') + '</option>').join('') + '<option value="off"' + (sel === 'off' ? ' selected' : '') + '>Off — captions only</option>';
    h += '<section><h3>02 · Who does what</h3>' +
      '<div class="set-row"><div class="l"><b>Brain</b><span>Reads each bit, writes the title and summary, picks the topic, and decides what it links to. This matters most.</span></div><label class="sr" for="role-brain">Brain</label><select class="field" id="role-brain" data-role="brain">' + opts(st.roles.brain, false) + '</select></div>' +
      '<div class="set-row"><div class="l"><b>Eyes</b><span>Reads the text inside screenshots, using each provider\'s “Image model” (MiMo: mimo-v2.5, Kimi: kimi-k2.6). Auto picks a connected one for you. If reading fails, Clew uses your caption instead.</span></div><label class="sr" for="role-eyes">Eyes</label><select class="field" id="role-eyes" data-role="eyes">' + eyesOpts(st.roles.eyes) + '</select></div></section>';
    h += '<section><h3>03 · House rules</h3>' +
      '<div class="set-row"><div class="l"><b>Late-news cutoff (days)</b><span>If something gets reported more than this many days after it happened, it sits at the publish date, with a note on when it really happened.</span></div><label class="sr" for="rule-late">Days</label><input class="field" style="width:100px" type="number" min="1" id="rule-late" data-rule="lateDays" value="' + st.lateDays + '"></div>' +
      '<div class="set-row"><div class="l"><b>Bits needed to make a topic</b><span>Anything below this hangs out in Unsorted.</span></div><label class="sr" for="rule-min">Bits</label><input class="field" style="width:100px" type="number" min="1" id="rule-min" data-rule="minTopic" value="' + st.minTopic + '"></div></section>';
    h += '<section><h3>04 · Your data</h3><p class="hint">Everything is saved in one file on this computer. Copy the folder to back it up.</p><div class="mono">' + esc(st.dataDir) + '</div><div class="actions"><button type="button" class="pill" data-act="open-data">Open the folder</button></div></section></div>';
    return h;
  }

  // ---------- render ----------
  function render() {
    if (!S) return;
    renderTabs();
    const v = $('view');
    const keep = v.scrollTop;
    // Don't wipe a half-typed form.
    const noteVal = $('noteInput') ? $('noteInput').value : null;
    const html = ui.tab === 'feed' ? viewFeed() : ui.tab === 'remind' ? viewRemind() : ui.tab === 'topics' ? viewTopics() : viewSettings();
    if (ui.tab === 'settings' && v.dataset.tab === 'settings' && v.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') {
      // Only refresh status lines while the user is typing in settings.
      for (const el of v.querySelectorAll('.prov')) {
        const p = S.settings.providers[el.dataset.prov];
        const st = el.querySelector('.st');
        st.textContent = { ok: 'Connected', fail: 'Failed', testing: 'Testing…', untested: 'Not tested' }[p.status] || p.status;
        st.classList.toggle('ok', p.status === 'ok');
      }
      return;
    }
    v.innerHTML = html;
    v.dataset.tab = ui.tab;
    v.scrollTop = keep;
    if (noteVal !== null && $('noteInput')) $('noteInput').value = noteVal;
  }

  function setTab(t) { ui.tab = t; ui.form = null; ui.confirmDel = null; $('view').scrollTop = 0; render(); }

  function selectTopics(ids) {
    for (const id of ids) {
      const t = topicById(id);
      if (t && !(id in ui.prevViewed)) ui.prevViewed[id] = t.lastViewedAt;
    }
    const real = ids.filter((id) => id !== '__unsorted');
    if (real.length) call(api.markViewed(real));
  }

  function goToItem(itemId) {
    const x = itemById(itemId);
    if (!x) { toast('That bit was deleted'); return; }
    ui.sel = (x.topics || []).length ? [x.topics[0]] : (x.status === 'done' ? ['__unsorted'] : []);
    selectTopics(ui.sel);
    ui.open = x.id; ui.peek = null; ui.tab = 'feed';
    render();
    const el = document.querySelector('article[data-id="' + x.id + '"]');
    if (el) el.scrollIntoView({ block: 'start' });
  }

  // ---------- events ----------
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  $('gear').addEventListener('click', () => setTab(ui.tab === 'settings' ? 'feed' : 'settings'));
  $('browserBtn').addEventListener('click', () => call(api.openBrowser('')));

  $('view').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    const act = b.dataset.act;
    if (act !== 'delete') ui.confirmDel = null;
    switch (act) {
      case 'chip': {
        if (ui.sel.includes(id)) ui.sel = ui.sel.filter((x) => x !== id);
        else { ui.sel = ui.sel.concat([id]); selectTopics([id]); }
        ui.open = null; ui.peek = null; render(); break;
      }
      case 'all-chips': ui.allChips = !ui.allChips; render(); break;
      case 'clear': ui.sel = []; ui.open = null; render(); break;
      case 'toggle': ui.open = ui.open === id ? null : id; ui.peek = null; ui.form = null; render(); break;
      case 'peek': ui.peek = ui.peek === id ? null : id; render(); break;
      case 'shot': ui.bigShot = ui.bigShot === id ? null : id; render(); break;
      case 'open-url': { const x = itemById(id); if (x && x.url) call(api.openBrowser(x.url)); break; }
      case 'retry': await call(api.retry(id)); toast('Running it again'); break;
      case 'delete':
        if (ui.confirmDel === id) { ui.confirmDel = null; ui.open = null; await call(api.deleteItem(id)); toast('Deleted'); }
        else { ui.confirmDel = id; render(); }
        break;
      case 'form-note': ui.form = { id, type: 'note' }; render(); if ($('noteInput')) $('noteInput').focus(); break;
      case 'form-remind': ui.form = { id, type: 'remind' }; render(); break;
      case 'form-cancel': ui.form = null; render(); break;
      case 'note-save': { const v = $('noteInput').value; if (!v.trim()) return; ui.form = null; await call(api.addNote(id, v)); toast('Note saved'); break; }
      case 'remind-save': { const d = $('remindDate').value; if (!d) { toast('Pick a date first'); return; } ui.form = null; await call(api.addReminder(id, d)); toast('Clew will remind you on ' + md(d)); break; }
      case 'r-confirm': { const r = S.reminders.find((x) => x.id === id); await call(api.reminder(id, 'confirm')); toast(r && r.dueDate ? 'Clew will remind you on ' + md(r.dueDate) : 'Added to reminders'); break; }
      case 'r-dismiss': await call(api.reminder(id, 'dismiss')); break;
      case 'r-done': await call(api.reminder(id, 'done')); break;
      case 'r-look': { const r = S.reminders.find((x) => x.id === id); if (r) goToItem(r.itemId); break; }
      case 'topic-open': ui.sel = [id]; selectTopics([id]); ui.open = null; setTab('feed'); break;
      case 'topic-edit': ui.editTopic = id; render(); break;
      case 'topic-cancel': ui.editTopic = null; render(); break;
      case 'topic-save': { const n = $('tName').value, a = $('tAlias').value; ui.editTopic = null; await call(api.updateTopic(id, n, a)); toast('Saved'); break; }
      case 'go-settings': setTab('settings'); break;
      case 'prov-save': {
        const f = { baseUrl: $('u-' + id).value, model: $('m-' + id).value, visionModel: $('v-' + id).value, key: $('k-' + id).value };
        if (!f.key && !S.settings.providers[id].hasKey) { toast('Paste an API key first'); return; }
        document.activeElement && document.activeElement.blur();
        await call(api.saveProvider(id, f));
        const res = await call(api.testProvider(id));
        const label = S.settings.providers[id].label;
        toast(res && res.status === 'ok' ? label + ' is connected' : label + ' didn\'t connect — see the message under it');
        break;
      }
      case 'prov-clear': await call(api.saveProvider(id, { clearKey: true })); break;
      case 'open-data': call(api.openDataFolder()); break;
    }
  });
  $('view').addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.role) call(api.setRole(el.dataset.role, el.value));
    if (el.dataset.rule) call(api.setRule(el.dataset.rule, el.value));
  });

  // ---------- composer ----------
  const input = $('input');
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; input.style.overflowY = input.scrollHeight > 140 ? 'auto' : 'hidden'; }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  $('logBtn').addEventListener('click', submit);

  function showAttach() {
    const a = $('attach');
    if (!ui.attach) { a.hidden = true; a.innerHTML = ''; input.placeholder = 'Link, thought, or Ctrl+V a screenshot'; return; }
    a.hidden = false;
    a.innerHTML = '<img src="' + ui.attach + '" alt="Screenshot ready to log"><span>Screenshot ready. Add a caption if you like (where it\'s from helps).</span><button type="button" class="pill ghost" id="dropAttach" aria-label="Remove screenshot">✕</button>';
    $('dropAttach').onclick = () => { ui.attach = null; showAttach(); };
    input.placeholder = 'Caption (optional), e.g. where it\'s from';
  }
  document.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.kind === 'file' && /^image\//.test(it.type)) {
        e.preventDefault();
        const f = it.getAsFile();
        if (f.size > 15 * 1024 * 1024) { toast('That image is over 15 MB'); return; }
        const r = new FileReader();
        r.onload = () => { ui.attach = r.result; showAttach(); input.focus(); };
        r.readAsDataURL(f);
        return;
      }
    }
    if (document.activeElement !== input && !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) {
      const t = e.clipboardData.getData('text');
      if (t) { e.preventDefault(); input.value = t; autosize(); input.focus(); }
    }
  });

  async function submit() {
    const text = input.value.trim();
    if (!text && !ui.attach) return;
    const m = text.match(/^(https?:\/\/\S+)\s*([\s\S]*)$/);
    let p;
    if (ui.attach) p = api.addShot(ui.attach, text);
    else if (m) p = api.addLink(m[1], m[2].trim());
    else p = api.addText(text);
    const ok = await call(p);
    if (ok === undefined) return;
    input.value = ''; ui.attach = null; showAttach(); autosize();
    ui.sel = []; ui.open = null;
    if (ui.tab !== 'feed') setTab('feed');
    $('view').scrollTop = 0;
    toast(hasBrain() ? 'Logged — Clew is on it' : 'Logged. Add an API key in Settings so Clew can sort it.');
  }

  // ---------- boot ----------
  api.onState((s) => { S = s; render(); });
  api.state().then((s) => { S = s; render(); });
})();
