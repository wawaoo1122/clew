const assert = require('assert');
const { defaultSettings } = require('../src/store');
const P = require('../src/pipeline');
const { parseJSON } = require('../src/llm');

function fresh() { return { items: [], topics: [], chains: [], reminders: [], settings: defaultSettings() }; }
function mk(data, f) { const it = Object.assign({ id: 'i' + (data.items.length + 1), createdAt: '2026-11-14T03:00:00Z', status: 'processing', topics: [], pendingTopics: [] }, f); data.items.push(it); return it; }
const today = '2026-11-14';
let n = 0;
function test(name, fn) { fn(); n++; console.log('ok -', name); }

test('parseJSON handles fences, chatter and think tags', () => {
  assert.deepStrictEqual(parseJSON('<think>hmm {"x":1}</think>Sure!\n```json\n{"a":"b}","c":[1,{"d":2}]}\n```'), { a: 'b}', c: [1, { d: 2 }] });
});

test('loose dates', () => {
  assert.strictEqual(P.parseLooseDate('2027 Q2'), '2027-04-01');
  assert.strictEqual(P.parseLooseDate('2027-03'), '2027-03-01');
  assert.strictEqual(P.parseLooseDate('2027年3月'), '2027-03-01');
  assert.strictEqual(P.parseLooseDate('2026-12-05'), '2026-12-05');
  assert.strictEqual(P.parseLooseDate('明年'), null);
});

test('late-news rule: >30 days uses publish date', () => {
  const d = fresh();
  const it = mk(d, { kind: 'link' });
  P.applyResult(d, it, { title: 't', summary: 's', event_date: '2026-07-15', publish_date: '2026-10-05', topics: [{ name: 'InP' }] }, today);
  assert.strictEqual(it.sortDate, '2026-10-05');
  assert.strictEqual(it.dateBasis, 'pub');
  assert.strictEqual(it.lateGap, 82);
  const it2 = mk(d, { kind: 'link' });
  P.applyResult(d, it2, { title: 't', summary: 's', event_date: '2026-10-01', publish_date: '2026-10-05', topics: [] }, today);
  assert.strictEqual(it2.sortDate, '2026-10-01');
  assert.strictEqual(it2.dateBasis, 'event');
});

test('topics wait in Unsorted until 3 bits share a name, then become a topic with a chain', () => {
  const d = fresh();
  const a = mk(d, { kind: 'link' }); P.applyResult(d, a, { title: 'a', summary: '', topics: [{ name: 'InP' }], chain: { new_name: '紧缺' } }, today);
  const b = mk(d, { kind: 'link' }); P.applyResult(d, b, { title: 'b', summary: '', topics: [{ name: 'inp' }], chain: { new_name: '紧缺' } }, today);
  assert.strictEqual(d.topics.length, 0);
  assert.deepStrictEqual(a.topics, []);
  const c = mk(d, { kind: 'text', userText: 'my take' }); P.applyResult(d, c, { title: 'c', summary: '', topics: [{ name: 'InP' }], chain: { new_name: '出口管制' } }, today);
  assert.strictEqual(d.topics.length, 1);
  assert.strictEqual(d.topics[0].name, 'InP');
  for (const x of [a, b, c]) { assert.deepStrictEqual(x.topics, [d.topics[0].id]); assert.ok(x.chainId); assert.deepStrictEqual(x.pendingTopics, []); }
  assert.strictEqual(a.chainId, b.chainId);
  assert.notStrictEqual(a.chainId, c.chainId);
  assert.strictEqual(c.dateBasis, 'mine');
});

test('existing topic by alias; flip against my take creates a clash reminder; future dates suggested', () => {
  const d = fresh();
  d.topics.push({ id: 't1', name: 'InP', aliases: ['磷化铟'] });
  d.chains.push({ id: 'c1', topicId: 't1', name: '紧缺' });
  const mine = mk(d, { kind: 'text', userText: '紧缺持续', status: 'done', title: '我的判断', sortDate: '2026-10-12', topics: ['t1'], chainId: 'c1' });
  const it = mk(d, { kind: 'link' });
  P.applyResult(d, it, {
    title: '扩产', summary: 's', topics: [{ name: '磷化铟' }], chain: { existing_id: 'c1' },
    relation: { type: 'flip', to_id: mine.id, why: '方向相反' },
    future_dates: [{ date: '2027 Q2', what: '小批量出货' }, { date: '2020-01-01', what: 'past' }]
  }, today);
  assert.deepStrictEqual(it.topics, ['t1']);
  assert.strictEqual(it.chainId, 'c1');
  assert.strictEqual(it.rel.type, 'flip');
  const clash = d.reminders.filter((r) => r.kind === 'clash');
  assert.strictEqual(clash.length, 1);
  assert.strictEqual(clash[0].status, 'pending');
  const dates = d.reminders.filter((r) => r.kind === 'date');
  assert.strictEqual(dates.length, 1);
  assert.strictEqual(dates[0].dueDate, '2027-04-01');
  assert.strictEqual(dates[0].status, 'suggested');
});

test('bad ids from the model are ignored', () => {
  const d = fresh();
  const it = mk(d, { kind: 'link' });
  P.applyResult(d, it, { title: 'x', summary: '', topics: [{ existing_id: 't_nope', name: '' }], chain: { existing_id: 'c_nope' }, relation: { type: 'follow', to_id: 'i_nope' } }, today);
  assert.deepStrictEqual(it.topics, []);
  assert.strictEqual(it.rel, null);
  assert.strictEqual(it.chainId, null);
});

test('prompt includes topics, candidates and the new bit', () => {
  const d = fresh();
  d.topics.push({ id: 't1', name: 'InP', aliases: ['磷化铟'] });
  d.chains.push({ id: 'c1', topicId: 't1', name: '紧缺' });
  mk(d, { kind: 'link', status: 'done', title: '交期延长', summary: '摘要', sortDate: '2026-09-03', topics: ['t1'], chainId: 'c1' });
  const it = mk(d, { kind: 'link', url: 'https://x.com/a', rawTitle: 'T', rawText: '正文内容', pageDate: '2026-11-01' });
  const p = P.buildUserPrompt(d, it, today);
  for (const s of ['t1 | InP | 别名：磷化铟', 'c1 紧缺', 'i1 | 2026-09-03 | InP·紧缺', '网址：https://x.com/a', '网页里找到的发布日期：2026-11-01', '正文内容', '今天是 2026-11-14']) assert.ok(p.includes(s), 'missing: ' + s);
});

console.log(n + ' tests passed');
