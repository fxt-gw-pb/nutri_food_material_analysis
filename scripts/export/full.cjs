// 完整研究导出：保留原始字段、多道菜、旧版评估，并补充当前算法的质构匹配。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { ROOT, parseRecords, iso, csv, createRunDirectory } = require('./core.cjs');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : '';
const text = (value) => typeof value === 'string' ? value : '';
const json = (value) => value == null ? '' : JSON.stringify(value);
const metricKeys = {
  height_mm: 'heightMm', hardness_gf: 'hardness', fracturability_gf: 'fracturability',
  adhesiveness_gf_sec: 'adhesiveness', springiness: 'springiness', chewiness_gf: 'chewiness',
  gumminess_gf: 'gumminess', cohesiveness: 'cohesiveness', resilience: 'resilience',
};

function loadAlgorithms() {
  const ts = require('typescript');
  const cache = new Map();
  const hashes = {};
  function load(filename) {
    const absolute = path.resolve(filename);
    if (!absolute.startsWith(path.join(ROOT, 'miniprogram') + path.sep)) throw Error('只允许加载项目内的本地算法');
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const source = fs.readFileSync(absolute, 'utf8');
    hashes[path.relative(ROOT, absolute)] = hash(source);
    const module = { exports: {} };
    cache.set(absolute, module);
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const run = vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename: absolute });
    run((name) => {
      if (!name.startsWith('.')) throw Error('导出算法不允许访问外部模块');
      return load(path.resolve(path.dirname(absolute), name.endsWith('.ts') ? name : `${name}.ts`));
    }, module, module.exports);
    return module.exports;
  }
  return {
    match: load(path.join(ROOT, 'miniprogram/services/textureMatch.ts')),
    texture: load(path.join(ROOT, 'miniprogram/data/textureDb.ts')),
    weight: load(path.join(ROOT, 'miniprogram/utils/weight.ts')),
    hashes,
  };
}

function libraryRow(record) {
  return {
    texture_record_id: record.id, category: record.category, matched_dish: record.dish,
    matched_ingredient: record.ingredient, test_mode: record.testMode, cooking_method: record.method,
    cooking_minutes: record.minutes, source: record.source,
    ...Object.fromEntries(Object.entries(metricKeys).map(([key, metric]) => [key, number(record.metrics[metric])])),
  };
}

