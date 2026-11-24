const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);
const clone = (value) => JSON.parse(JSON.stringify(value));
let storage, navigation, toasts, calls, scrolls;
global.wx = {
  getStorageSync: (key) => storage[key] === undefined ? '' : clone(storage[key]),
  setStorageSync: (key, value) => { storage[key] = clone(value); },
  removeStorageSync: (key) => { delete storage[key]; },
  showToast: (value) => toasts.push(value),
  pageScrollTo: (value) => scrolls.push(value),
  navigateTo: (value) => navigation.push(value.url),
  redirectTo: (value) => navigation.push(value.url),
  navigateBack: () => navigation.push('back'),
  reLaunch: (value) => navigation.push(value.url),
  stopPullDownRefresh() {},
};
global.getCurrentPages = () => [];
const profile = require('../miniprogram/services/userProfile.ts');
const drafts = require('../miniprogram/services/questionnaireDraft.ts');
const service = require('../miniprogram/services/questionnaireService.ts');
const { questionnaireAnswerItems } = require('../miniprogram/utils/questionnaire.ts');
const { QUESTIONNAIRE_VERSION } = require('../miniprogram/data/questionnaire.ts');
const definitions = {};
for (const name of ['index', 'questionnaire', 'questionnaire-history']) {
  global.Page = (definition) => { definitions[name] = definition; };
  require(`../miniprogram/pages/${name}/${name}.ts`);
}
function page(name = 'questionnaire') {
  return { ...definitions[name], data: clone(definitions[name].data), answers: {},
    setData(values, cb) { Object.assign(this.data, clone(values)); if (cb) cb(); } };
}
function record(input) {
  return { ...clone(input), responseId: 'q_saved_1', createdAt: 1000, title: '每周随访问卷',
    recallPeriod: '最近一周', answerItems: questionnaireAnswerItems(input.answers) };
}
async function loadForm() { const form = page(); await form.loadQuestionnaire(); return form; }
function choose(form, question, value) { form.chooseOption({ currentTarget: { dataset: { question, value } } }); }
function fill(form) { for (const question of form.data.questions) choose(form, question.id, question.options[0].value); }
beforeEach((t) => {
  storage = {}; navigation = []; toasts = []; calls = []; scrolls = [];
  profile.saveUserProfile({ participantCode: '001207' });
  t.mock.method(service, 'submitQuestionnaire', async (input) => { calls.push(clone(input)); return record(input); });
  t.mock.method(console, 'error', () => {});
});

test('首页两个问卷入口均校验并保存编号，空编号不能进入', () => {
  const home = page('index');
  home.goQuestionnaire(); home.goQuestionnaireHistory();
  assert.deepEqual(navigation, []);
  home.onParticipantCodeInput({ detail: { value: '  000008  ' } });
  home.goQuestionnaire(); home.goQuestionnaireHistory();
  assert.deepEqual(navigation, ['/pages/questionnaire/questionnaire', '/pages/questionnaire-history/questionnaire-history']);
  assert.equal(profile.getUserProfile().participantCode, '000008');
});

test('新问卷没有默认答案，漏答提交定位到第一道漏答题且不请求云端', async () => {
  const form = await loadForm();
  assert.equal(form.data.answeredCount, 0);
  assert.ok(form.data.questions.every((question) => question.options.every((option) => !option.selected)));
  choose(form, 'q1', 'never');
  await form.submit();
  assert.equal(form.data.invalidId, 'q2');
  assert.equal(scrolls.at(-1).selector, '#question-q2');
  assert.equal(calls.length, 0);
});

test('两个参与者恢复各自草稿，修改本机编号不能改变已打开问卷的身份', async () => {
  const a = await loadForm();
  choose(a, 'q1', 'never');
  profile.saveUserProfile({ participantCode: '000008' });
  const b = await loadForm();
  assert.equal(b.data.answeredCount, 0);
  choose(b, 'q1', 'often');
  profile.saveUserProfile({ participantCode: '001207' });
  const reopened = await loadForm();
  assert.deepEqual(reopened.answers.q1, ['never']);
  profile.saveUserProfile({ participantCode: '777777' });
  fill(reopened);
  await reopened.submit();
  assert.equal(calls[0].participantCode, '001207');
  assert.equal(reopened.data.participantCode, '001207');
  assert.deepEqual(drafts.getQuestionnaireDraft('000008').answers.q1, ['often']);
  assert.equal(drafts.getQuestionnaireDraft('001207'), null);
});

test('提交进行中禁止修改和连点，提交成功显示保存答案', async (t) => {
  let release;
  t.mock.method(service, 'submitQuestionnaire', (input) => { calls.push(clone(input)); return new Promise((resolve) => { release = () => resolve(record(input)); }); });
  const form = await loadForm(); fill(form);
  const first = form.submit();
  choose(form, 'q1', 'often');
  await form.submit();
  assert.equal(calls.length, 1);
  assert.deepEqual(form.answers.q1, ['never']);
  release(); await first;
  assert.equal(form.data.saved, true);
  assert.equal(form.data.savedAnswers.length, 6);
  await form.submit();
  assert.equal(calls.length, 1);
});

