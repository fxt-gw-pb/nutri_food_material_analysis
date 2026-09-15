const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);
const clone = (v) => JSON.parse(JSON.stringify(v));
let records = {}, storage = {}, failWrite = false, pageDefinition, navigation = [];
const db = {
  command: { set: (v) => ({ __replace: v }) },
  collection() {
    let filter = {}, count = Infinity;
    const query = {
      where(value) { filter = value; return query; }, limit(value) { count = value; return query; },
      orderBy() { return query; },
      async get() { return { data: Object.values(records).filter((r) => Object.entries(filter).every(([k,v]) => r[k] === v)).slice(0,count).map(clone) }; },
      doc(id) { return {
        async get() { if (!records[id]) throw Error('missing'); return { data: clone(records[id]) }; },
        async update({ data }) {
          if (failWrite) throw Error('offline');
          if (!records[id]) throw Error('missing');
          Object.entries(data).forEach(([k,v]) => { records[id][k] = clone(v && v.__replace !== undefined ? v.__replace : v); });
          return { stats: { updated: 1 } };
        },
        async remove() { delete records[id]; },
      }; },
    }; return query;
  },
};
global.wx = {
  cloud: { database: () => db, deleteFile: async () => {}, callFunction: async ({ data }) => {
    if (data.action === 'create') {
      records.created = { _id: 'created', status: 'pending', result: { dish: null }, createdAt: Date.now(), updatedAt: Date.now() };
      return { result: { analysisId: 'created' } };
    }
    return { result: {} };
  } },
  getStorageSync: (key) => storage[key] === undefined ? '' : clone(storage[key]),
  setStorageSync: (key, value) => { if (failWrite) throw Error('storage full'); storage[key] = clone(value); },
  removeStorageSync: (key) => { delete storage[key]; },
  showModal: async () => ({ confirm: true }), showToast() {},
  navigateTo: (v) => navigation.push(v.url), reLaunch: (v) => navigation.push(v.url),
};
global.Page = (page) => { pageDefinition = page; };
const { estimateWeight, meatCorrectionFactor } = require('../miniprogram/utils/weight.ts');
const { resolveMeal } = require('../miniprogram/utils/texture.ts');
const { buildConsumption, buildAuditSnapshot } = require('../miniprogram/utils/evaluation.ts');
const cloud = require('../miniprogram/services/mealService.cloud.ts');
const mock = require('../miniprogram/services/mealService.mock.ts');
const service = require('../miniprogram/services/mealService.ts');
const draft = require('../miniprogram/services/evaluationDraft.ts');
const { checkPendingEvaluation } = require('../miniprogram/utils/evaluationNavigation.ts');
const dish = { dishName: '土豆炖牛肉', cookingMethod: '炖', recognitionConfidence: 'high', ingredients: [
  { name: '牛肉', estimatedG: 200 }, { name: '土豆', estimatedG: 100 }, { name: '青椒', estimatedG: 50 },
] };
function meal(extra = {}) { return { analysisId: 'm1', imageUrl: '', status: 'completed', dish: clone(dish), plateDiameterCm: 26, createdAt: 10, updatedAt: 10, evaluationStatus: 'pending', ...extra }; }
function doc(m) { const { analysisId, dish, ...rest } = m; return { _id: analysisId, ...rest, result: { dish } }; }
function reset(m = meal()) { records = { m1: doc(m) }; storage = {}; navigation = []; failWrite = false; }
function page() {
  const p = { ...pageDefinition, data: clone(pageDefinition.data), percentages: {}, saveQueue: Promise.resolve(), revision: 0 };
  p.setData = function(values, cb) { Object.assign(this.data, clone(values)); if (cb) cb(); };
  p.analysisId = 'm1'; return p;
}
require('../miniprogram/pages/evaluation/evaluation.ts');

