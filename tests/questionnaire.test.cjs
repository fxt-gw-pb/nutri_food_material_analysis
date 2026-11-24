const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);

const schema = require('../miniprogram/data/questionnaire.ts');
const serverSchema = require('../cloudfunctions/questionnaire/schema.json');
const { chooseQuestionnaireOption: choose, validateQuestionnaireAnswers: validate, formatQuestionnaireTime } = require('../miniprogram/utils/questionnaire.ts');
const drafts = require('../miniprogram/services/questionnaireDraft.ts');
const service = require('../miniprogram/services/questionnaireService.ts');
const { CONFIG } = require('../miniprogram/services/config.ts');
const clone = (value) => JSON.parse(JSON.stringify(value));
let storage;
global.wx = {
  getStorageSync: (key) => storage[key] === undefined ? '' : clone(storage[key]),
  setStorageSync: (key, value) => { storage[key] = clone(value); },
  removeStorageSync: (key) => { delete storage[key]; },
  cloud: { callFunction: async () => { throw new Error('No test transport'); } },
};
beforeEach(() => { storage = {}; CONFIG.useCloud = true; });
function answers() { return { q1: ['never'], q2: ['sometimes'], q3: ['often'], q4: ['almost_every_day'], q5: ['most'], q6: ['none'] }; }
function submission(code = '001207', id = 'q_test_submission_1') {
  return { participantCode: code, submissionId: id, questionnaireVersion: schema.QUESTIONNAIRE_VERSION, answers: answers() };
}

test('客户端题目与服务器归档的题目、选项、互斥规则和版本一致', () => {
  assert.deepEqual({ version: schema.QUESTIONNAIRE_VERSION, title: schema.QUESTIONNAIRE_TITLE, questions: schema.QUESTIONNAIRE_QUESTIONS }, serverSchema);
});

test('单选替换旧值，多选支持组合、取消及“都没有”的双向互斥', () => {
  let selected = {};
  selected = choose(selected, 'q1', 'never');
  selected = choose(selected, 'q1', 'often');
  assert.deepEqual(selected.q1, ['often']);
  selected = choose(selected, 'q6', 'choking');
  selected = choose(selected, 'q6', 'swallowing_difficulty');
  assert.deepEqual(selected.q6, ['choking', 'swallowing_difficulty']);
  selected = choose(selected, 'q6', 'none');
  assert.deepEqual(selected.q6, ['none']);
  selected = choose(selected, 'q6', 'gastrointestinal_discomfort');
  assert.deepEqual(selected.q6, ['gastrointestinal_discomfort']);
  selected = choose(selected, 'q6', 'gastrointestinal_discomfort');
  assert.deepEqual(selected.q6, []);
  assert.deepEqual(choose(selected, 'q6', 'unknown'), selected);
});

test('草稿可未答，提交拒绝漏答、未知选项、单选多值、重复值和互斥冲突', () => {
  assert.equal(Object.values(validate({}, false)).filter((v) => v.length).length, 0);
  assert.throws(() => validate({}, true), /第 1 题/);
  for (const broken of [null, [], { ...answers(), q1: ['never', 'often'] }, { ...answers(), q2: ['invalid'] },
    { ...answers(), q6: ['choking', 'none'] }, { ...answers(), q6: ['choking', 'choking'] }, { ...answers(), extra: ['x'] }]) {
    assert.throws(() => validate(broken, true));
  }
  assert.deepEqual(validate(answers(), true), answers());
});

test('同手机的不同编号和云端/演示模式草稿隔离，保留前导零与特殊字符', () => {
  const a = { ...submission('001207'), answers: { q1: ['never'] }, pending: false, updatedAt: 1 };
  const b = { ...submission('000008/%&中文'), answers: { q1: ['often'] }, pending: false, updatedAt: 2 };
  drafts.saveQuestionnaireDraft(a);
  drafts.saveQuestionnaireDraft(b);
  assert.equal(drafts.getQuestionnaireDraft('001207').participantCode, '001207');
  assert.deepEqual(drafts.getQuestionnaireDraft(b.participantCode).answers.q1, ['often']);
  CONFIG.useCloud = false;
  assert.equal(drafts.getQuestionnaireDraft('001207'), null);
  CONFIG.useCloud = true;
  drafts.clearQuestionnaireDraft('001207');
  assert.equal(drafts.getQuestionnaireDraft('001207'), null);
  assert.equal(drafts.getQuestionnaireDraft(b.participantCode).participantCode, b.participantCode);
});

test('草稿存储失败向上抛错，损坏的待确认提交不会被当成新问卷', (t) => {
  drafts.saveQuestionnaireDraft({ ...submission(), pending: true, updatedAt: 1 });
  storage[Object.keys(storage)[0]].answers.q6 = ['none', 'choking'];
  assert.throws(() => drafts.getQuestionnaireDraft('001207'));
  t.mock.method(wx, 'setStorageSync', () => { throw new Error('storage full'); });
  assert.throws(() => drafts.saveQuestionnaireDraft({ ...submission(), pending: true, updatedAt: 1 }), /storage full/);
});

test('本地演示提交可重试且不重复，新提交独立保留，并可分页和查看原答案', async () => {
  CONFIG.useCloud = false;
  const first = await service.submitQuestionnaire(submission());
  assert.deepEqual(await service.submitQuestionnaire(submission()), first);
  const changed = submission(); changed.answers.q1 = ['often'];
  await assert.rejects(service.submitQuestionnaire(changed), /已提交/);
  for (let i = 2; i <= 23; i++) await service.submitQuestionnaire(submission('001207', `q_test_submission_${i}`));
  await service.submitQuestionnaire(submission('000008', 'q_other_submission_1'));
  const page1 = await service.getQuestionnaireHistory('001207');
  const page2 = await service.getQuestionnaireHistory('001207', page1.nextOffset);
  assert.equal(page1.items.length, 20);
  assert.equal(page1.hasMore, true);
  assert.equal(page2.items.length, 3);
  assert.equal(page2.hasMore, false);
  assert.deepEqual(await service.getQuestionnaireRecord(first.responseId), first);
  assert.equal(first.answerItems[5].labels[0], '都没有');
});

test('云端业务错误与网络异常不会变成成功，也不会静默切换本地保存', async (t) => {
  t.mock.method(wx.cloud, 'callFunction', async (params) => {
    assert.equal(params.name, 'questionnaire');
    assert.equal(params.data.participantCode, '001207');
    return { result: { ok: false, code: 'UNAVAILABLE', message: '问卷服务暂不可用' } };
  });
  await assert.rejects(service.submitQuestionnaire(submission()), /问卷服务暂不可用/);
  t.mock.method(wx.cloud, 'callFunction', async () => { throw new Error('offline'); });
  await assert.rejects(service.submitQuestionnaire(submission()), /offline/);
  assert.deepEqual(storage, {});
});

test('问卷时间固定为 UTC+08:00，跨日正确', () => {
  assert.equal(formatQuestionnaireTime(Date.parse('2026-10-15T16:01:00Z')), '2026-10-16 00:01');
});