function buildFullTables(records, algorithms = loadAlgorithms()) {
  const library = algorithms.texture.allRecords();
  const tables = { records: [], dishes: [], ingredients_full: [], texture_matches: [], match_candidates: [], texture_library: library.map(libraryRow) };
  const summary = { records: records.length, statuses: {}, dishes: 0, ingredients: 0, matchedIngredients: 0, unmatchedIngredients: 0, needsReview: 0, matchSources: {}, issues: {} };
  for (const record of records) {
    summary.statuses[record.status] = (summary.statuses[record.status] || 0) + 1;
    const userKey = record._openid ? hash(record._openid).slice(0, 20) : '';
    const recordCommon = { record_id: record._id, participant_code: text(record.participantCode), user_key: userKey,
      meal_session_id: text(record.mealSessionId), created_at: iso(record.createdAt), status: record.status,
      evaluation_status: text(record.evaluationStatus), image_file_id: text(record.imageFileId) };
    const dishes = record.result?.dish ? [record.result.dish] : record.result?.dishes || [];
    tables.records.push({ ...Object.fromEntries(Object.entries(record).map(([key, value]) => [`raw_${key}`, typeof value === 'object' ? json(value) : value])),
      ...recordCommon, updated_at: iso(record.updatedAt), dish_count: dishes.length, snapshot_available: Number(!!record.auditSnapshot) });
    dishes.forEach((dish, dishOffset) => {
      const dishIndex = dishOffset + 1;
      const dishId = text(dish.dishId);
      // 旧版评估用dishId关联；只有单菜且无ID时才允许无歧义的单条回退。
      const oldEvaluations = Array.isArray(record.consumptions) ? record.consumptions : [];
      const matchingEvaluations = dishId ? oldEvaluations.filter((v) => v.dishId === dishId)
        : dishes.length === 1 && oldEvaluations.length === 1 ? oldEvaluations : [];
      const oldEvaluation = matchingEvaluations.length === 1 ? matchingEvaluations[0] : undefined;
      const snapshot = dishes.length === 1 ? record.auditSnapshot : undefined;
      const consumption = dishes.length === 1 ? record.consumption : undefined;
      const common = { ...recordCommon, dish_index: dishIndex, dish_id: dishId, dish_name: text(dish.dishName) };
      tables.dishes.push({ ...common, cooking_method: text(dish.cookingMethod), recognition_confidence: text(dish.recognitionConfidence),
        model_estimated_total_g: number(dish.estimatedTotalG), model_min_total_g: number(dish.minTotalG), model_max_total_g: number(dish.maxTotalG),
        snapshot_estimated_total_g: number(snapshot?.totalG), stored_consumed_total_g: number(consumption?.totalConsumedG ?? oldEvaluation?.consumedTotalG),
        consumption_source: consumption ? 'saved_ingredient_evaluation' : oldEvaluation ? 'legacy_dish_evaluation' : 'missing',
        legacy_dish_ratio: number(oldEvaluation?.ratio), limitations_json: json(dish.limitations), raw_dish_json: json(dish),
        raw_legacy_evaluation_json: json(oldEvaluation), issues: matchingEvaluations.length > 1 ? 'ambiguous_legacy_evaluation' : '' });
      const rawIngredients = dish.ingredients || [];
      const nameList = [...new Set([...rawIngredients.map((v) => v.name), ...(snapshot?.ingredients || []).map((v) => v.name),
        ...Object.keys(consumption?.percentages || {}), ...Object.keys(consumption?.consumedGrams || {}),
        ...(oldEvaluation?.consumedIngredients || []).map((v) => v.name)])];
      nameList.forEach((name, ingredientOffset) => {
        const issues = new Set();
        const original = rawIngredients.find((v) => v.name === name);
        const calibration = record.modelAudit?.quantityCalibration;
        const modelOriginal = calibration ? record.modelAudit?.rawDish?.ingredients?.find(i => i.name === name) : original;
        const snap = snapshot?.ingredients?.find((v) => v.name === name);
        const oldIngredients = oldEvaluation?.consumedIngredients?.filter((v) => v.name === name) || [];
        const oldIngredient = oldIngredients.length === 1 ? oldIngredients[0] : undefined;
        if (oldIngredients.length > 1) issues.add('ambiguous_legacy_consumption');
        if (!record.participantCode) issues.add('missing_participant_code');
        if (!original) issues.add('ingredient_missing_from_recognition');
        if (calibration && !modelOriginal) issues.add('calibration_raw_prediction_missing');
        if (!snap) issues.add('missing_saved_snapshot');
        if (dishes.length > 1 && record.auditSnapshot) issues.add('snapshot_dish_ambiguous');
        const excluded = record.excludedIngredients?.includes(name) || snap?.excluded === true;
        const query = { name, cookingMethod: original?.cookingMethod || dish.cookingMethod || '' };
        // 每种食材独立调用同一匹配函数，避免页面的10项上限截断研究导出。
        const auto = algorithms.match.matchMeal({ dishName: text(dish.dishName), cookingMethod: text(dish.cookingMethod), ingredients: [query] }).ingredients[0];
        const selectedId = dishes.length === 1 ? text(record.selectedRecords?.[name]) : '';
        const savedRecord = snap?.recordId ? algorithms.texture.findRecordById(snap.recordId) : undefined;
        const snapshotValid = savedRecord && savedRecord.dish === snap.matchedDish && savedRecord.ingredient === snap.matchedIngredient;
        if (snap?.recordId && !snapshotValid) issues.add('saved_texture_id_not_verified');
        const selected = selectedId ? algorithms.texture.findRecordById(selectedId) : undefined;
        if (selectedId && !selected) issues.add('saved_selection_missing_in_library');
        const primary = snapshotValid ? savedRecord : selected || (auto?.recordId ? algorithms.texture.findRecordById(auto.recordId) : undefined);
        const matchSource = snapshotValid ? 'saved_snapshot' : selected ? 'saved_selection' : 'recomputed_at_export';
        const sameAsAuto = !!primary && primary.id === auto?.recordId;
        const matchType = sameAsAuto ? auto.matchType : primary ? 'saved_match' : 'none';
        const methodDiffers = !!primary && !!query.cookingMethod && !!primary.method &&
          algorithms.match.methodScore(query.cookingMethod, primary.method) === 0;
        const needsReview = !primary || !sameAsAuto || auto?.matchType !== 'exact' || methodDiffers;
        if (needsReview) issues.add('texture_match_requires_review');
        if (methodDiffers) issues.add('texture_cooking_method_differs');
        const info = { ...common, ingredient_index: ingredientOffset + 1, ingredient_name: name };
        const validNumber = (value, max = Infinity) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
        const newPercent = consumption?.percentages?.[name];
        const legacyPercent = validNumber(oldEvaluation?.ratio, 5) ? oldEvaluation.ratio * 100 : undefined;
        const percent = newPercent ?? legacyPercent;
        const storedG = consumption?.consumedGrams?.[name] ?? oldIngredient?.consumedG;
        const percentSource = newPercent != null ? 'saved_ingredient_percent' : legacyPercent != null ? 'legacy_dish_ratio' : 'missing';
        const consumptionSource = consumption?.consumedGrams?.[name] != null ? 'saved_ingredient_evaluation' : oldIngredient?.consumedG != null ? 'legacy_dish_evaluation' : 'missing';
        if (percent != null && !validNumber(percent, 500)) issues.add('invalid_consumed_percent');
        if (storedG != null && !validNumber(storedG)) issues.add('invalid_consumed_g');
        const plate = validNumber(record.plateDiameterCm) && record.plateDiameterCm > 0 ? record.plateDiameterCm : algorithms.weight.DEFAULT_PLATE_DIAMETER;
        const weight = original ? algorithms.weight.estimateWeight({ name, category: primary?.category,
          areaRatio: original.areaRatio, heightCm: original.heightCm, grams: original.estimatedG,
          confidence: original.weightConfidence || original.confidence || dish.weightConfidence }, plate) : null;
        const weightKnown = !!weight && weight.grams > 0;
        const row = { ...info, cooking_method: query.cookingMethod, excluded: Number(!!excluded),
          record_valid: Number(record.status === 'completed' && !record.discardedAt && record.evaluationStatus !== 'discarded'),
          evaluation_complete: Number(record.evaluationStatus === 'completed'),
          evaluation_evidence: record.evaluationStatus || (oldEvaluation ? 'legacy_values_present_status_unknown' : 'unknown'),
          area_ratio: number(modelOriginal?.areaRatio), height_cm: number(modelOriginal?.heightCm),
          model_estimated_g: number(modelOriginal?.estimatedG), model_min_g: number(modelOriginal?.minG), model_max_g: number(modelOriginal?.maxG),
          effective_area_ratio: number(original?.areaRatio), effective_height_cm: number(original?.heightCm), effective_estimated_g: number(original?.estimatedG),
          quantity_calibration_version: text(calibration?.version), quantity_calibration_factor: number(calibration?.factor),
          calibration_reference_type: text(calibration?.referenceType),
          snapshot_estimated_g: number(snap?.grams), snapshot_weight_range: text(snap?.weightRange), snapshot_weight_basis: text(snap?.weightBasis),
          snapshot_algorithm_version: text(snapshot?.algorithmVersion), snapshot_at: iso(snapshot?.generatedAt),
          current_estimated_g: weightKnown ? weight.grams : '', current_min_g: weightKnown ? weight.minG : '', current_max_g: weightKnown ? weight.maxG : '',
          current_weight_basis: weight?.basis || '', current_weight_confidence: weight?.confidence || '',
          current_weight_algorithm_version: algorithms.weight.WEIGHT_ALGORITHM_VERSION, plate_diameter_cm_used: plate,
          plate_diameter_defaulted: Number(!record.plateDiameterCm),
          consumed_percent: validNumber(percent, 500) ? percent : '', percent_source: percentSource,
          stored_consumed_g: validNumber(storedG) ? storedG : '', consumption_source: consumptionSource,
          current_consumed_g: !excluded && weightKnown && validNumber(percent, 500) ? Math.round(weight.grams * percent) / 100 : '',
          selected_record_id: selectedId, snapshot_record_id: text(snap?.recordId), current_auto_record_id: auto?.recordId || '',
          match_source: matchSource, match_type: matchType, auto_match_score: number(auto?.score),
          auto_match_reason: auto?.reason || '', saved_match_reason: text(snap?.matchReason),
          matched_record_id: primary?.id || '', matched_dish: primary?.dish || '', matched_ingredient: primary?.ingredient || '',
          matched_category: primary?.category || '', matched_cooking_method: primary?.method || '', matched_cooking_minutes: number(primary?.minutes),
          needs_review: Number(needsReview), raw_ingredient_json: json(original), raw_snapshot_ingredient_json: json(snap),
        };
        let readings = [];
        if (snapshotValid && Array.isArray(snap.sources) && snap.sources.length) {
          for (const source of snap.sources) {
            const found = library.filter((v) => v.dish === snap.matchedDish && v.ingredient === snap.matchedIngredient && v.testMode === source.testMode && v.source === source.source);
            if (found.length === 1) readings.push(found[0]);
            else issues.add('snapshot_texture_source_not_unique_or_missing');
          }
        } else if (primary) readings = [primary, ...algorithms.match.alternateTestModes(primary.id)];
        readings = [...new Map(readings.map((v) => [v.id, v])).values()];
        for (const reading of readings) tables.texture_matches.push({ ...info, excluded: row.excluded, record_valid: row.record_valid,
          match_source: matchSource, match_type: matchType, needs_review: Number(needsReview),
          primary_match: Number(reading.id === primary?.id), values_source: 'bundled_measured_library', ...libraryRow(reading) });
        // 宽表按测试模式各取烹饪时间最长的一条，全部来源仍保留在长表。
        for (const [mode, prefix] of [['切割测试', 'cut'], ['下压测试', 'compression']]) {
          const candidates = readings.filter((v) => v.testMode === mode).sort((a, b) => b.minutes - a.minutes);
          const reading = candidates[0];
          row[`${prefix}_reading_count`] = candidates.length;
          row[`${prefix}_record_id`] = reading?.id || '';
          row[`${prefix}_source`] = reading?.source || '';
          row[`${prefix}_cooking_minutes`] = number(reading?.minutes);
          for (const [key, metric] of Object.entries(metricKeys)) row[`${prefix}_${key}`] = number(reading?.metrics[metric]);
        }
        (auto?.candidates || []).forEach((candidate, index) => tables.match_candidates.push({ ...info, candidate_rank: index + 1,
          texture_record_id: candidate.id, score_percent: candidate.scorePercent, reason: candidate.reason,
          matched_dish: candidate.dish, matched_ingredient: candidate.ingredient, test_mode: candidate.testMode, cooking_text: candidate.cookingText }));
        row.issues = [...issues].join(';');
        tables.ingredients_full.push(row);
        summary[primary ? 'matchedIngredients' : 'unmatchedIngredients']++;
        if (needsReview) summary.needsReview++;
        summary.matchSources[matchSource] = (summary.matchSources[matchSource] || 0) + 1;
        for (const issue of issues) summary.issues[issue] = (summary.issues[issue] || 0) + 1;
      });
    });
  }
  summary.dishes = tables.dishes.length;
  summary.ingredients = tables.ingredients_full.length;
  summary.textureReadings = tables.texture_matches.length;
  summary.usersWithOpenId = new Set(tables.records.map((v) => v.user_key).filter(Boolean)).size;
  summary.participantCodes = new Set(tables.records.map((v) => v.participant_code).filter(Boolean)).size;
  return { tables, summary, hashes: algorithms.hashes };
}

