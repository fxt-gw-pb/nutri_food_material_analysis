const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);

const intake = require('../miniprogram/utils/intake.ts');
const { matchNutrition } = require('../miniprogram/services/nutritionMatch.ts');
const { allRecords } = require('../miniprogram/data/textureDb.ts');
const { alternateTestModes } = require('../miniprogram/services/textureMatch.ts');
const { buildConsumption } = require('../miniprogram/utils/evaluation.ts');

const cut = (metrics) => ({ id: 'x', testMode: '切割测试', metrics: {
  heightMm: null, hardness: null, fracturability: null, adhesiveness: null, springiness: null,
  chewiness: null, gumminess: null, cohesiveness: null, resilience: null, ...metrics } });
const item = (name, consumedG, metrics, nutrients = {}) => ({
  analysisId: 'a', dishName: 'd', name, consumedG, cut: metrics ? cut(metrics) : null,
  nutritionCode: Object.keys(nutrients).length ? 'c' : '', nutritionName: '', nutritionReason: '', nutrients,
});

test('质量加权切割硬度与 1124 说明中的午餐算例一致', () => {
  const s = intake.summarizeIntake([
    item('米饭', 150, { hardness: 500 }), item('青菜', 100, { hardness: 1200 }), item('鸡肉', 200, { hardness: 2000 }),
  ]);
  assert.equal(Math.round(s.hardness.value * 100) / 100, 1322.22);
  assert.equal(s.hardness.grams, 450);
  assert.equal(s.consumedG, 450);
});

test('缺失值不当作 0，分母也排除其质量；每项指标各自计算分母', () => {
  const s = intake.summarizeIntake([
    item('米饭', 150, { hardness: 500, chewiness: 10 }),
    item('青菜', 100, { hardness: null, chewiness: 30 }),
    item('汤汁', 80, null),
    item('没吃', 0, { hardness: 99999 }),
  ]);
  assert.equal(s.hardness.value, 500);
  assert.equal(s.hardness.grams, 150);
  const chew = s.texture.find((t) => t.key === 'chewiness');
  assert.equal(chew.value, (150 * 10 + 100 * 30) / 250);
  assert.deepEqual(s.noTexture, ['青菜', '汤汁']);
  assert.equal(s.consumedG, 330);
});

test('只用切割测试读数：下压记录取同菜同食材的切割那条，没有切割数据就不计入', () => {
  const press = allRecords().filter((r) => r.testMode === '下压测试');
  const withCut = press.find((r) => alternateTestModes(r.id).some((a) => a.testMode === '切割测试'));
  const pressOnly = press.find((r) => !alternateTestModes(r.id).some((a) => a.testMode === '切割测试'));
  assert.ok(withCut && pressOnly);
  const c = intake.cutRecordOf(withCut.id);
  assert.equal(c.testMode, '切割测试');
  assert.equal(c.dish, withCut.dish);
  assert.equal(intake.cutRecordOf(pressOnly.id), null);
  const cutRec = allRecords().find((r) => r.testMode === '切割测试');
  assert.equal(intake.cutRecordOf(cutRec.id).id, cutRec.id);
});

