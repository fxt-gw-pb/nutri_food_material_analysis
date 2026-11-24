const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);
const clone = (v) => JSON.parse(JSON.stringify(v));
let navigation, stoppedRefresh;
global.wx = {
  getStorageSync: () => '', setStorageSync() {}, showToast() {},
  navigateTo: ({url}) => navigation.push(url), stopPullDownRefresh: () => { stoppedRefresh++; },
};
const service = require('../miniprogram/services/mealService.ts');
const definitions = {};
for (const name of ['history', 'result', 'detail', 'evaluation']) {
  global.Page = (definition) => { definitions[name] = definition; };
  require(`../miniprogram/pages/${name}/${name}.ts`);
}
const page = (name) => ({ ...definitions[name], data: clone(definitions[name].data),
  setData(values, cb) {
    for (const [key, value] of Object.entries(values)) {
      const match = key.match(/^ingredients\[(\d+)\]\.detailOpen$/);
      if (match) this.data.ingredients[Number(match[1])].detailOpen = value;
      else this.data[key] = clone(value);
    }
    if (cb) cb();
  },
});
const items = [
  { analysisId: 'a', participantCode: '001207', dishName: '土豆炖牛肉', ingredientText: '土豆、牛肉', evaluationStatus: 'pending' },
  { analysisId: 'b', participantCode: 'AB0002', dishName: '清蒸鱼', ingredientText: '鲈鱼', evaluationStatus: 'completed' },
  { analysisId: 'c', participantCode: '000003', dishName: '番茄鸡蛋', ingredientText: '番茄、鸡蛋' },
].map((it) => ({date: 1, totalCount: 2, totalConsumedG: 100, ...it}));
beforeEach((t) => {
  navigation = []; stoppedRefresh = 0;
  t.mock.method(console, 'error', () => {});
  t.mock.method(service, 'getMealHistory', async () => clone(items));
});
test('记录搜索保留前导零，支持菜名、食材和大小写无关编号，并与状态共同筛选', async () => {
  const history = page('history');
  await history.loadHistory();
  assert.equal(history.data.pendingCount, 2);
  assert.equal(history.data.evaluatedCount, 1);
  history.onSearchInput({detail: {value: ' 0012 '}});
  assert.deepEqual(history.data.visibleItems.map((it) => it.analysisId), ['a']);
  history.setFilter({currentTarget: {dataset: {filter: 'evaluated'}}});
  assert.deepEqual(history.data.visibleItems, []);
  history.onSearchInput({detail: {value: 'ab0002'}});
  assert.deepEqual(history.data.visibleItems.map((it) => it.analysisId), ['b']);
  history.onSearchInput({detail: {value: '鲈鱼'}});
  history.goDetail({currentTarget: {dataset: {id: history.data.visibleItems[0].analysisId}}});
  assert.deepEqual(navigation, ['/pages/detail/detail?analysisId=b']);
  history.resetFilters();
  assert.equal(history.data.visibleItems.length, 3);
  history.onSearchInput({detail: {value: '番茄'}});
  assert.deepEqual(history.data.visibleItems.map((it) => it.analysisId), ['c']);
});
test('列表刷新失败保留上次记录且显示错误，重试成功后清除错误并保留筛选', async (t) => {
  const history = page('history');
  await history.loadHistory();
  history.setFilter({currentTarget: {dataset: {filter: 'pending'}}});
  t.mock.method(service, 'getMealHistory', async () => { throw new Error('offline'); });
  await history.onPullDownRefresh();
  assert.equal(history.data.items.length, 3);
  assert.equal(history.data.visibleItems.length, 2);
  assert.ok(history.data.error);
  assert.equal(history.data.loading, false);
  assert.equal(stoppedRefresh, 1);
  t.mock.method(service, 'getMealHistory', async () => clone(items.slice(0, 2)));
  await history.loadHistory();
  assert.equal(history.data.error, '');
  assert.equal(history.data.visibleItems.length, 1);
  assert.equal(history.data.filter, 'pending');
});
for (const name of ['result', 'detail', 'evaluation']) {
  test(`${name} 请求失败结束加载动画并提供可重试错误，而不是空白结果`, async (t) => {
    t.mock.method(service, 'getMealAnalysisResult', async () => { throw new Error('offline'); });
    const target = page(name); target.analysisId = 'missing';
    await target.loadMeal();
    assert.equal(target.data.loaded, false);
    assert.ok(target.data.loadError);
    assert.equal(target.data.ingredients?.length || target.data.rows?.length || 0, 0);
  });
}
test('详情的指标展开仅影响点中的食材，并能再次收起', () => {
  const detail = page('detail');
  detail.data.ingredients = [{name: '土豆', detailOpen: false}, {name: '牛肉', detailOpen: false}];
  const event = {currentTarget: {dataset: {index: 1}}};
  detail.toggleDetail(event);
  assert.equal(detail.data.ingredients[0].detailOpen, false);
  assert.equal(detail.data.ingredients[1].detailOpen, true);
  detail.toggleDetail(event);
  assert.equal(detail.data.ingredients[1].detailOpen, false);
});