test('肉类直接估重及区间准确减半，非肉类及肉类菜肴中的配菜不打折', () => {
  for (const name of ['猪肉','牛肉','牛柳','牛腩','五花肉','里脊','猪排骨','鸡胸肉','鸭腿','羊肉','火腿']) {
    assert.equal(meatCorrectionFactor(name), .5, name);
    const w = estimateWeight({ name, grams: 200 }, 26);
    assert.equal(w.grams, 100); assert.equal(w.minG, 40); assert.equal(w.maxG, 160);
    assert.match(w.basis, /乘 0.5/);
  }
  for (const name of ['土豆','青椒','鱼肉','虾仁','鸡蛋','素肉','鸡腿菇','鸡毛菜','羊肚菌','猪肚菇','果肉','肉桂']) {
    assert.equal(meatCorrectionFactor(name), 1, name);
    assert.equal(estimateWeight({ name, grams: 200, category: '肉类菜肴' },26).grams,200);
  }
});
test('几何估重、直接估重缺失、非法数字和零食材都有稳定结果', () => {
  assert.ok(estimateWeight({ name: '牛肉', areaRatio: .3, heightCm: 2 }, 26).grams > 0);
  assert.equal(estimateWeight({ name: '牛肉', grams: Infinity },26).grams,0);
  assert.equal(estimateWeight({ name: '牛肉' },26).grams,0);
  assert.equal(resolveMeal(null).totalG,0);
});
test('删除后列表、总重一致，审核快照仍保留原识别、排除标记和来源', () => {
  const m = meal({ excludedIngredients: ['牛肉'] });
  const r = resolveMeal(m.dish, {}, 26, m.excludedIngredients);
  assert.deepEqual(r.ingredients.map((i) => i.name),['土豆','青椒']); assert.equal(r.totalG,150);
  const audit = buildAuditSnapshot(m);
  assert.equal(audit.totalG,150); assert.equal(audit.ingredients.length,3);
  assert.equal(audit.ingredients[0].excluded,true); assert.ok(audit.ingredients[0].weightBasis);
  assert.ok(audit.ingredients.some((i) => i.recordId && i.sources.length));
});
test('比例支持0到500，漏填和越界不能完成，按已修正重量计算摄入', () => {
  const m = meal();
  assert.throws(() => buildConsumption(m, { 牛肉: 100 }, true), /土豆/);
  for (const p of [-1,501,NaN,Infinity]) assert.throws(() => buildConsumption(m, { 牛肉:p }, false));
  const c = buildConsumption(m,{ 牛肉:500, 土豆:0, 青椒:50 },true);
  assert.deepEqual(c.consumedGrams,{ 牛肉:500, 土豆:0, 青椒:25 }); assert.equal(c.totalConsumedG,525);
  assert.ok(c.completedAt);
});
test('云端草稿、完成和删除整份替换；旧数据不强制补评', async () => {
  reset(meal({ evaluationStatus: undefined })); assert.equal(await cloud.getPendingMealEvaluation(),null);
  reset(); assert.equal((await cloud.getPendingMealEvaluation()).analysisId,'m1');
  await cloud.saveConsumptionEvaluation('m1',{ 牛肉:25 },false);
  assert.equal(records.m1.consumption.percentages.牛肉,25); assert.equal(records.m1.evaluationStatus,'pending');
  await cloud.saveExcludedIngredients('m1',['牛肉']);
  assert.deepEqual(records.m1.consumption.percentages,{});
  await cloud.saveConsumptionEvaluation('m1',{ 土豆:100, 青椒:500 },true);
  assert.equal(await cloud.getPendingMealEvaluation(),null); assert.equal(records.m1.consumption.totalConsumedG,350);
  await assert.rejects(cloud.saveConsumptionEvaluation('m1',{},false),/已评估完成/);
  await cloud.saveExcludedIngredients('m1',['牛肉','土豆','青椒']);
  assert.equal(records.m1.consumption.totalConsumedG,0); assert.equal(records.m1.evaluationStatus,'completed');
});
test('失败记录不挡下一餐，写入失败不会解除待评状态', async () => {
  reset(meal({ status:'failed' })); assert.equal(await cloud.getPendingMealEvaluation(),null);
  reset(); failWrite=true;
  await assert.rejects(cloud.saveConsumptionEvaluation('m1',{ 牛肉:100, 土豆:100, 青椒:100 },true));
  failWrite=false; assert.equal(records.m1.evaluationStatus,'pending');
});
test('服务层阻止绕过首页直接创建下一餐；完成后新任务初始化待评字段', async () => {
  reset(); await assert.rejects(service.createMealAnalysis({ imageUrl:'',plateDiameterCm:26 }),/上一餐/);
  await cloud.saveConsumptionEvaluation('m1',{ 牛肉:0, 土豆:100, 青椒:100 },true);
  const created = await service.createMealAnalysis({ imageUrl:'',plateDiameterCm:26 });
  assert.equal(created.analysisId,'created'); assert.equal(records.created.evaluationStatus,'pending');
});
test('重新进入提示和取消均不会放行新识别', async () => {
  reset(); assert.equal(await checkPendingEvaluation(),false); assert.match(navigation[0],/evaluation.*m1/);
  wx.showModal = async () => ({ confirm:false });
  navigation=[]; assert.equal(await checkPendingEvaluation(),false); assert.equal(navigation.length,0);
  wx.showModal = async () => ({ confirm:true });
});
test('mock 持久化和云端实现具有一致的删除/完成行为', async () => {
  reset(); storage.meal_records_v3 = [meal()]; storage.meal_seeded_v3=true;
  assert.equal((await mock.getPendingMealEvaluation()).analysisId,'m1');
  await mock.saveConsumptionEvaluation('m1',{ 牛肉:500 },false);
  assert.equal((await mock.getMealAnalysisResult('m1')).consumption.totalConsumedG,500);
  await mock.saveExcludedIngredients('m1',['牛肉','土豆','青椒']);
  assert.equal(await mock.getPendingMealEvaluation(),null);
  assert.equal((await mock.getMealHistory())[0].totalG,0);
});
test('评估页不会把默认100%视作已填写，快速滑动按最后一次比例保存', async () => {
  reset(); const p=page(); await p.loadMeal(); assert.equal(p.data.remaining,3);
  p.setPercent('牛肉',25); p.setPercent('牛肉',500); p.setPercent('土豆',0); p.setPercent('青椒',100);
  await p.saveQueue; assert.equal(records.m1.consumption.percentages.牛肉,500); assert.equal(p.data.totalConsumedG,550);
  await p.completeEvaluation(); assert.equal(records.m1.evaluationStatus,'completed'); assert.match(navigation.at(-1),/index/);
});
test('断网后本地草稿优先恢复，不会被较晚写回的旧云端草稿覆盖', async () => {
  reset(); const p=page(); await p.loadMeal(); failWrite=true;
  // 模拟网络失败但本地存储正常。
  wx.setStorageSync=(k,v) => { storage[k]=clone(v); };
  p.setPercent('牛肉',500); await p.saveQueue;
  assert.equal(draft.getEvaluationDraft('m1').percentages.牛肉,500);
  records.m1.consumption={ percentages:{ 牛肉:25 }, consumedGrams:{ 牛肉:25 },totalConsumedG:25,updatedAt:Date.now()+1000 };
  failWrite=false; const reopened=page(); await reopened.loadMeal(); assert.equal(reopened.data.rows[0].percent,500);
  assert.equal(reopened.data.rows[0].confirmed,true);
});
test('老人端WXML不暴露估重依据、匹配出处或文件名', () => {
  for (const p of ['result','detail','evaluation']) {
    const wxml=fs.readFileSync(`${__dirname}/../miniprogram/pages/${p}/${p}.wxml`,'utf8');
    assert.doesNotMatch(wxml,/weightBasis|matchedDish|matchedIngredient|rd.source|ing.reason|cand.reason|数据出处|估重依据/);
    assert.match(wxml,/removeIngredient/);
  }
});
