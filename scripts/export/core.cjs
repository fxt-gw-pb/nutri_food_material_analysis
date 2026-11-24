const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const columns = require('./fields.cjs');
const ROOT = path.resolve(__dirname, '../..');
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' ? v : '';
const numeric = (v) => typeof v === 'number' && Number.isFinite(v) ? v : '';
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function timestamp(value) {
  if (object(value)) return timestamp(value.$date ?? value.$numberLong);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{10,13}$/.test(value)) return Number(value);
  // 无时区的日期字符串不猜测本机时区。
  if (typeof value === 'string' && /(Z|[+-]\d{2}:?\d{2})$/.test(value)) return Date.parse(value);
  return NaN;
}
function iso(value) {
  const ms = timestamp(value);
  const local = new Date(ms + 8 * 3600000);
  if (!Number.isFinite(ms) || !Number.isFinite(local.getTime())) return '';
  return local.toISOString().replace('Z', '+08:00');
}
function day(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('日期必须为 YYYY-MM-DD');
  const ms = Date.parse(`${value}T00:00:00+08:00`);
  if (!Number.isFinite(ms) || iso(ms).slice(0, 10) !== value) throw Error(`无效日期：${value}`);
  return ms;
}
function validateOptions(options) {
  if (options.from) day(options.from);
  if (options.to) day(options.to);
  if (options.from && options.to && options.from > options.to) throw Error('--from 不能晚于 --to');
}

function parseRecords(content) {
  const source = content.replace(/^\uFEFF/, '').trim();
  if (!source) throw Error('输入文件为空；空集合请使用 []，避免把未完成下载当成成功');
  let parsed;
  try { parsed = JSON.parse(source); }
  catch {
    parsed = source.split(/\r?\n/).flatMap((line, index) => {
      if (!line.trim()) return [];
      try { return [JSON.parse(line)]; }
      catch { throw Error(`JSON 无法解析，请检查文件第 ${index + 1} 行；支持 JSON 数组或每行一条 JSON`); }
    });
  }
  const records = Array.isArray(parsed) ? parsed
    : object(parsed) && Array.isArray(parsed.data) ? parsed.data
      : object(parsed) && typeof parsed._id === 'string' ? [parsed] : null;
  if (!records) throw Error('未找到记录数组；请从 meal_records 导出完整 JSON');
  const ids = new Set();
  records.forEach((record, i) => {
    if (!object(record) || typeof record._id !== 'string' || !record._id.trim()) {
      throw Error(`第 ${i + 1} 条记录缺少字符串 _id，请导出全部字段`);
    }
    if (ids.has(record._id)) throw Error(`第 ${i + 1} 条记录的 _id 重复；请勿混合重复备份`);
    ids.add(record._id);
    if (record.participantCode != null && typeof record.participantCode !== 'string') {
      throw Error(`第 ${i + 1} 条记录的参与者编码不是文本，无法保证前导零，请核对原始数据`);
    }
    if (typeof record.status !== 'string') throw Error(`第 ${i + 1} 条记录缺少 status，请导出全部字段`);
    for (const [name, value] of [['result', record.result], ['auditSnapshot', record.auditSnapshot], ['consumption', record.consumption]]) {
      if (value != null && !object(value)) throw Error(`第 ${i + 1} 条记录的 ${name} 不是对象`);
    }
    const dish = record.result?.dish ?? record.result?.dishes?.[0];
    if (dish != null && (!object(dish) || !Array.isArray(dish.ingredients))) {
      throw Error(`第 ${i + 1} 条记录的菜品结果缺少食材数组，请导出完整数据`);
    }
    for (const value of [record.consumption?.percentages, record.consumption?.consumedGrams, record.selectedRecords]) {
      if (value != null && !object(value)) throw Error(`第 ${i + 1} 条记录的食用评估或改选映射格式错误`);
    }
    if (record.excludedIngredients != null && (!Array.isArray(record.excludedIngredients) || record.excludedIngredients.some((v) => typeof v !== 'string'))) {
      throw Error(`第 ${i + 1} 条记录的排除食材格式错误`);
    }
    for (const [name, items] of [['食材', dish?.ingredients], ['快照食材', record.auditSnapshot?.ingredients]]) {
      if (items === undefined) continue;
      if (!Array.isArray(items)) throw Error(`第 ${i + 1} 条记录的${name}不是数组`);
      const names = new Set();
      for (const item of items) {
        if (!object(item) || typeof item.name !== 'string' || !item.name.trim() || names.has(item.name)) {
          throw Error(`第 ${i + 1} 条记录的${name}名称缺失或重复，不能可靠关联食用比例`);
        }
        names.add(item.name);
      }
    }
  });
  return records;
}

