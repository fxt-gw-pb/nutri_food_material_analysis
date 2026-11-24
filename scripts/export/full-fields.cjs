const labels = {
  record_id: '识别记录ID', participant_code: '用户当时填写的参与者编码；未填写留空，按文本导入', user_key: '微信用户ID的SHA-256前20位，仅用于本地分组，不替代参与者编码',
  meal_session_id: '同餐ID；空值不能归为同一顿饭', created_at: '创建时间（UTC+08:00）', updated_at: '更新时间（UTC+08:00）',
  status: '原始识别状态', evaluation_status: '原始饭后评估状态', image_file_id: '云存储照片ID（不是本地图片）',
  dish_index: '记录内菜品序号', dish_id: '旧版菜品ID', dish_name: '识别菜名', dish_count: '识别出的菜品数',
  ingredient_index: '本菜内食材序号', ingredient_name: '识别食材名', cooking_method: '烹饪方式',
  recognition_confidence: '模型识别置信度', excluded: '已删除食材=1；保留在完整导出中', record_valid: '识别已完成且未作废=1',
  evaluation_complete: '原始新版本评估明确完成=1；旧版不推断完成状态', evaluation_evidence: '评估状态依据；legacy_values_present_status_unknown表示有旧版数值但完成状态未知',
  area_ratio: '模型估计盘面占比', height_cm: '模型估计堆叠高度，cm', model_estimated_g: '模型原始估重，g', model_min_g: '模型原始重量下限，g', model_max_g: '模型原始重量上限，g',
  effective_area_ratio: '供前端估重使用的盘面占比；新模型含云端份量校准',
  effective_height_cm: '供前端估重使用的有效厚度，cm；新模型含云端份量校准',
  effective_estimated_g: '供前端估重使用的直接克数，g；尚未执行前端肉类减半',
  quantity_calibration_version: '云端份量校准版本', quantity_calibration_factor: '云端份量校准系数',
  calibration_reference_type: '校准参照类型；user-approved-legacy-estimate-proxy 表示旧算法参照，并非实称',
  model_estimated_total_g: '模型原始本道菜总重，g', model_min_total_g: '模型原始本道菜总重下限，g', model_max_total_g: '模型原始本道菜总重上限，g',
  snapshot_available: '保存过审计快照=1', snapshot_estimated_g: '历史快照保存的食材估重，g', snapshot_estimated_total_g: '历史快照的本道菜总重，g',
  snapshot_weight_range: '历史快照重量区间', snapshot_weight_basis: '历史快照估重依据', snapshot_algorithm_version: '历史快照算法版本', snapshot_at: '历史快照时间',
  current_estimated_g: '本次导出按当前算法计算的估重，g；不是历史实测值', current_min_g: '本次重算重量下限，g', current_max_g: '本次重算重量上限，g',
  current_weight_basis: '本次重算依据', current_weight_confidence: '本次重算置信度', current_weight_algorithm_version: '本次估重算法版本',
  plate_diameter_cm_used: '本次计算采用的餐盘直径，cm', plate_diameter_defaulted: '缺盘径而采用默认26cm=1',
  consumed_percent: '食用百分比，100为拍照份量全部吃完，0至500', percent_source: '比例来自逐食材评估或旧版整菜ratio×100；missing为缺失',
  stored_consumed_g: '原数据保存的食材摄入量，g；不覆盖或重算', stored_consumed_total_g: '原数据保存的本道菜摄入总重，g',
  consumption_source: '已保存摄入量来源：新版逐食材/旧版整菜评估/missing', current_consumed_g: '本次重算估重×已填比例，g；已删除食材、缺重或缺比例留空',
  legacy_dish_ratio: '旧版整菜食用比例，1表示100%', selected_record_id: '用户手动选择ID', snapshot_record_id: '历史快照匹配ID', current_auto_record_id: '当前算法自动匹配ID',
  match_source: 'saved_snapshot优先；其次saved_selection；无可用历史结果时recomputed_at_export', match_type: 'exact精确食材；similar相似食材；saved_match历史选择；none未匹配',
  auto_match_score: '当前算法的匹配得分，不是正确概率', auto_match_reason: '当前算法匹配原因', saved_match_reason: '历史快照匹配原因',
  matched_record_id: '本次采用的主质构记录ID', texture_record_id: '质构库记录ID', matched_dish: '库中菜名', matched_ingredient: '库中食材名', matched_category: '库中食物类别',
  matched_cooking_method: '匹配来源烹饪方式', matched_cooking_minutes: '匹配来源烹饪时长，0表示未标注', cooking_minutes: '实测来源烹饪时长，0表示未标注',
  needs_review: '相似食材、未匹配、烹饪方式不同或与当前自动选择不一致=1；需要人工核对', issues: '问题代码，分号分隔',
  test_mode: '切割测试或下压测试', source: '实验室实测来源文件名', primary_match: '主匹配记录=1', values_source: '数值来自项目内实测参考库，不是用户食物的实测',
  category: '实测库类别', height_mm: '样品高度，mm', hardness_gf: '硬度，gf', fracturability_gf: '脆度，gf', adhesiveness_gf_sec: '黏着性，gf·s；可为负',
  springiness: '弹性，无量纲', chewiness_gf: '咀嚼性，gf', gumminess_gf: '胶着性，gf', cohesiveness: '内聚性，无量纲', resilience: '回复性，无量纲',
  candidate_rank: '当前匹配算法给出的备选顺序', score_percent: '匹配得分×100，不是正确概率', reason: '备选原因', cooking_text: '来源烹饪方式及时长',
  limitations_json: '原始识别限制说明JSON', raw_dish_json: '原始菜品完整JSON', raw_legacy_evaluation_json: '原始旧版评估JSON',
  raw_ingredient_json: '原始食材JSON', raw_snapshot_ingredient_json: '原始快照食材JSON',
};
function describe(key) {
  if (labels[key]) return labels[key];
  for (const [prefix, mode] of [['cut_', '切割测试'], ['compression_', '下压测试']]) {
    if (!key.startsWith(prefix)) continue;
    const tail = key.slice(prefix.length);
    if (tail === 'reading_count') return `${mode}关联来源数；宽表取最长烹饪时间，长表保留全部`;
    if (tail === 'record_id') return `${mode}用于宽表的质构记录ID`;
    return `${mode}：${labels[tail] || tail}`;
  }
  if (key.startsWith('raw_')) return `数据库原始字段 ${key.slice(4)}；对象/数组保留为JSON字符串`;
  throw Error(`字段缺少中文说明：${key}`);
}
function readme(summary) {
  return `# 完整识别及质构数据导出\n\n共 ${summary.records} 条识别记录、${summary.dishes} 道菜、${summary.ingredients} 条食材、${summary.textureReadings} 条质构测试来源。\n\n先打开 **ingredients_full.csv**：一行对应“识别记录＋菜品＋食材”，已合并切割和下压指标；数据列含中文释义的字段字典见 fields.csv。\n\n- raw/meal_records.json：后台全量原始JSON，全部字段原样保留。\n- records.csv：每次识别一行，包含全部原始字段（对象与数组为JSON字符串）。\n- dishes.csv：每道菜一行，旧版本一次识别中的多道菜全部展开。\n- ingredients_full.csv：历史估重、原始模型估重、本次重算估重分别保留；旧版整菜评估和新版逐食材评估均有来源标记。\n- texture_matches.csv：质构长表，保存全部已关联测试来源、模式、烹饪时长和九项指标。\n- match_candidates.csv：当前算法备选匹配，方便人工调整。\n- texture_library.csv：本次使用的712条实测参考库，含原始出处。\n- manifest.json：条数、状态、数据及算法文件SHA-256。\n\n## 口径\n\n本次采用的质构来源优先使用验证过的历史快照，其次使用用户保存的选择，缺失时才调用项目当前匹配算法。match_source明确区分上述来源；current_auto_record_id记录当前自动算法选择以便比较。九项指标取自同类食物的实验室实测库，不代表对拍摄食物进行测量。\n\n${summary.matchedIngredients} 条食材匹配到了参考记录，${summary.unmatchedIngredients} 条未匹配；${summary.needsReview} 条标记needs_review=1，包括相似食材、未匹配及历史选择与当前自动选择不同。自动匹配不是人工核验。\n\n不重新调用识别API、不修改云数据库。current_*估重是在本次导出时按当前算法计算，不能当作当时保存的值。stored_consumed_g保留历史摄入量，current_consumed_g是单独的重算值，二者不能混用。旧版整菜比例会注明legacy_dish_ratio，缺少完成状态时不推断其已完成。\n\n全量文件包含失败、待处理、作废记录与已删除食材；分析时按status、record_valid、excluded和evaluation_status筛选。缺失数值为空，0仍表示实际保存的零值。\n\n宽表中每种测试模式选烹饪时间最长的来源；同模式更多来源在texture_matches.csv。质构长表可能一食材多行，不要在连接长表后直接累加食材摄入量，否则会重复计数。用record_id＋dish_index＋ingredient_index关联。\n\nExcel使用“数据→从文本/CSV”导入，把participant_code、user_key和各ID列设为文本，保留前导零。CSV包含UTF-8 BOM。records.csv和原始JSON包含微信用户ID，请作为本地原始研究数据保管。图片仅保留云存储ID及原始链接，未下载照片文件。\n`;
}
module.exports = { describe, readme };
