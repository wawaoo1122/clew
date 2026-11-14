// Turns a raw bit (link / text / screenshot) into a tidy, linked entry.
// Pure functions over the data object, so it can be tested without Electron.
const { uid } = require('./store');

const SYSTEM_PROMPT = `你是 Clew 的整理助手。用户是一名投资研究者，会随手收集链接、截图和自己的想法。你的任务：读一条新碎片，把它整理好，并判断它和已有碎片的关系。

规则：
1. 只根据给出的原文写，不要编造原文没有的数字、日期和事实。原文信息不足就如实写“原文未说明”。
2. title：中文，20 字以内，说清楚这条讲了什么。
3. summary：中文，2 到 4 句，保留关键事实和数字。如果是用户自己写的想法，保留原意，只做轻微整理，不要加你的观点。
4. topics：1 到 3 个。主题必须是一个具体的东西（公司、材料、技术、产品、宏观变量），用最大类的名词命名。例如“InP 良率”“InP 出口管制”都归到“InP”。不能用“半导体”“科技”“投资”这种行业大类。已有主题（包括别名）能对上的，必须填它的 existing_id。
5. chain：在第一个主题之下，这条属于哪条事件链（同一件事的前后发展）。能对上已有链就填 existing_id；否则填 new_name（10 字以内，例如“紧缺”“出口管制”）。
6. relation：从【候选碎片】里找和它最直接相关的一条（通常是同一事件链里更早的那条）。type 只能是 follow（后续、补充、更新）、flip（结论方向相反，推翻或反驳之前的内容）、none。why 用一句中文说明为什么连起来。to_id 只能用候选列表里出现过的 id，没有合适的就 type 填 none。
7. event_date：事件实际发生的日期；publish_date：文章发布的日期。格式 YYYY-MM-DD，不知道就填 null，不要猜。
8. future_dates：原文提到的、值得提醒的未来时间点（例如财报日、量产时间、政策生效日）。没有就给空数组。date 用 YYYY-MM-DD，或者“2027 Q2”这种写法。
9. source：来源名称（媒体、网站、公众号、群名等），不知道就填 null。
10. 如果正文几乎没有实际信息（例如只有一张没读出文字的截图），topics 给空数组，relation 填 none，不要编主题名。

只输出一个 JSON 对象，不要输出任何其他文字。格式：
{"title":"","summary":"","source":null,"event_date":null,"publish_date":null,"topics":[{"name":"","existing_id":null}],"chain":{"existing_id":null,"new_name":""},"relation":{"type":"none","to_id":null,"why":""},"future_dates":[{"date":"","what":""}]}`;

const KIND_LABEL = { link: '链接', shot: '截图', text: '我的想法' };

function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function day(iso) { return String(iso || '').slice(0, 10); }
function validDate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00Z');
  return isNaN(d) ? null : m[1] + '-' + m[2] + '-' + m[3];
}
function shortDate(d) { const m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? Number(m[1]) + '/' + Number(m[2]) : String(d || ''); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }

