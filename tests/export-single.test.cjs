const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFullTables, loadAlgorithms } = require('../scripts/export/full.cjs');
const { buildSingleTable } = require('../scripts/export/single.cjs');
const algorithms = loadAlgorithms();

test('单表保留所有记录、所有菜和所有食材，质构及备选不会扩增食材行', () => {
  const records = [
    { _id: 'failed', status: 'failed', errorMessage: '失败,带引号"', result: { dish: null } },
    { _id: 'multi', status: 'completed', participantCode: '001207', result: { dishes: [
      { dishId: 'd1', dishName: '五香酱牛肉', cookingMethod: '卤', ingredients: [{ name: '牛肉', estimatedG: 100 }] },
      { dishId: 'd2', dishName: '鸡蛋', cookingMethod: '煮', ingredients: [{ name: '鸡蛋', cookingMethod: '炒', estimatedG: 50 }] },
      { dishId: 'd3', dishName: '空菜', ingredients: [] },
    ] }, consumptions: [{ dishId: 'd2', ratio: 0, consumedTotalG: 0, consumedIngredients: [{ name: '鸡蛋', consumedG: 0 }] }] },
  ];
  const tables = buildFullTables(records, algorithms).tables;
  const { rows } = buildSingleTable(tables);
  assert.equal(rows.length, 4);
  assert.equal(rows.reduce((sum, r) => sum + r.record_first_row, 0), 2);
  assert.equal(rows.reduce((sum, r) => sum + r.dish_first_row, 0), 3);
  assert.equal(rows[0].row_type, 'record_without_dish');
  assert.equal(rows[0].raw_errorMessage, '失败,带引号"');
  assert.equal(rows[1].participant_code, '001207');
  assert.equal(rows[2].stored_consumed_g, 0);
  assert.equal(rows[2].dish_cooking_method, '煮');
  assert.equal(rows[2].cooking_method, '炒');
  assert.equal(rows[3].row_type, 'dish_without_ingredient');
  assert.deepEqual(JSON.parse(rows[1].raw_result), records[1].result);
  const readings = rows.flatMap((row) => JSON.parse(row.texture_matches_json || '[]'));
  assert.equal(readings.length, tables.texture_matches.length);
  const candidates = JSON.parse(rows[1].match_candidates_json);
  assert.ok(candidates.length);
  assert.ok(Object.hasOwn(candidates[0].reference_metrics, 'hardness_gf'));
});

test('不静默丢弃没有对应菜品的食材', () => {
  assert.throws(() => buildSingleTable({ records: [], dishes: [], ingredients_full: [{ record_id: 'orphan' }],
    texture_matches: [], match_candidates: [], texture_library: [] }), /无法关联/);
});
