// 2026-11-28：饮食记录按「日期 → 哪一餐 → 菜品」分层；饭后评估滑条 0–100%，另有输入框到 500%。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);

const clone = (v) => JSON.parse(JSON.stringify(v));
let storage, navigation, toasts, backs, modalAnswer;
global.wx = {
  getStorageSync: (key) => storage[key] === undefined ? '' : clone(storage[key]),
  setStorageSync: (key, value) => { storage[key] = clone(value); },
  removeStorageSync: (key) => { delete storage[key]; },
  showToast: (v) => toasts.push(v),
  navigateTo: (v) => navigation.push(v.url),
  navigateBack: (v) => backs.push(v || {}),
  reLaunch: (v) => navigation.push(`reLaunch:${v.url}`),
  showModal: async () => ({ confirm: modalAnswer, cancel: !modalAnswer }),
  stopPullDownRefresh() {},
};
const service = require('../miniprogram/services/mealService.ts');
const { groupHistory } = require('../miniprogram/utils/mealGroups.ts');
const { chinaDayRange } = require('../miniprogram/utils/intake.ts');
const definitions = {};
for (const name of ['history', 'meal', 'evaluation']) {
  global.Page = (definition) => { definitions[name] = definition; };
  require(`../miniprogram/pages/${name}/${name}.ts`);
}
const page = (name) => ({ ...definitions[name], data: clone(definitions[name].data), saveQueue: Promise.resolve(), percentages: {}, revision: 0,
  setData(values, cb) { Object.assign(this.data, clone(values)); if (cb) cb(); } });

const day = chinaDayRange('2026-11-27').start;
const prevDay = chinaDayRange('2026-11-26').start;
const item = (id, code, ts, mealType, evaluated) => ({ analysisId: id, participantCode: code, date: ts, mealType, imageUrl: `img-${id}`,
  dishName: `菜${id}`, ingredientText: '鸡蛋', textureSummary: '偏软', totalCount: 1, matchedCount: 1, totalG: 100,
  evaluationStatus: evaluated ? 'completed' : 'pending', totalConsumedG: evaluated ? 80 : undefined });
const H = 3600000;
const historyItems = [
  item('d1', '001', day + 19 * H, 'dinner', false),
  item('l1', '001', day + 12 * H, 'lunch', true),
  item('l2', '001', day + 12.2 * H, 'lunch', false),
  item('b1', '001', day + 7 * H, 'breakfast', true),
  item('x1', '002', day + 12 * H, 'lunch', true),
  item('p1', '001', prevDay + 12 * H, 'lunch', true),
  item('n1', '', prevDay + 9 * H, undefined, false),
];

beforeEach((t) => {
  storage = {}; navigation = []; toasts = []; backs = []; modalAnswer = true;
  t.mock.method(console, 'error', () => {});
});

test('按参与者、北京时间自然日和餐次分组：日期倒序、天内早餐在前，统计待评与已评', () => {
  const days = groupHistory(historyItems, day + 20 * H);
  assert.deepEqual(days.map((d) => [d.dateKey, d.label]), [['2026-11-27', '今天'], ['2026-11-26', '昨天']]);
  assert.equal(days[0].dateText, '11月27日 周五');
  assert.deepEqual(days[0].meals.map((m) => [m.participantCode, m.mealTypeText, m.dishCount, m.pendingCount]),
    [['001', '早餐', 1, 0], ['001', '午餐', 2, 1], ['002', '午餐', 1, 0], ['001', '晚餐', 1, 1]]);
  const lunch = days[0].meals[1];
  assert.deepEqual(lunch.analysisIds, ['l1', 'l2']);
  assert.equal(lunch.dishNames, '菜l1、菜l2');
  assert.deepEqual(lunch.thumbs, ['img-l1', 'img-l2']);
  assert.equal(lunch.statusText, '1 道待评估');
  assert.equal(days[0].meals[0].statusText, '✓ 已评估');
  assert.equal(days[1].meals.find((m) => m.participantCode === '').mealTypeText, '未选餐次');
});

test('饮食记录页：筛选后只显示含符合条件菜品的那一餐，点进去带上编号、日期和餐次', async (t) => {
  t.mock.method(service, 'getMealHistory', async () => clone(historyItems));
  const history = page('history');
  await history.loadHistory();
  assert.equal(history.data.days.length, 2);
  history.setFilter({ currentTarget: { dataset: { filter: 'pending' } } });
  assert.deepEqual(history.data.days.map((d) => d.meals.map((m) => m.key)),
    [['001|2026-11-27|lunch', '001|2026-11-27|dinner'], ['|2026-11-26|none']]);
  // 一餐的统计按全部菜算，不因筛选变少
  assert.equal(history.data.days[0].meals[0].dishCount, 2);
  history.goMeal({ currentTarget: { dataset: { key: '001|2026-11-27|lunch' } } });
  history.goMeal({ currentTarget: { dataset: { key: '|2026-11-26|none' } } });
  assert.deepEqual(navigation, ['/pages/meal/meal?participantCode=001&date=2026-11-27&mealType=lunch',
    '/pages/meal/meal?participantCode=&date=2026-11-26&mealType=none']);
});