function loadTextureLibrary() {
  const filename = path.join(ROOT, 'miniprogram/data/textureDb.data.ts');
  const source = fs.readFileSync(filename, 'utf8');
  // 只编译仓库内的静态实测库；输入 JSON 绝不作为代码执行。
  const ts = require('typescript');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const sandbox = { exports: {} };
  vm.runInNewContext(code, sandbox, { filename, timeout: 5000 });
  const { TEXTURE_ROWS, TEXTURE_TEST_MODES } = sandbox.exports;
  const metricKeys = ['height_mm', 'hardness_gf', 'fracturability_gf', 'adhesiveness_gf_sec', 'springiness', 'chewiness_gf', 'gumminess_gf', 'cohesiveness', 'resilience'];
  const records = TEXTURE_ROWS.map((row, i) => ({
    id: `t${i}`, dish: row[1], ingredient: row[2], mode: TEXTURE_TEST_MODES[row[5]], source: row[15],
    metrics: Object.fromEntries(metricKeys.map((key, j) => [key, numeric(row[j + 6])])),
  }));
  return { records, sha256: sha256(source) };
}

function buildTables(records, options = {}, library = { records: [] }) {
  validateOptions(options);
  const tables = { meals: [], ingredients: [], textures: [] };
  const summary = { inputRecords: records.length, exportedRecords: 0, skippedStatus: 0, skippedEvaluation: 0,
    skippedParticipant: 0, skippedDate: 0, skippedInvalidDate: 0, excludedIngredients: 0, issueCounts: {} };
  for (const record of records) {
    const discarded = record.status === 'discarded' || record.evaluationStatus === 'discarded' || record.discardedAt != null;
    if (!options.allRecords && (record.status !== 'completed' || discarded)) { summary.skippedStatus++; continue; }
    if (options.completedOnly && record.evaluationStatus !== 'completed') { summary.skippedEvaluation++; continue; }
    if (options.participant !== undefined && record.participantCode !== options.participant) { summary.skippedParticipant++; continue; }
    const created = timestamp(record.createdAt);
    if ((options.from || options.to) && !iso(record.createdAt)) { summary.skippedInvalidDate++; continue; }
    if ((options.from && created < day(options.from)) || (options.to && created >= day(options.to) + 86400000)) {
      summary.skippedDate++; continue;
    }
    const issues = new Set();
    const mark = (code, ingredientIssues) => { issues.add(code); ingredientIssues?.add(code); };
    if (!record.participantCode) mark('missing_participant_code');
    if (!iso(record.createdAt)) mark('missing_or_invalid_created_at');
    if (!record.evaluationStatus) mark('legacy_evaluation_unknown');
    if (record.result?.dishes?.length > 1) mark('legacy_multiple_dishes_first_only');
    const dish = record.result?.dish ?? record.result?.dishes?.[0];
    const snapshot = record.auditSnapshot;
    const hasSnapshot = Array.isArray(snapshot?.ingredients);
    if (!hasSnapshot) mark('missing_snapshot');
    if (record.status === 'completed' && !dish) mark('missing_dish');
    const raw = new Map((dish?.ingredients || []).map((item) => [item.name, item]));
    const snaps = new Map((snapshot?.ingredients || []).map((item) => [item.name, item]));
    const consumption = record.consumption || {};
    const percentages = object(consumption.percentages) ? consumption.percentages : {};
    const consumed = object(consumption.consumedGrams) ? consumption.consumedGrams : {};
    const names = [...new Set([...raw.keys(), ...snaps.keys(), ...Object.keys(percentages), ...Object.keys(consumed)])];
    const excluded = new Set(Array.isArray(record.excludedIngredients) ? record.excludedIngredients : []);
    const common = {
      record_id: record._id, participant_code: text(record.participantCode), meal_session_id: text(record.mealSessionId),
      created_at: iso(record.createdAt), status: record.status, evaluation_status: text(record.evaluationStatus),
    };
    const ingredientRows = [];
    let excludedCount = 0;
    for (const [index, name] of names.entries()) {
      const original = raw.get(name) || {};
      const snap = snaps.get(name);
      const isExcluded = excluded.has(name) || snap?.excluded === true;
      if (isExcluded) { excludedCount++; summary.excludedIngredients++; }
      if (isExcluded && !options.includeExcluded) continue;
      const ingredientIssues = new Set();
      if (!snap) mark('missing_ingredient_snapshot', ingredientIssues);
      if (!raw.has(name) && !snap) mark('orphan_consumption', ingredientIssues);
      const number = (value, code, max = Infinity) => {
        if (value == null) return '';
        if (numeric(value) === '' || value < 0 || value > max) { mark(code, ingredientIssues); return ''; }
        return value;
      };
      const grams = number(snap?.grams, 'invalid_estimated_g');
      const percent = number(percentages[name], 'invalid_consumed_percent', 500);
      const consumedG = number(consumed[name], 'invalid_consumed_g');
      if (record.evaluationStatus === 'completed' && !isExcluded && (percent === '' || consumedG === '')) {
        mark('completed_evaluation_missing_values', ingredientIssues);
      }
      if (grams !== '' && percent !== '' && consumedG !== '' && Math.abs(Math.round(grams * percent) / 100 - consumedG) > 0.011) {
        mark('consumption_weight_mismatch', ingredientIssues);
      }
      const calibration = record.modelAudit?.quantityCalibration;
      const modelOriginal = calibration ? record.modelAudit?.rawDish?.ingredients?.find(i => i.name === name) : original;
      if (calibration && !modelOriginal) mark('calibration_raw_prediction_missing', ingredientIssues);
      const row = {
        ...common, ingredient_index: index + 1, dish_name: text(dish?.dishName), ingredient_name: name,
        cooking_method: text(original.cookingMethod || dish?.cookingMethod), excluded: Number(isExcluded),
        evaluation_complete: Number(record.evaluationStatus === 'completed' && !discarded && record.status === 'completed'),
        estimated_g: grams, weight_range: text(snap?.weightRange), weight_confidence: text(snap?.weightConfidence),
        weight_basis: text(snap?.weightBasis), consumed_percent: percent, consumed_g: consumedG,
        area_ratio: numeric(modelOriginal?.areaRatio), height_cm: numeric(modelOriginal?.heightCm), model_estimated_g: numeric(modelOriginal?.estimatedG),
        effective_area_ratio: numeric(original.areaRatio), effective_height_cm: numeric(original.heightCm), effective_estimated_g: numeric(original.estimatedG),
        quantity_calibration_version: text(calibration?.version), quantity_calibration_factor: numeric(calibration?.factor),
        calibration_reference_type: text(calibration?.referenceType),
        selected_record_id: text(record.selectedRecords?.[name]), matched_record_id: text(snap?.recordId),
        matched_dish: text(snap?.matchedDish), matched_ingredient: text(snap?.matchedIngredient),
        matched_cooking: text(snap?.matchedCookingText), match_reason: text(snap?.matchReason),
        snapshot_available: Number(!!snap), algorithm_version: text(snapshot?.algorithmVersion),
      };
      if (row.selected_record_id && snap && row.selected_record_id !== row.matched_record_id) mark('selection_snapshot_mismatch', ingredientIssues);
      // 用快照的来源、测试模式、菜名、食材名四项精确关联，不使用当前算法重新匹配。
      const sources = Array.isArray(snap?.sources) ? snap.sources : [];
      if (snap?.recordId && sources.length === 0) mark('missing_texture_sources', ingredientIssues);
      const seen = new Set();
      for (const source of sources) {
        if (!object(source) || !text(source.source) || !text(source.testMode)) { mark('invalid_texture_source', ingredientIssues); continue; }
        const key = JSON.stringify([source.source, source.testMode]);
        if (seen.has(key)) continue;
        seen.add(key);
        const matches = library.records.filter((r) => r.dish === snap.matchedDish && r.ingredient === snap.matchedIngredient && r.mode === source.testMode && r.source === source.source);
        const match = matches.length === 1 ? matches[0] : undefined;
        if (!match) mark('texture_source_not_unique_or_missing', ingredientIssues);
        tables.textures.push({
          record_id: record._id, participant_code: common.participant_code, ingredient_index: index + 1,
          ingredient_name: name, test_mode: source.testMode, source: source.source,
          texture_record_id: match?.id || '', matched_dish: text(snap.matchedDish), matched_ingredient: text(snap.matchedIngredient),
          value_source: match ? 'bundled_library' : 'missing', ...match?.metrics,
        });
      }
      row.issues = [...ingredientIssues].join(';');
      ingredientRows.push(row);
    }
    const activeRows = ingredientRows.filter((r) => !r.excluded);
    if (record.evaluationStatus === 'completed' && numeric(consumption.totalConsumedG) !== '' && activeRows.every((r) => r.consumed_g !== '')) {
      if (Math.abs(activeRows.reduce((sum, r) => sum + r.consumed_g, 0) - consumption.totalConsumedG) > 0.011) mark('consumption_total_mismatch');
    }
    tables.ingredients.push(...ingredientRows);
    tables.meals.push({
      ...common, updated_at: iso(record.updatedAt), dish_name: text(dish?.dishName), cooking_method: text(dish?.cookingMethod),
      meal_type: text(record.mealType), recognition_confidence: text(dish?.recognitionConfidence),
      plate_diameter_cm: numeric(record.plateDiameterCm ?? snapshot?.plateDiameterCm), image_file_id: text(record.imageFileId),
      meal_session_finished_at: iso(record.mealSessionFinishedAt), discarded_at: iso(record.discardedAt),
      model_name: text(record.modelName), prompt_version: text(record.promptVersion), snapshot_available: Number(hasSnapshot),
      algorithm_version: text(snapshot?.algorithmVersion), snapshot_at: iso(snapshot?.generatedAt),
      estimated_total_g: numeric(snapshot?.totalG), consumed_total_g: numeric(consumption.totalConsumedG),
      evaluation_completed_at: iso(consumption.completedAt), ingredient_count: ingredientRows.length,
      excluded_ingredient_count: excludedCount, issues: [...issues].join(';'),
    });
    for (const code of issues) summary.issueCounts[code] = (summary.issueCounts[code] || 0) + 1;
  }
  summary.exportedRecords = tables.meals.length;
  summary.ingredientRows = tables.ingredients.length;
  summary.textureRows = tables.textures.length;
  return { tables, summary };
}