test('超时保留完整待确认草稿；退出重开后重试使用相同编号和答案', async (t) => {
  t.mock.method(service, 'submitQuestionnaire', async (input) => { calls.push(clone(input)); throw new Error('timeout'); });
  const form = await loadForm(); fill(form);
  await form.submit();
  assert.equal(form.data.saved, false);
  assert.equal(form.data.pending, true);
  assert.equal(drafts.getQuestionnaireDraft('001207').pending, true);
  const reopened = await loadForm();
  choose(reopened, 'q1', 'often');
  assert.deepEqual(reopened.answers.q1, ['never']);
  t.mock.method(service, 'submitQuestionnaire', async (input) => { calls.push(clone(input)); return record(input); });
  await reopened.submit();
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(reopened.data.saved, true);
  assert.equal(drafts.getQuestionnaireDraft('001207'), null);
});

test('无法持久化提交编号时不发送请求，草稿失败不会声称已经保存', async (t) => {
  const form = await loadForm();
  t.mock.method(wx, 'setStorageSync', () => { throw new Error('full'); });
  fill(form);
  assert.match(form.data.saveText, /保存失败/);
  await form.submit();
  assert.equal(calls.length, 0);
  assert.equal(form.data.busy, false);
  assert.match(form.data.submitError, /尚未提交/);
});

test('查看历史详情采用当时编号和题目快照，不覆盖该参与者正在填写的草稿', async (t) => {
  const form = await loadForm(); fill(form);
  const original = record({ submissionId: form.submissionId, participantCode: '000008', questionnaireVersion: QUESTIONNAIRE_VERSION, answers: clone(form.answers) });
  original.answerItems[0].question = '当时版本的题目';
  const draftBefore = drafts.getQuestionnaireDraft('001207');
  t.mock.method(service, 'getQuestionnaireRecord', async () => original);
  const detail = page(); detail.responseId = original.responseId;
  await detail.loadQuestionnaire();
  assert.equal(detail.data.saved, true);
  assert.equal(detail.data.participantCode, '000008');
  assert.equal(detail.data.savedAnswers[0].question, '当时版本的题目');
  assert.deepEqual(drafts.getQuestionnaireDraft('001207'), draftBefore);
  choose(detail, 'q1', 'often');
  await detail.submit();
  assert.equal(calls.length, 0);
});

test('历史加载失败明确显示错误；重试、加载更多及查看记录保留正确编号', async (t) => {
  const seen = [];
  let fail = true;
  t.mock.method(service, 'getQuestionnaireHistory', async (code, offset) => {
    seen.push([code, offset]);
    if (fail) throw new Error('offline');
    return { items: [{ responseId: offset ? 'second' : 'first', participantCode: code, createdAt: 1000 }],
      hasMore: offset === 0, nextOffset: offset + 1 };
  });
  const history = page('questionnaire-history'); history.onLoad({ participantCode: encodeURIComponent('000008/%&中文') });
  await history.loadHistory(true);
  assert.match(history.data.error, /加载失败/);
  assert.equal(history.data.items.length, 0);
  fail = false;
  await history.loadHistory(true);
  await history.loadHistory(false);
  assert.deepEqual(history.data.items.map((item) => item.responseId), ['first', 'second']);
  assert.deepEqual(seen, [['000008/%&中文', 0], ['000008/%&中文', 0], ['000008/%&中文', 1]]);
  history.goDetail({ currentTarget: { dataset: { id: 'second' } } });
  assert.equal(navigation.at(-1), '/pages/questionnaire/questionnaire?responseId=second');
});

test('表单与历史之间替换页面，详情可返回已有历史页，不累积重复表单', async (t) => {
  const form = await loadForm();
  choose(form, 'q1', 'never');
  const redirected = [];
  t.mock.method(wx, 'redirectTo', (params) => redirected.push(params.url));
  form.goHistory();
  assert.match(redirected[0], /questionnaire-history\?participantCode=001207$/);
  const history = page('questionnaire-history'); history.onLoad({}); history.goQuestionnaire();
  assert.match(redirected[1], /questionnaire\?participantCode=001207$/);
  t.mock.method(global, 'getCurrentPages', () => [{ route: 'pages/questionnaire-history/questionnaire-history' }, { route: 'pages/questionnaire/questionnaire' }]);
  form.goHistory();
  assert.equal(navigation.at(-1), 'back');
  assert.deepEqual(drafts.getQuestionnaireDraft('001207').answers.q1, ['never']);
});
