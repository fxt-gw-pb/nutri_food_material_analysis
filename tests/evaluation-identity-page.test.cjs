const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);

const clone = (value) => JSON.parse(JSON.stringify(value));
let storage, records, savedEvaluations, navigation, toasts;
global.wx = {
  getStorageSync: (key) => storage[key] === undefined ? '' : clone(storage[key]),
  setStorageSync: (key, value) => { storage[key] = clone(value); },
  removeStorageSync: (key) => { delete storage[key]; },
  showToast: (value) => toasts.push(value),
  navigateTo: (value) => navigation.push(value.url),
  reLaunch: (value) => navigation.push(value.url),
};

const service = require('../miniprogram/services/mealService.ts');
const profile = require('../miniprogram/services/userProfile.ts');
const draft = require('../miniprogram/services/evaluationDraft.ts');
const definitions = {};
for (const name of ['result', 'detail', 'evaluation', 'history']) {
  global.Page = (definition) => { definitions[name] = definition; };
  require(`../miniprogram/pages/${name}/${name}.ts`);
}

function meal(analysisId, participantCode) {
  return {
    analysisId, ...(participantCode === undefined ? {} : { participantCode }),
    imageUrl: `cloud://original-${analysisId}`,
    mealSessionId: 'shared-phone-meal', mealSessionFinishedAt: 20,
    status: 'completed', evaluationStatus: 'pending', mealType: 'lunch',
    createdAt: 10, updatedAt: 20, plateDiameterCm: 26,
    // The same dish name cannot distinguish the two people; the ID and photo must.
    dish: { dishName: '土豆', cookingMethod: '煮', recognitionConfidence: 'high',
      ingredients: [{ name: '土豆', estimatedG: 100 }] },
  };
}

function makePage(name) {
  return {
    ...definitions[name], data: clone(definitions[name].data),
    percentages: {}, saveQueue: Promise.resolve(), revision: 0,
    setData(values, callback) {
      Object.assign(this.data, clone(values));
      if (callback) callback();
    },
  };
}

