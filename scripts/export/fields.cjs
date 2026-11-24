// 稳定的英文列名用于 R/Python；中文释义随每次导出写入 fields.csv。
const fields = (rows) => rows.map(([key, label, unit = '']) => ({ key, label, unit }));
const common = fields([
  ['record_id', '识别记录ID'], ['participant_code', '参与者编码（按文本导入）'],
  ['meal_session_id', '同一顿饭的会话ID（旧记录可能为空）'],
  ['created_at', '识别创建时间（UTC+08:00）'], ['status', '识别状态'],
  ['evaluation_status', '饭后评估状态（空值表示旧记录未知）'],
]);
const meals = [...common, ...fields([
  ['updated_at', '记录更新时间'], ['dish_name', '识别菜名'], ['cooking_method', '识别烹饪方式'],
  ['meal_type', '餐次类型'], ['recognition_confidence', '识别置信度'],
  ['plate_diameter_cm', '餐盘直径', 'cm'], ['image_file_id', '图片云存储ID'],
  ['meal_session_finished_at', '本顿饭拍摄结束时间'], ['discarded_at', '重拍作废时间'],
  ['model_name', '视觉模型名'], ['prompt_version', '提示词版本'],
  ['snapshot_available', '是否存在估重快照（1/0）'], ['algorithm_version', '快照估重算法版本'],
  ['snapshot_at', '快照生成时间'], ['estimated_total_g', '快照中本道菜的有效食材估重合计', 'g'],
  ['consumed_total_g', '已保存的本道菜摄入总重（草稿也可能有值）', 'g'],
  ['evaluation_completed_at', '评估完成时间'], ['ingredient_count', '本次导出的食材行数'],
  ['excluded_ingredient_count', '被用户排除的食材数'], ['issues', '数据问题代码（分号分隔）'],
])];
const ingredients = [...common, ...fields([
  ['ingredient_index', '本记录内食材序号（从1开始）'], ['dish_name', '识别菜名'],
  ['ingredient_name', '识别食材名'], ['cooking_method', '识别食材烹饪方式'],
  ['excluded', '用户已删除该食材（1/0）'], ['evaluation_complete', '该记录已完成饭后评估（1/0）'],
  ['estimated_g', '已保存快照中的估重（缺快照时留空）', 'g'], ['weight_range', '估重区间'],
  ['weight_confidence', '估重置信度'], ['weight_basis', '估重依据'],
  ['consumed_percent', '用户填写的食用比例（0至500，100为吃完拍摄份量）', '%'],
  ['consumed_g', '已保存的估算摄入重量（缺值留空）', 'g'],
  ['area_ratio', '模型盘面占比'], ['height_cm', '模型堆叠高度', 'cm'],
  ['model_estimated_g', '模型原始估重（未进行小程序校正）', 'g'],
  ['effective_area_ratio', '供前端估重使用的盘面占比（新模型含云端份量校准）'],
  ['effective_height_cm', '供前端估重使用的有效厚度（新模型含云端份量校准）', 'cm'],
  ['effective_estimated_g', '供前端估重使用的直接克数（尚未执行前端肉类减半）', 'g'],
  ['quantity_calibration_version', '云端份量校准版本'], ['quantity_calibration_factor', '云端份量校准系数'],
  ['calibration_reference_type', '份量校准参照类型；legacy proxy 为旧算法估重参照，并非实称'],
  ['selected_record_id', '用户手动选择的质构记录ID'], ['matched_record_id', '快照主质构记录ID'],
  ['matched_dish', '质构库菜名'], ['matched_ingredient', '质构库食材名'],
  ['matched_cooking', '质构库烹饪方式及时长'], ['match_reason', '匹配原因'],
  ['snapshot_available', '该食材是否有估重快照（1/0）'], ['algorithm_version', '快照估重算法版本'],
  ['issues', '数据问题代码（分号分隔）'],
])];
const textures = fields([
  ['record_id', '识别记录ID'], ['participant_code', '参与者编码（按文本导入）'],
  ['ingredient_index', '本记录内食材序号'], ['ingredient_name', '识别食材名'],
  ['test_mode', '切割测试或下压测试'], ['source', '快照记载的实测来源文件'],
  ['texture_record_id', '本地质构库记录ID'], ['matched_dish', '快照记载的匹配菜名'],
  ['matched_ingredient', '快照记载的匹配食材名'],
  ['value_source', 'bundled_library表示按快照来源查本地实测库；missing表示未找到唯一来源'],
  ['height_mm', '样品高度', 'mm'], ['hardness_gf', '硬度', 'gf'], ['fracturability_gf', '脆度', 'gf'],
  ['adhesiveness_gf_sec', '黏着性', 'gf·s'], ['springiness', '弹性'], ['chewiness_gf', '咀嚼性', 'gf'],
  ['gumminess_gf', '胶着性', 'gf'], ['cohesiveness', '内聚性'], ['resilience', '回复性'],
]);
module.exports = { meals, ingredients, textures };