function csvCell(value) {
  if (value == null) return '""';
  let output = String(value);
  // 文本防止 Excel 当公式执行；真实负数指标仍是数值，不能被改成文本。
  if (typeof value === 'string' && (/^\s*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value))) output = `'${value}`;
  return `"${output.replace(/"/g, '""')}"`;
}
function csv(fields, rows) {
  return '\uFEFF' + [fields.map((f) => f.key), ...rows.map((row) => fields.map((f) => row[f.key]))]
    .map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function createRunDirectory(parent) {
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, new Date().toISOString().replace(/[:.]/g, '-') + '-'));
}
function exportFile(input, options = {}, targetDirectory) {
  const buffer = fs.readFileSync(input);
  const records = parseRecords(buffer.toString('utf8'));
  const library = loadTextureLibrary();
  const { tables, summary } = buildTables(records, options, library);
  const output = targetDirectory || createRunDirectory(path.resolve(options.out || path.join(ROOT, 'exports/runs')));
  // 不覆盖已有文件，即使调用方给出了旧目录。
  for (const [name, rows] of Object.entries(tables)) fs.writeFileSync(path.join(output, `${name}.csv`), csv(columns[name], rows), { flag: 'wx' });
  const dictionary = Object.entries(columns).flatMap(([table, fields]) => fields.map((field) => ({ table: `${table}.csv`, ...field })));
  fs.writeFileSync(path.join(output, 'fields.csv'), csv(['table', 'key', 'label', 'unit'].map((key) => ({ key })), dictionary), { flag: 'wx' });
  const manifest = {
    schemaVersion: 1, exportedAt: new Date().toISOString(), timezone: 'UTC+08:00',
    inputFile: path.basename(input), inputSha256: sha256(buffer), textureLibrarySha256: library.sha256,
    options: { allRecords: false, includeExcluded: false, completedOnly: false, ...options, out: undefined }, summary,
  };
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { output, summary };
}
module.exports = { ROOT, parseRecords, loadTextureLibrary, buildTables, csv, iso, day, validateOptions, exportFile, createRunDirectory };