test('按北京时间自然日分日，与手机时区无关', () => {
  const midnight = Date.UTC(2026, 10, 23, 16, 0, 0); // 北京时间 11-24 00:00
  assert.equal(intake.chinaDateKey(midnight), '2026-11-24');
  assert.equal(intake.chinaDateKey(midnight - 1), '2026-11-23');
  assert.deepEqual(intake.chinaDayRange('2026-11-24'), { start: midnight, end: midnight + 86400000 });
  assert.equal(intake.chinaDayRange('2026-02-30'), null);
  assert.equal(intake.shiftDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(intake.weekdayOf('2026-11-24'), '周二');
});

const day = Date.UTC(2026, 10, 23, 16, 0, 0);
const meal = (id, mealType, hours, ingredients, grams, evaluated = true) => ({
  analysisId: id, participantCode: '007', status: 'completed', mealType, createdAt: day + hours * 3600000, updatedAt: 0,
  imageUrl: '', plateDiameterCm: 26, selectedRecords: {}, excludedIngredients: [],
  dish: { dishName: id, cookingMethod: '炒', recognitionConfidence: 'high', ingredients: ingredients.map((name) => ({ name })) },
  evaluationStatus: evaluated ? 'completed' : 'pending',
  consumption: evaluated ? { percentages: {}, consumedGrams: grams, totalConsumedG: 0, updatedAt: 0 } : undefined,
});

test('全天把所有餐次的食物合在一起重新加权，不是各餐结果的平均；未评估的菜不计入', () => {
  const meals = [
    meal('午餐菜', 'lunch', 4, ['米饭', '馒头'], { 米饭: 150, 馒头: 150 }),
    meal('晚餐菜', 'dinner', 10, ['鸡蛋'], { 鸡蛋: 50 }),
    meal('待评估', 'dinner', 11, ['鸡蛋'], {}, false),
    meal('昨天', 'dinner', -2, ['鸡蛋'], { 鸡蛋: 999 }),
  ];
  const d = intake.buildDailyIntake('2026-11-24', meals);
  assert.deepEqual(d.meals.map((m) => m.label), ['午餐', '晚餐']);
  assert.equal(d.evaluatedCount, 2);
  assert.equal(d.pendingCount, 1);
  assert.equal(d.day.consumedG, 350);
  const lunch = d.meals[0].summary.hardness;
  const dinner = d.meals[1].summary.hardness;
  assert.ok(lunch.value !== null && dinner.value !== null);
  const expected = (lunch.value * lunch.grams + dinner.value * dinner.grams) / (lunch.grams + dinner.grams);
  assert.ok(Math.abs(d.day.hardness.value - expected) < 1e-9);
  assert.notEqual(Math.round(d.day.hardness.value), Math.round((lunch.value + dinner.value) / 2));
  // 米饭在质构库里没有实测记录：计入摄入和营养，但不进入硬度的分母
  assert.equal(lunch.grams, 150);
  assert.deepEqual(d.day.noTexture, ['米饭']);
  const egg = matchNutrition('鸡蛋').food;
  const rice = matchNutrition('米饭').food;
  const bun = matchNutrition('馒头').food;
  const energy = 150 * rice.per100g.energyKcal / 100 + 150 * bun.per100g.energyKcal / 100 + 50 * egg.per100g.energyKcal / 100;
  assert.equal(d.day.energyKcal, Math.round(energy * 10) / 10);
});

test('常用食材对上成分表：熟主食、刀工后缀、带骨折可食部、干品折干重、调料和成品不硬凑', () => {
  const code = (n) => (matchNutrition(n).food || {}).code;
  assert.equal(code('米饭'), '012401x');
  assert.equal(code('面条'), '011317');
  assert.equal(code('青椒丝'), '043124');
  assert.equal(code('带皮五花肉块'), '081108');
  assert.equal(code('土豆'), '021101');
  assert.equal(code('鸡蛋'), '111101x');
  assert.equal(code('猪瘦肉片'), '081110x');
  assert.equal(code('黑鱼肉（净肉）'), '121116');
  assert.equal(code('鲜蚕豆'), '042102');
  const ribs = matchNutrition('排骨');
  assert.equal(ribs.food.code, '081131');
  assert.equal(ribs.factor, ribs.food.edible / 100);
  assert.match(ribs.reason, /可食部/);
  assert.equal(matchNutrition('鸡腿肉块').factor, 1);
  assert.equal(matchNutrition('粉丝').factor, 0.3);
  for (const n of ['酱汁', '汤汁', '水', '橄榄菜', '南瓜饼', '韭菜猪肉水饺', '螺肉片']) {
    assert.equal(matchNutrition(n).food, null, n);
  }
});

test('营养按摄入质量 × 折算系数 × 每 100 g 含量计算，缺测项不当作 0', () => {
  const m = meal('番茄炒蛋', 'lunch', 4, ['鸡蛋', '番茄'], { 鸡蛋: 50, 番茄: 100 });
  const items = intake.dishIntakeItems(m);
  const egg = items.find((i) => i.name === '鸡蛋');
  assert.equal(egg.nutritionCode, '111101x');
  assert.equal(egg.nutrients.energyKcal, 50 * 139 / 100);
  const tomato = items.find((i) => i.name === '番茄');
  assert.equal(tomato.nutrients.fiber, undefined);
  const s = intake.summarizeIntake(items);
  assert.equal(s.nutrients.find((n) => n.key === 'fiber').incomplete, true);
  assert.equal(s.nutritionG, 150);
});

test('完成评估时把可直接相加的摄入汇总写进记录，未完成时不写', () => {
  const m = meal('番茄炒蛋', 'lunch', 4, ['鸡蛋', '番茄'], {});
  const done = buildConsumption(m, { 鸡蛋: 100, 番茄: 50 }, true);
  assert.equal(done.intake.algorithmVersion, intake.INTAKE_ALGORITHM_VERSION);
  assert.equal(done.intake.consumedG, done.totalConsumedG);
  const items = intake.dishIntakeItems(m, done.consumedGrams);
  const s = intake.summarizeIntake(items);
  const h = done.intake.textureSums.hardness;
  if (s.hardness.value !== null) assert.ok(Math.abs(h.weightedSum / h.grams - s.hardness.value) < 0.01);
  assert.equal(done.intake.ingredients.length, 2);
  assert.equal(buildConsumption(m, { 鸡蛋: 100 }, false).intake, undefined);
});
