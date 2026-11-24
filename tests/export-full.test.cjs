const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildFullTables, loadAlgorithms, exportFullFile } = require('../scripts/export/full.cjs');
const { describe } = require('../scripts/export/full-fields.cjs');
const algorithms = loadAlgorithms();
const base = { _id: 'test-record', _openid: 'synthetic-only', participantCode: '001207', status: 'completed', createdAt: 1790481600000 };

test('完整导出保留旧版多道菜，并按dishId精确关联不同菜的摄入量', () => {
  const record = { ...base, result: { dishes: [
    { dishId: 'd1', dishName: '五香酱牛肉', cookingMethod: '卤', ingredients: [{ name: '牛肉', estimatedG: 200 }] },
    { dishId: 'd2', dishName: '土豆炖牛肉', cookingMethod: '炖', ingredients: [{ name: '牛肉', estimatedG: 80 }] },
  ] }, consumptions: [
    { dishId: 'd2', ratio: 0, consumedTotalG: 0, consumedIngredients: [{ name: '牛肉', consumedG: 0 }] },
    { dishId: 'd1', ratio: 0.5, consumedTotalG: 100, consumedIngredients: [{ name: '牛肉', consumedG: 100 }] },
  ] };
  const before = JSON.stringify(record);
  const { tables } = buildFullTables([record], algorithms);
  assert.equal(tables.records.length, 1);
  assert.equal(tables.dishes.length, 2);
  assert.deepEqual(tables.ingredients_full.map((v) => v.stored_consumed_g), [100, 0]);
  assert.deepEqual(tables.ingredients_full.map((v) => v.consumed_percent), [50, 0]);
  assert.equal(tables.ingredients_full[0].current_estimated_g, 100);
  assert.equal(tables.ingredients_full[0].model_estimated_g, 200);
  assert.equal(tables.ingredients_full[0].current_consumed_g, 50);
  assert.equal(tables.ingredients_full[0].snapshot_estimated_g, '');
  assert.equal(tables.ingredients_full[0].evaluation_complete, 0);
  assert.equal(JSON.stringify(record), before);
});

test('保留失败、作废和删除项，快照数值与本次补算独立，双模式宽表不增加食材行', () => {
  const records = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../examples/export/meal_records.json'), 'utf8'));
  records.push({ ...base, _id: 'failed', status: 'failed', result: { dish: null }, errorMessage: 'synthetic' });
  const { tables, summary } = buildFullTables(records, algorithms);
  assert.equal(summary.records, 6);
  assert.equal(tables.records.find((v) => v.record_id === 'failed').raw_errorMessage, 'synthetic');
  const beef = tables.ingredients_full.find((v) => v.record_id === 'demo-completed' && v.ingredient_name === '牛肉');
  assert.equal(beef.snapshot_estimated_g, 100);
  assert.equal(beef.stored_consumed_g, 50);
  assert.equal(beef.match_source, 'saved_snapshot');
  assert.equal(beef.cut_hardness_gf, 489.948);
  assert.equal(beef.compression_hardness_gf, 481.39);
  assert.equal(tables.ingredients_full.filter((v) => v.record_id === 'demo-completed').length, 2);
  const excluded = tables.ingredients_full.find((v) => v.ingredient_name === '香菜');
  assert.equal(excluded.excluded, 1);
  assert.equal(excluded.current_consumed_g, '');
  assert.equal(tables.ingredients_full.find((v) => v.record_id === 'demo-discarded').record_valid, 0);
});

test('不受页面10项上限影响，未匹配和缺失重量不会伪造为精确或零', () => {
  const names = ['鸡蛋', '土豆', '胡萝卜', '白菜', '牛肉', '猪肉', '青椒', '洋葱', '豆腐', '米饭', '西红柿', '完全未知的测试材料'];
  const record = { ...base, result: { dish: { dishName: '合成测试', ingredients: names.map((name) => ({ name })) } } };
  const { tables } = buildFullTables([record], algorithms);
  assert.equal(tables.ingredients_full.length, 12);
  const missing = tables.ingredients_full.at(-1);
  assert.equal(missing.current_estimated_g, '');
  assert.equal(missing.stored_consumed_g, '');
  assert.equal(missing.match_type, 'none');
  assert.equal(missing.needs_review, 1);
});

test('同dishId存在多个旧评估时不任意选择；新增列必须有中文释义', () => {
  const record = { ...base, result: { dishes: [{ dishId: 'd1', dishName: '米饭', ingredients: [{ name: '米饭' }] }] },
    consumptions: [{ dishId: 'd1', ratio: 1 }, { dishId: 'd1', ratio: 0 }] };
  const { tables } = buildFullTables([record], algorithms);
  assert.equal(tables.ingredients_full[0].consumed_percent, '');
  assert.equal(tables.dishes[0].issues, 'ambiguous_legacy_evaluation');
  for (const rows of Object.values(tables)) for (const key of new Set(rows.flatMap(Object.keys))) assert.ok(describe(key));
});

test('文件导出附带原始备份、算法哈希和712条质构库', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-full-export-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.resolve(__dirname, '../examples/export/meal_records.json');
  const result = exportFullFile(source, { out: temp });
  assert.equal(fs.readFileSync(path.join(result.output, 'raw/meal_records.json'), 'utf8'), fs.readFileSync(source, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(result.output, 'manifest.json')));
  assert.equal(manifest.summary.records, 5);
  assert.ok(manifest.sourceCodeSha256['miniprogram/services/textureMatch.ts']);
  assert.ok(fs.readFileSync(path.join(result.output, 'ingredients_full.csv'), 'utf8').startsWith('\uFEFF'));
  assert.equal(buildFullTables([], algorithms).tables.texture_library.length, 712);
});