async function waitForLoaded(page) {
  // Page hooks intentionally return void, so allow their mocked promise chains to settle.
  for (let attempt = 0; attempt < 10 && !page.data.loaded; attempt++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(page.data.loaded, true, 'page should finish loading the requested record');
}

async function loadPage(name, analysisId) {
  const page = makePage(name);
  if (page.onLoad) page.onLoad({ analysisId });
  if (page.onShow) page.onShow();
  await waitForLoaded(page);
  return page;
}

beforeEach((t) => {
  storage = {};
  records = { A: meal('A', '001207'), B: meal('B', '009999') };
  savedEvaluations = [];
  navigation = [];
  toasts = [];
  profile.saveUserProfile({ participantCode: '777777' });

  t.mock.method(service, 'getMealAnalysisResult', async (analysisId) => {
    assert.ok(records[analysisId], `unknown record ${analysisId}`);
    return clone(records[analysisId]);
  });
  t.mock.method(service, 'saveAuditSnapshot', async () => {});
  t.mock.method(service, 'saveConsumptionEvaluation', async (analysisId, percentages, complete) => {
    assert.ok(records[analysisId], `unknown evaluation record ${analysisId}`);
    savedEvaluations.push({ analysisId, percentages: clone(percentages), complete });
    records[analysisId].consumption = {
      percentages: clone(percentages), consumedGrams: {}, totalConsumedG: 0, updatedAt: 30,
    };
    records[analysisId].evaluationStatus = complete ? 'completed' : 'pending';
  });
  t.mock.method(service, 'getMealHistory', async () => Object.values(records).map((record) => ({
    analysisId: record.analysisId, participantCode: record.participantCode || '',
    mealSessionId: record.mealSessionId, mealSessionFinishedAt: record.mealSessionFinishedAt,
    date: record.createdAt, mealType: record.mealType, imageUrl: record.imageUrl,
    dishName: record.dish.dishName, matchedCount: 1, totalCount: 1,
    ingredientText: '土豆', textureSummary: '偏软', totalG: 100,
    evaluationStatus: record.evaluationStatus,
  })));
});

test('结果、详情和评估均显示该菜拍照时的编号与原图，忽略手机当前编号', async () => {
  for (const name of ['result', 'detail', 'evaluation']) {
    for (const analysisId of ['A', 'B']) {
      const page = await loadPage(name, analysisId);
      assert.equal(page.analysisId, analysisId);
      assert.equal(page.data.participantCode, records[analysisId].participantCode, name);
      assert.equal(page.data.imageUrl, records[analysisId].imageUrl, name);
      if (name === 'evaluation') assert.equal(page.meal.mealSessionId, 'shared-phone-meal');
      else assert.equal(page.data.mealSessionId, 'shared-phone-meal');
    }
  }
  assert.equal(profile.getUserProfile().participantCode, '777777');
  assert.deepEqual(toasts, []);
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/evaluation/evaluation.wxml'), 'utf8');
  assert.match(template, /<image[^>]*class="evaluation-photo"[^>]*src="\{\{imageUrl\}\}"/);
});

test('同手机两人的评估草稿和完成提交始终写入各自的 analysisId', async () => {
  const a = await loadPage('evaluation', 'A');
  const b = await loadPage('evaluation', 'B');
  a.setPercent('土豆', 25);
  b.setPercent('土豆', 75);
  await Promise.all([a.saveQueue, b.saveQueue]);
  profile.saveUserProfile({ participantCode: '888888' });
  await a.completeEvaluation();
  await b.completeEvaluation();

  assert.deepEqual(savedEvaluations, [
    { analysisId: 'A', percentages: { 土豆: 25 }, complete: false },
    { analysisId: 'B', percentages: { 土豆: 75 }, complete: false },
    { analysisId: 'A', percentages: { 土豆: 25 }, complete: true },
    { analysisId: 'B', percentages: { 土豆: 75 }, complete: true },
  ]);
  assert.equal(a.data.participantCode, '001207');
  assert.equal(b.data.participantCode, '009999');
  assert.equal(draft.getEvaluationDraft('A'), null);
  assert.equal(draft.getEvaluationDraft('B'), null);
  assert.equal(navigation.length, 2);
});

test('离线草稿按菜恢复，当前手机编号不会改变恢复后的参与者身份', async () => {
  draft.saveEvaluationDraft('A', { 土豆: 10 });
  draft.saveEvaluationDraft('B', { 土豆: 90 });
  const a = await loadPage('evaluation', 'A');
  const b = await loadPage('evaluation', 'B');
  assert.equal(a.data.rows[0].percent, 10);
  assert.equal(b.data.rows[0].percent, 90);
  assert.equal(a.data.participantCode, '001207');
  assert.equal(b.data.participantCode, '009999');
  await a.completeEvaluation();
  assert.deepEqual(savedEvaluations, [{ analysisId: 'A', percentages: { 土豆: 10 }, complete: true }]);
  assert.deepEqual(draft.getEvaluationDraft('B').percentages, { 土豆: 90 });
});

test('完成后重开修改 A 的评估保留原编号，不影响 B 的比例', async () => {
  const a = await loadPage('evaluation', 'A');
  a.setPercent('土豆', 25);
  await a.completeEvaluation();
  records.B.consumption = { percentages: { 土豆: 75 }, consumedGrams: {}, totalConsumedG: 75, updatedAt: 30 };
  records.B.evaluationStatus = 'completed';
  profile.saveUserProfile({ participantCode: '888888' });
  // A completed evaluation must prefer its saved record over an obsolete local draft.
  draft.saveEvaluationDraft('A', { 土豆: 5 });
  const reopened = await loadPage('evaluation', 'A');
  assert.equal(reopened.data.completed, true);
  assert.equal(reopened.data.participantCode, '001207');
  assert.equal(reopened.data.rows[0].percent, 25);
  const countBeforeEdit = savedEvaluations.length;
  reopened.setPercent('土豆', 50);
  await reopened.saveQueue;
  assert.equal(savedEvaluations.length, countBeforeEdit, 'completed edits wait for explicit submission');
  await reopened.completeEvaluation();
  assert.deepEqual(savedEvaluations.at(-1), { analysisId: 'A', percentages: { 土豆: 50 }, complete: true });
  assert.deepEqual(records.B.consumption.percentages, { 土豆: 75 });
});

test('历史保留每条菜的编号、照片与跳转 ID', async () => {
  const page = await loadPage('history');
  assert.deepEqual(page.data.items.map((item) => [item.analysisId, item.participantCode, item.imageUrl]), [
    ['A', '001207', 'cloud://original-A'], ['B', '009999', 'cloud://original-B'],
  ]);
  page.goDetail({ currentTarget: { dataset: { id: 'B' } } });
  assert.deepEqual(navigation, ['/pages/detail/detail?analysisId=B']);
  // 历史按「日期 → 哪一餐」分组后，每一餐和「这一餐」页仍显示编号，缺编号的旧记录明确标注。
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/history/history.wxml'), 'utf8');
  assert.match(template, /meal\.participantCode \|\| '未记录编号'/);
  const mealTemplate = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/meal/meal.wxml'), 'utf8');
  assert.match(mealTemplate, /participantCode \|\| '未记录编号'/);
});

test('旧记录缺编号时所有页面保持空身份并明确标注未记录编号', async () => {
  records.legacy = meal('legacy');
  for (const name of ['result', 'detail', 'evaluation']) {
    const page = await loadPage(name, 'legacy');
    assert.equal(page.data.participantCode, '', name);
    assert.equal(page.data.imageUrl, 'cloud://original-legacy', name);
    const template = fs.readFileSync(path.join(__dirname, `../miniprogram/pages/${name}/${name}.wxml`), 'utf8');
    assert.match(template, /participantCode \|\| '未记录编号'/);
  }
  const history = await loadPage('history');
  assert.equal(history.data.items.find((item) => item.analysisId === 'legacy').participantCode, '');
  assert.equal(profile.getUserProfile().participantCode, '777777');
});

test('32 字符编号完整保留到各显示页面与历史条目', async () => {
  const code = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
  assert.equal(code.length, 32);
  records.long = meal('long', code);
  for (const name of ['result', 'detail', 'evaluation']) {
    const page = await loadPage(name, 'long');
    assert.equal(page.data.participantCode, code, name);
  }
  const history = await loadPage('history');
  assert.equal(history.data.items.find((item) => item.analysisId === 'long').participantCode, code);
});
