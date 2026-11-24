const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../cloudfunctions/questionnaire/handler');
const schema = require('../cloudfunctions/questionnaire/schema.json');
const clone = (value) => JSON.parse(JSON.stringify(value));
let records, owner, handler, writeMode, now;

function query(filter = {}, ordering = [], offset = 0, count = Infinity) {
  return {
    where: (next) => query(next, ordering, offset, count),
    orderBy: (field, direction) => query(filter, [...ordering, [field, direction]], offset, count),
    skip: (next) => query(filter, ordering, next, count),
    limit: (next) => query(filter, ordering, offset, next),
    async get() {
      const data = [...records.values()].filter((record) => Object.entries(filter).every(([key, value]) => record[key] === value));
      data.sort((a, b) => {
        for (const [field, direction] of ordering) {
          if (a[field] !== b[field]) return (a[field] < b[field] ? -1 : 1) * (direction === 'desc' ? -1 : 1);
        }
        return 0;
      });
      return { data: clone(data.slice(offset, offset + count)) };
    },
    async add({ data }) {
      if (writeMode === 'fail') throw new Error('database unavailable');
      if (records.has(data._id)) throw new Error('duplicate key');
      records.set(data._id, clone(data));
      if (writeMode === 'lost-response') throw new Error('response lost after commit');
      return { _id: data._id };
    },
  };
}

beforeEach((t) => {
  records = new Map(); owner = 'wx-owner-a'; writeMode = ''; now = 1000;
  handler = createHandler({ db: { collection(name) { assert.equal(name, 'questionnaire_responses'); return query(); } },
    getOpenId: () => owner, now: () => now++ });
  t.mock.method(console, 'error', () => {});
});
function input(code = '001207', id = 'q_test_submission_1') {
  return { action: 'submit', submissionId: id, questionnaireVersion: schema.version, participantCode: code,
    answers: { q1: ['never'], q2: ['sometimes'], q3: ['often'], q4: ['almost_every_day'], q5: ['all'], q6: ['none'] } };
}

test('提交保存原文快照、文本编号与服务端时间，不接受客户端伪造身份或时间', async () => {
  const result = await handler({ ...input('  001207  '), _openid: 'forged', createdAt: -1, title: 'fake', answerItems: [] });
  assert.equal(result.ok, true);
  const doc = [...records.values()][0];
  assert.equal(doc.participantCode, '001207');
  assert.equal(doc._openid, owner);
  assert.equal(doc.createdAt, 1000);
  assert.equal(doc.answerItems.length, 6);
  assert.equal(doc.answerItems[0].question, schema.questions[0].title);
  assert.deepEqual(doc.answerItems[5].labels, ['都没有']);
  assert.equal('_openid' in result.data, false);
  assert.equal('score' in doc, false);
});

test('所有必答题、枚举与互斥规则在服务器重新校验，绕过前端也不能写入', async () => {
  const base = input();
  const invalid = [
    { ...base, participantCode: '   ' }, { ...base, participantCode: 1207 },
    { ...base, participantCode: 'a'.repeat(33) }, { ...base, questionnaireVersion: 'unknown' },
    { ...base, submissionId: '../bad' }, { ...base, answers: {} },
    { ...base, answers: { ...base.answers, q2: ['never', 'often'] } },
    { ...base, answers: { ...base.answers, q6: ['none', 'choking'] } },
    { ...base, answers: { ...base.answers, q1: ['unknown'] } },
    { ...base, answers: { ...base.answers, q6: ['choking', 'choking'] } },
    { ...base, answers: { ...base.answers, extra: ['x'] } },
  ];
  for (const event of invalid) assert.equal((await handler(event)).ok, false);
  assert.equal(records.size, 0);
});

test('同一提交并发、超时后重试只插入一份，保留首次时间与答案', async () => {
  const results = await Promise.all([handler(input()), handler(input())]);
  assert.equal(results[0].ok, true);
  assert.deepEqual(results[1], results[0]);
  assert.equal(records.size, 1);
  writeMode = 'lost-response';
  const committed = await handler(input('001207', 'q_test_submission_2'));
  assert.equal(committed.ok, true);
  assert.equal(records.size, 2);
  assert.deepEqual(await handler(input('001207', 'q_test_submission_2')), committed);
  const conflict = input(); conflict.answers.q1 = ['often'];
  assert.equal((await handler(conflict)).code, 'SUBMISSION_CONFLICT');
  assert.equal(records.get(results[0].data.responseId).answers.q1[0], 'never');
});

test('同一人可随时再次填写，每次新提交都有独立记录', async () => {
  const first = await handler(input());
  const second = await handler(input('001207', 'q_test_submission_2'));
  assert.notEqual(first.data.responseId, second.data.responseId);
  assert.equal(records.size, 2);
});

test('无微信身份拒绝请求；历史和详情都限制当前账号并按参与者筛选', async () => {
  const a = (await handler(input())).data;
  await handler(input('000008', 'q_test_submission_2'));
  owner = 'wx-owner-b';
  const b = (await handler(input())).data;
  assert.notEqual(a.responseId, b.responseId);
  assert.equal((await handler({ action: 'get', responseId: a.responseId, _openid: 'wx-owner-a' })).code, 'NOT_FOUND');
  const history = await handler({ action: 'list', participantCode: '001207', _openid: 'wx-owner-a' });
  assert.deepEqual(history.data.items.map((record) => record.responseId), [b.responseId]);
  owner = '';
  for (const event of [input(), { action: 'list', participantCode: '001207' }, { action: 'get', responseId: a.responseId }]) {
    assert.equal((await handler(event)).code, 'UNAUTHENTICATED');
  }
});

test('历史分页不截断第 21 条，非法页码被拒绝', async () => {
  for (let i = 0; i < 23; i++) await handler(input('001207', `q_test_submission_${i}`));
  const first = (await handler({ action: 'list', participantCode: '001207' })).data;
  const second = (await handler({ action: 'list', participantCode: '001207', offset: first.nextOffset })).data;
  assert.equal(first.items.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 3);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map((record) => record.responseId)).size, 23);
  assert.equal(first.items[0].createdAt, 1022);
  for (const offset of [-1, '0', 0.5, 100001]) assert.equal((await handler({ action: 'list', participantCode: '001207', offset })).ok, false);
});

test('数据库写失败且没有记录时返回失败，不能生成虚假成功回执', async () => {
  writeMode = 'fail';
  const result = await handler(input());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNAVAILABLE');
  assert.equal(records.size, 0);
});
