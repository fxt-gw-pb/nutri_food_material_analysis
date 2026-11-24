const fs = require('node:fs');
const path = require('node:path');
const { csv, parseRecords } = require('./core.cjs');
const { buildFullTables } = require('./full.cjs');

const dishKey = (row) => JSON.stringify([row.record_id, row.dish_index]);
const ingredientKey = (row) => JSON.stringify([row.record_id, row.dish_index, row.ingredient_index]);
function group(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    const id = key(row);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  return grouped;
}

// 横向合并，质构测试及备选不再增加行，避免重复统计食材摄入量。
function buildSingleTable(tables) {
  const dishes = group(tables.dishes, (row) => row.record_id);
  const ingredients = group(tables.ingredients_full, dishKey);
  const readings = group(tables.texture_matches, ingredientKey);
  const candidates = group(tables.match_candidates, ingredientKey);
  const library = new Map(tables.texture_library.map((row) => [row.texture_record_id, row]));
  const rows = [];
  let ingredientCount = 0;
  let dishCount = 0;
  for (const record of tables.records) {
    let recordFirst = true;
    const recordDishes = dishes.get(record.record_id) || [];
    if (!recordDishes.length) {
      rows.push({ row_type: 'record_without_dish', record_first_row: 1, dish_first_row: 0, ...record });
      continue;
    }
    for (const dish of recordDishes) {
      dishCount++;
      const { cooking_method, consumption_source, issues, ...dishFields } = dish;
      const common = { ...record, ...dishFields, dish_cooking_method: cooking_method,
        dish_consumption_source: consumption_source, dish_issues: issues };
      const dishIngredients = ingredients.get(dishKey(dish)) || [];
      if (!dishIngredients.length) {
        rows.push({ row_type: 'dish_without_ingredient', record_first_row: Number(recordFirst), dish_first_row: 1, ...common });
        recordFirst = false;
        continue;
      }
      dishIngredients.forEach((ingredient, index) => {
        const key = ingredientKey(ingredient);
        const matchedReadings = readings.get(key) || [];
        const matchedCandidates = (candidates.get(key) || []).map((candidate) => ({
          ...candidate, reference_metrics: library.get(candidate.texture_record_id) || null,
        }));
        rows.push({ row_type: 'ingredient', record_first_row: Number(recordFirst), dish_first_row: Number(index === 0),
          ...common, ...ingredient,
          texture_matches_json: JSON.stringify(matchedReadings), match_candidates_json: JSON.stringify(matchedCandidates) });
        recordFirst = false;
        ingredientCount++;
      });
    }
  }
  if (ingredientCount !== tables.ingredients_full.length || dishCount !== tables.dishes.length) {
    throw Error('存在无法关联的菜品或食材，不生成不完整的单表');
  }
  // 主要分析列靠前，原始嵌套数据和备选明细放在右侧。
  const ordered = ['row_type', 'record_first_row', 'dish_first_row', ...tables.ingredients_full.flatMap(Object.keys),
    ...tables.dishes.flatMap(Object.keys), ...rows.flatMap(Object.keys)];
  const present = new Set(rows.flatMap(Object.keys));
  const fields = [...new Set(ordered)].filter((key) => present.has(key));
  const tail = (key) => key.startsWith('raw_') || key.endsWith('_json');
  fields.sort((a, b) => Number(tail(a)) - Number(tail(b)));
  return { rows, fields: fields.map((key) => ({ key })) };
}

function exportSingleFile(input, output) {
  const records = parseRecords(fs.readFileSync(input, 'utf8'));
  const full = buildFullTables(records);
  const single = buildSingleTable(full.tables);
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, csv(single.fields, single.rows), { flag: 'wx' });
  return { output: path.resolve(output), records: records.length, dishes: full.summary.dishes,
    ingredientRows: full.summary.ingredients, emptyRows: single.rows.length - full.summary.ingredients,
    totalRows: single.rows.length, columns: single.fields.length };
}
module.exports = { buildSingleTable, exportSingleFile };