const analysis = (id, mealType, hours, extra = {}) => ({ analysisId: id, participantCode: '001', status: 'completed', mealType,
  createdAt: day + hours * H, updatedAt: 0, imageUrl: `img-${id}`, plateDiameterCm: 26, selectedRecords: {}, excludedIngredients: [],
  dish: { dishName: `菜${id}`, cookingMethod: '炒', recognitionConfidence: 'high', ingredients: [{ name: '鸡蛋', areaRatio: 0.2, heightCm: 2, estimatedG: 80 }] },
  evaluationStatus: 'pending', mealSessionId: 's1', mealSessionFinishedAt: 1, ...extra });

test('这一餐：按编号和当天查全，只留同一餐次；评估下一道带 from=meal；全部评完可看当天汇总', async (t) => {
  const queries = [];
  let meals = [analysis('l2', 'lunch', 12.5), analysis('l1', 'lunch', 12, { evaluationStatus: 'completed', consumption: { totalConsumedG: 60 } }), analysis('d1', 'dinner', 19)];
  t.mock.method(service, 'getMealsInRange', async (code, start, end) => { queries.push([code, start, end]); return clone(meals); });
  const p = page('meal');
  p.onLoad({ participantCode: '001', date: '2026-11-27', mealType: 'lunch' });
  await p.load();
  assert.deepEqual(queries, [['001', day, day + 24 * H]]);
  assert.equal(p.data.title, '午餐');
  assert.deepEqual(p.data.dishes.map((d) => [d.analysisId, d.evaluated, d.timeText]), [['l1', true, '12:00'], ['l2', false, '12:30']]);
  assert.equal(p.data.pendingCount, 1);
  assert.equal(p.data.dishes[0].consumedG, 60);
  p.evaluateNext();
  p.goDetail({ currentTarget: { dataset: { id: 'l1' } } });
  assert.deepEqual(navigation, ['/pages/evaluation/evaluation?analysisId=l2&from=meal', '/pages/detail/detail?analysisId=l1&from=meal']);
  meals = meals.map((m) => ({ ...m, evaluationStatus: 'completed' }));
  await p.load();
  assert.equal(p.data.pendingCount, 0);
  p.goDaily();
  assert.equal(navigation.at(-1), '/pages/daily/daily?participantCode=001&date=2026-11-27');
});

test('这一餐还没点「拍完了」时不能直接评估，可以在这一页结束拍照', async (t) => {
  const finished = [];
  t.mock.method(service, 'getMealsInRange', async () => clone([analysis('l1', 'lunch', 12, { mealSessionFinishedAt: undefined })]));
  t.mock.method(service, 'finishMealSession', async (id) => { finished.push(id); });
  const p = page('meal');
  p.onLoad({ participantCode: '001', date: '2026-11-27', mealType: 'lunch' });
  await p.load();
  assert.equal(p.data.unfinishedCount, 1);
  p.goEvaluate({ currentTarget: { dataset: { id: 'l1' } } });
  assert.deepEqual(navigation, []);
  assert.match(toasts[0].title, /拍完了/);
  await p.finishMeal();
  assert.deepEqual(finished, ['s1']);
});

test('没有编号的旧记录从最近饮食记录里找这一餐', async (t) => {
  t.mock.method(service, 'getMealHistory', async () => clone(historyItems));
  const p = page('meal');
  p.onLoad({ participantCode: '', date: '2026-11-26', mealType: 'none' });
  await p.load();
  assert.deepEqual(p.data.dishes.map((d) => d.analysisId), ['n1']);
  assert.equal(p.data.title, '未选餐次');
});

test('饭后评估：滑条最多 100%，超过一份用按钮或输入框，输入框只收 0–500 的整数', async (t) => {
  const record = analysis('l2', 'lunch', 12.5);
  t.mock.method(service, 'getMealAnalysisResult', async () => clone(record));
  const saved = [];
  t.mock.method(service, 'saveConsumptionEvaluation', async (id, p, complete) => { saved.push([id, clone(p), complete]); });
  const e = page('evaluation');
  e.onLoad({ analysisId: 'l2', from: 'meal' });
  await e.loadMeal();
  assert.equal(e.data.rows[0].sliderValue, 100);
  assert.equal(e.data.rows[0].inputText, '');
  const ev = (value) => ({ currentTarget: { dataset: { name: '鸡蛋' } }, detail: { value } });
  e.applyManual(ev('250'));
  assert.equal(e.data.rows[0].percent, 250);
  assert.equal(e.data.rows[0].sliderValue, 100, '超过 100% 时滑条停在最右');
  assert.equal(e.data.rows[0].inputText, '250');
  for (const bad of ['501', '-1', '12.5', 'abc']) e.applyManual(ev(bad));
  assert.equal(toasts.length, 4);
  assert.equal(e.data.rows[0].percent, 250);
  e.onSliderChange(ev(40));
  assert.equal(e.data.rows[0].percent, 40);
  assert.equal(e.data.rows[0].sliderValue, 40);
  await e.saveQueue;
  await e.completeEvaluation();
  assert.deepEqual(saved.at(-1), ['l2', { 鸡蛋: 40 }, true]);
  // 从「这一餐」来的，评估完回到那一页
  assert.equal(backs.length, 1);
  assert.equal(navigation.filter((u) => u.startsWith('reLaunch:')).length, 0);
});