function exportFullFile(input, options = {}, targetDirectory) {
  const buffer = fs.readFileSync(input);
  const records = parseRecords(buffer.toString('utf8'));
  const result = buildFullTables(records);
  const output = targetDirectory || createRunDirectory(path.resolve(options.out || path.join(ROOT, 'exports/full')));
  fs.mkdirSync(path.join(output, 'raw'), { recursive: true });
  const rawTarget = path.join(output, 'raw/meal_records.json');
  if (path.resolve(input) !== rawTarget) fs.copyFileSync(input, rawTarget, fs.constants.COPYFILE_EXCL);
  const dictionary = [];
  const descriptions = require('./full-fields.cjs');
  for (const [name, rows] of Object.entries(result.tables)) {
    const keys = [...new Set(rows.flatMap(Object.keys))];
    if (!keys.length) keys.push('record_id');
    fs.writeFileSync(path.join(output, `${name}.csv`), csv(keys.map((key) => ({ key })), rows), { flag: 'wx' });
    keys.forEach((key) => dictionary.push({ table: `${name}.csv`, field: key, description: descriptions.describe(key) }));
  }
  fs.writeFileSync(path.join(output, 'fields.csv'), csv(['table', 'field', 'description'].map((key) => ({ key })), dictionary), { flag: 'wx' });
  const manifest = { schemaVersion: 'full-1', exportedAt: new Date().toISOString(), inputSha256: hash(buffer),
    sourceCodeSha256: result.hashes, options: { allRecords: true, includeExcluded: true, recomputeMissingMatches: true }, summary: result.summary };
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(output, '使用说明.md'), descriptions.readme(result.summary), { flag: 'wx' });
  return { output, summary: result.summary };
}
module.exports = { loadAlgorithms, buildFullTables, exportFullFile };