// "2027 Q2" -> 2027-04-01, "2027-03" -> 2027-03-01, full date stays.
function parseLooseDate(s) {
  const full = validDate(s);
  if (full) return full;
  const str = String(s || '');
  let m = str.match(/(\d{4})\s*[- ]?\s*[Qq]([1-4])/);
  if (m) return m[1] + '-' + String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0') + '-01';
  m = str.match(/(\d{4})\s*[-/年]\s*(\d{1,2})/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-01';
  m = str.match(/(\d{4})\s*[Hh]([12])/);
  if (m) return m[1] + (m[2] === '1' ? '-01-01' : '-07-01');
  return null;
}

// Decide which date a bit sits at on the timeline.
function placeOnTimeline(item, lateDays) {
  const capture = day(item.createdAt);
  if (item.kind === 'text') { item.sortDate = capture; item.dateBasis = 'mine'; return; }
  const ev = validDate(item.eventDate), pub = validDate(item.pubDate);
  if (ev && pub) {
    const gap = daysBetween(ev, pub);
    if (gap > lateDays) { item.sortDate = pub; item.dateBasis = 'pub'; item.lateGap = gap; return; }
    item.sortDate = ev; item.dateBasis = 'event'; item.lateGap = 0; return;
  }
  if (ev) { item.sortDate = ev; item.dateBasis = 'event'; return; }
  if (pub) { item.sortDate = pub; item.dateBasis = 'pubonly'; return; }
  item.sortDate = capture; item.dateBasis = 'capture';
}

function topicLine(data, t) {
  const chains = data.chains.filter((c) => c.topicId === t.id).map((c) => c.id + ' ' + c.name).join('；');
  const alias = (t.aliases || []).length ? ' | 别名：' + t.aliases.join('、') : '';
  return '- ' + t.id + ' | ' + t.name + alias + (chains ? ' | 事件链：' + chains : '');
}

function buildUserPrompt(data, item, today) {
  const topics = data.topics.map((t) => topicLine(data, t)).join('\n') || '（还没有主题）';
  const pending = {};
  for (const it of data.items) for (const n of it.pendingTopics || []) pending[n] = (pending[n] || 0) + 1;
  const pendingLine = Object.keys(pending).length ? '\n【还没成型的主题名（可以复用这些名字）】\n' + Object.keys(pending).join('、') : '';
  const candidates = data.items
    .filter((x) => x.id !== item.id && x.status === 'done')
    .sort((a, b) => (b.sortDate || '').localeCompare(a.sortDate || ''))
    .slice(0, 60)
    .map((x) => {
      const tnames = (x.topics || []).map((id) => (data.topics.find((t) => t.id === id) || {}).name).filter(Boolean).join('/') || '未归类';
      const ch = x.chainId ? (data.chains.find((c) => c.id === x.chainId) || {}).name : '';
      return '- ' + x.id + ' | ' + x.sortDate + ' | ' + tnames + (ch ? '·' + ch : '') + ' | ' + KIND_LABEL[x.kind] + ' | ' + x.title + ' | ' + String(x.summary || '').slice(0, 100);
    })
    .join('\n') || '（还没有）';
  const lines = [
    '今天是 ' + today + '。',
    '',
    '【已有主题】',
    topics + pendingLine,
    '',
    '【候选碎片（新到旧）】',
    candidates,
    '',
    '【新碎片】',
    '类型：' + KIND_LABEL[item.kind]
  ];
  if (item.url) lines.push('网址：' + item.url);
  if (item.rawTitle) lines.push('网页标题：' + item.rawTitle);
  if (item.siteName) lines.push('网站名：' + item.siteName);
  if (item.pageDate) lines.push('网页里找到的发布日期：' + item.pageDate);
  if (item.userText && item.kind !== 'text') lines.push('用户附言：' + item.userText);
  lines.push('收录时间：' + day(item.createdAt));
  const body = item.kind === 'text' ? item.userText : item.rawText;
  lines.push('正文：', String(body || '（没有正文）').slice(0, 9000));
  return lines.join('\n');
}

function findTopicByName(data, name) {
  const n = norm(name);
  if (!n) return null;
  return data.topics.find((t) => norm(t.name) === n || (t.aliases || []).some((a) => norm(a) === n)) || null;
}

function ensureChain(data, topicId, name) {
  const nm = String(name || '').trim() || '综合';
  let c = data.chains.find((x) => x.topicId === topicId && norm(x.name) === norm(nm));
  if (!c) { c = { id: uid('c'), topicId, name: nm }; data.chains.push(c); }
  return c;
}

// Apply the model's answer to the item and the rest of the data.
function applyResult(data, item, r, today) {
  const settings = data.settings;
  item.title = String(r.title || item.rawTitle || item.userText || '未命名').slice(0, 80);
  item.summary = String(r.summary || '').slice(0, 1200);
  item.source = r.source ? String(r.source).slice(0, 60) : (item.siteName || null);
  item.eventDate = validDate(r.event_date);
  item.pubDate = validDate(r.publish_date) || validDate(item.pageDate);
  placeOnTimeline(item, settings.lateDays);

  // Topics
  const ids = [], pending = [];
  for (const t of (Array.isArray(r.topics) ? r.topics : []).slice(0, 3)) {
    if (!t) continue;
    let topic = t.existing_id ? data.topics.find((x) => x.id === t.existing_id) : null;
    if (!topic) topic = findTopicByName(data, t.name);
    if (topic) { if (!ids.includes(topic.id)) ids.push(topic.id); }
    else if (t.name && String(t.name).trim()) pending.push(String(t.name).trim().slice(0, 30));
  }
  item.topics = ids;
  item.pendingTopics = pending;
  const ch = r.chain || {};
  item.chainSuggestion = ch.new_name ? String(ch.new_name).slice(0, 20) : null;
  item.chainId = null;
  if (ids.length) {
    const existing = ch.existing_id && data.chains.find((c) => c.id === ch.existing_id && ids.includes(c.topicId));
    item.chainId = existing ? existing.id : ensureChain(data, ids[0], item.chainSuggestion).id;
  }

  // Relation
  const rel = r.relation || {};
  const target = rel.to_id && rel.to_id !== item.id ? data.items.find((x) => x.id === rel.to_id) : null;
  item.rel = target && (rel.type === 'follow' || rel.type === 'flip') ? { type: rel.type, to: target.id, why: String(rel.why || '').slice(0, 200) } : null;

  // A flip against your own take becomes a reminder.
  if (item.rel && item.rel.type === 'flip' && target.kind === 'text') {
    data.reminders.push({
      id: uid('r'), itemId: item.id, kind: 'clash', status: 'pending', dueDate: today, createdAt: new Date().toISOString(),
      text: '“' + item.title + '”和你 ' + shortDate(target.sortDate) + ' 的想法“' + target.title + '”方向相反'
    });
  }
  // Future dates become suggestions you can confirm.
  for (const fd of (Array.isArray(r.future_dates) ? r.future_dates : []).slice(0, 3)) {
    if (!fd || !fd.date) continue;
    const due = parseLooseDate(fd.date);
    if (due && due < today) continue;
    data.reminders.push({
      id: uid('r'), itemId: item.id, kind: 'date', status: 'suggested', dueDate: due, dateText: String(fd.date).slice(0, 20), createdAt: new Date().toISOString(),
      text: String(fd.what || item.title).slice(0, 120)
    });
  }
  item.status = 'done';
  item.error = null;
  promotePending(data);
}

// When enough unsorted bits share a topic name, make it a real topic.
function promotePending(data) {
  const min = data.settings.minTopic || 3;
  const counts = {};
  for (const it of data.items) for (const n of it.pendingTopics || []) {
    const k = norm(n); (counts[k] = counts[k] || { name: n, items: [] }).items.push(it);
  }
  for (const k of Object.keys(counts)) {
    const g = counts[k];
    if (g.items.length < min) continue;
    let topic = findTopicByName(data, g.name);
    if (!topic) { topic = { id: uid('t'), name: g.name, aliases: [], createdAt: new Date().toISOString(), lastViewedAt: null }; data.topics.push(topic); }
    for (const it of g.items) {
      if (!it.topics.includes(topic.id)) it.topics.push(topic.id);
      it.pendingTopics = it.pendingTopics.filter((n) => norm(n) !== k);
      if (!it.chainId) it.chainId = ensureChain(data, topic.id, it.chainSuggestion).id;
    }
  }
}

function relayoutAll(data) {
  for (const it of data.items) if (it.status === 'done') placeOnTimeline(it, data.settings.lateDays);
}

module.exports = { SYSTEM_PROMPT, buildUserPrompt, applyResult, promotePending, placeOnTimeline, parseLooseDate, relayoutAll, findTopicByName };
