const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);

const { matchMeal, searchRecords } = require('../miniprogram/services/textureMatch.ts');
const { findRecordById } = require('../miniprogram/data/textureDb.ts');
const { resolveMeal } = require('../miniprogram/utils/texture.ts');
const { buildFullTables } = require('../scripts/export/full.cjs');

function match(dishName, name, cookingMethod) {
  return matchMeal({ dishName, cookingMethod, ingredients: [{ name, cookingMethod }] }).ingredients[0];
}

test('成型主食按菜名找质构，面粉不落到粉丝', () => {
  const result = match('馒头', '面粉', '蒸');
  const record = findRecordById(result.recordId);
  assert.equal(record.dish, '南瓜馒头');
  assert.equal(record.ingredient, '南瓜馒头');
  assert.equal(result.matchType, 'similar');
  assert.match(result.reason, /配方可能不同/);
  assert.ok(result.candidates.every((candidate) => candidate.ingredient !== '粉丝'));
  const view = resolveMeal({ dishName: '馒头', cookingMethod: '蒸', recognitionConfidence: 'high', weightConfidence: 'medium',
    ingredients: [{ name: '面粉', cookingMethod: '蒸', areaRatio: 0.2, heightCm: 2, estimatedG: 60 }] }, {}, 25.4);
  assert.match(view.ingredients[0].reviewNote, /配方可能不同/);

  // 菜名没有提示是成型主食时，不能仅凭一个「粉」字配上粉丝。
  assert.notEqual(findRecordById(match('未知菜', '面粉', '蒸').recordId)?.ingredient, '粉丝');
});

test('花生米和花生仁指向花生仁实测值，不选花生芽', () => {
  for (const name of ['花生米', '花生仁']) {
    const result = match('凉拌莲藕', name, '炒');
    assert.equal(findRecordById(result.recordId).ingredient, '新鲜花生仁');
    assert.ok(result.candidates.every((candidate) => !/^花生[芽苗]$/.test(candidate.ingredient)));
  }
  assert.ok(searchRecords('花生米').every((candidate) => !/^花生[芽苗]$/.test(candidate.ingredient)));
  const view = resolveMeal({ dishName: '凉拌莲藕', cookingMethod: '凉拌', recognitionConfidence: 'high', weightConfidence: 'medium',
    ingredients: [{ name: '花生米', cookingMethod: '炒', areaRatio: 0.04, heightCm: 0.2, estimatedG: 8 }] }, {}, 25.4);
  assert.match(view.ingredients[0].reviewNote, /做法不同/);
});

test('四季豆段等原有正确自动匹配继续可用', () => {
  assert.equal(findRecordById(match('炒四季豆', '四季豆段', '炒').recordId).ingredient, '四季豆');
  assert.equal(findRecordById(match('韭菜煎蛋', '鸡蛋', '煎').recordId).dish, '韭菜摊鸡蛋');
  assert.equal(match('卤鸭舌', '鸭舌', '卤').matchType, 'none');
});

test('历史人工改选保留，但跨食材改选显示复核提醒且不称为精确匹配', () => {
  const dish = { dishName: '炒四季豆', cookingMethod: '炒', recognitionConfidence: 'high', weightConfidence: 'medium',
    ingredients: [{ name: '四季豆段', cookingMethod: '炒', areaRatio: 0.35, heightCm: 1.2, estimatedG: 80 }] };
  const selected = resolveMeal(dish, { 四季豆段: 't319' }, 25.4).ingredients[0];
  assert.equal(selected.recordId, 't319');
  assert.equal(selected.matchType, 'similar');
  assert.match(selected.reviewNote, /可能不是同一种食材/);
  const automatic = resolveMeal(dish, {}, 25.4).ingredients[0];
  assert.equal(automatic.matchedIngredient, '四季豆');
  assert.equal(automatic.reviewNote, '');
});

test('导出把食材相同但做法不同的参考值列为待复核', () => {
  const record = { _id: 'synthetic-peanut', participantCode: 'TEST', status: 'completed', createdAt: 1790573961614,
    result: { dish: { dishName: '凉拌莲藕', cookingMethod: '凉拌', ingredients: [
      { name: '花生米', cookingMethod: '炒', areaRatio: 0.04, heightCm: 0.2, estimatedG: 8 },
    ] } } };
  const row = buildFullTables([record]).tables.ingredients_full[0];
  assert.equal(row.matched_ingredient, '新鲜花生仁');
  assert.equal(row.match_type, 'exact');
  assert.equal(row.needs_review, 1);
  assert.match(row.issues, /texture_cooking_method_differs/);
});
