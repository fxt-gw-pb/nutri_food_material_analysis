const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);

const clone = (v) => JSON.parse(JSON.stringify(v));
let storage, navigation, toasts, queries;
global.wx = {
  getStorageSync: (key) => storage[key] === undefined ? '' : clone(storage[key]),
  setStorageSync: (key, value) => { storage[key] = clone(value); },
  removeStorageSync: (key) => { delete storage[key]; },
  showToast: (v) => toasts.push(v),
  navigateTo: (v) => navigation.push(v.url),
  reLaunch: (v) => navigation.push(v.url),
  stopPullDownRefresh() {},
};
const service = require('../miniprogram/services/mealService.ts');
const profile = require('../miniprogram/services/userProfile.ts');
const intake = require('../miniprogram/utils/intake.ts');
const definitions = {};
for (const name of ['daily', 'evaluation']) {
  global.Page = (definition) => { definitions[name] = definition; };
  require(`../miniprogram/pages/${name}/${name}.ts`);
}
const page = (name) => ({
  ...definitions[name], data: clone(definitions[name].data), saveQueue: Promise.resolve(), percentages: {}, revision: 0,
  setData(values, cb) { Object.assign(this.data, clone(values)); if (cb) cb(); },
});
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

const day = intake.chinaDayRange('2026-11-20').start;
const record = (id, mealType, hours, evaluated) => ({
  analysisId: id, participantCode: '001207', status: 'completed', mealType, createdAt: day + hours * 3600000, updatedAt: 0,
  imageUrl: '', plateDiameterCm: 26, selectedRecords: {}, excludedIngredients: [], mealSessionId: 's', mealSessionFinishedAt: 1,
  dish: { dishName: id, cookingMethod: '炒', recognitionConfidence: 'high', ingredients: [{ name: '鸡蛋' }, { name: '馒头' }] },
  evaluationStatus: evaluated ? 'completed' : 'pending',
  consumption: evaluated ? { percentages: { 鸡蛋: 100, 馒头: 100 }, consumedGrams: { 鸡蛋: 50, 馒头: 100 }, totalConsumedG: 150, updatedAt: 0 } : undefined,
});

beforeEach((t) => {
  storage = {}; navigation = []; toasts = []; queries = [];
  t.mock.method(console, 'error', () => {});
  profile.saveUserProfile({ participantCode: '001207' });
  t.mock.method(service, 'getMealsInRange', async (code, start, end) => {
    queries.push([code, start, end]);
    return [record('早饭', 'breakfast', 1, true), record('午饭', 'lunch', 5, true), record('晚饭', 'dinner', 11, false)];
  });
});

test('每日汇总按编号和北京时间自然日查询，算出全天与逐餐，未评估的菜单独列出', async () => {
  const p = page('daily');
  p.onLoad({ date: '2026-11-20', participantCode: '001207', analysisId: '午饭' });
  p.onShow();
  await settle();
  assert.deepEqual(queries, [['001207', day, day + 86400000]]);
  assert.equal(p.data.dateText, '2026-11-20 周五');
  assert.equal(p.data.evaluatedCount, 2);
  assert.equal(p.data.pendingCount, 1);
  assert.deepEqual(p.data.pendingDishes.map((d) => d.dishName), ['晚饭']);
  assert.deepEqual(p.data.meals.map((m) => m.label), ['早餐', '午餐', '晚餐']);
  assert.equal(p.data.day.consumedG, 300);
  assert.equal(p.data.day.hasTexture, true);
  assert.equal(p.data.day.hasNutrition, true);
  assert.ok(p.data.meals[1].dishes[0].highlight);
  p.openDish({ currentTarget: { dataset: { id: '晚饭', evaluated: false } } });
  p.openDish({ currentTarget: { dataset: { id: '早饭', evaluated: true } } });
  assert.deepEqual(navigation, ['/pages/evaluation/evaluation?analysisId=%E6%99%9A%E9%A5%AD', '/pages/detail/detail?analysisId=%E6%97%A9%E9%A5%AD']);
});

test('不能翻到今天之后；没有编号时提示先填写，不去查询', async () => {
  const p = page('daily');
  p.onLoad({});
  assert.equal(p.data.isToday, true);
  p.nextDay();
  assert.equal(p.data.dateKey, intake.chinaDateKey(Date.now()));
  storage = {};
  const q = page('daily');
  q.onLoad({});
  q.onShow();
  await settle();
  assert.equal(q.data.participantCode, '');
  assert.equal(q.data.loaded, true);
  assert.equal(queries.length, 0);
});

test('完成饭后评估后跳到这条记录所在那天的每日汇总', async (t) => {
  const r = record('午饭', 'lunch', 5, false);
  t.mock.method(service, 'getMealAnalysisResult', async () => clone(r));
  t.mock.method(service, 'saveConsumptionEvaluation', async () => {});
  const p = page('evaluation');
  p.onLoad({ analysisId: '午饭' });
  await settle();
  assert.equal(p.data.intake, null);
  p.setPercent('鸡蛋', 100);
  assert.ok(p.data.intake, '确认一种食材后即显示这道菜的摄入');
  assert.equal(p.data.intake.consumedG, p.data.rows.find((row) => row.name === '鸡蛋').consumedG);
  p.setPercent('馒头', 50);
  await p.completeEvaluation();
  assert.equal(navigation.at(-1), `/pages/daily/daily?participantCode=001207&date=2026-11-20&analysisId=${encodeURIComponent('午饭')}`);
});
