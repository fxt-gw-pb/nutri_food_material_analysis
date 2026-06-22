// 核心数据类型定义。
// 这些类型同时约束前端展示、mock service 和未来的 CloudBase 云函数返回结构。

/** 可信度等级（统一使用 高 / 中 / 低 三档） */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** 食用比例：1/4、1/2、3/4、全吃完 */
export type ConsumptionRatio = 0.25 | 0.5 | 0.75 | 1;

/**
 * 分析异步任务状态机。
 * 与未来云函数 analyzeMeal 的真实状态保持一致，便于前端无需改动即可对接。
 */
export type AnalysisStatus =
  | 'pending'
  | 'preprocessing'
  | 'stage_1_recognition'
  | 'geometry_analysis'
  | 'stage_2_weight_estimation'
  | 'completed'
  | 'failed';

/** 单种食材的识别与重量估算结果 */
export interface Ingredient {
  name: string;
  /** 预估重量（整数 g） */
  estimatedG: number;
  /** 重量区间下限（整数 g） */
  minG: number;
  /** 重量区间上限（整数 g） */
  maxG: number;
  confidence: ConfidenceLevel;
}

/** 单道菜的识别与重量估算结果 */
export interface Dish {
  dishId: string;
  dishName: string;
  /** 烹饪方式，如 炒 / 蒸 / 红烧 */
  cookingMethod: string;
  estimatedTotalG: number;
  minTotalG: number;
  maxTotalG: number;
  /** 菜品识别可信度 */
  recognitionConfidence: ConfidenceLevel;
  /** 重量估算可信度 */
  weightConfidence: ConfidenceLevel;
  ingredients: Ingredient[];
  /** 估算限制说明，展示给用户以避免误读为真实称重 */
  limitations: string[];
}

/** 用户对单道菜的食用记录（由前端根据比例计算，不再调用大模型） */
export interface ConsumptionRecord {
  dishId: string;
  ratio: ConsumptionRatio;
  /** 实际摄入该菜品的重量（整数 g） */
  consumedTotalG: number;
  /** 实际摄入各食材的重量（整数 g） */
  consumedIngredients: { name: string; consumedG: number }[];
}

/**
 * 一次完整的餐盘分析记录。
 * 对应未来 CloudBase 云数据库集合 meal_records 的一条文档。
 * 其中 dishes / consumptions 在数据库中建议嵌套于 result 字段内（见 docs/cloudbase-integration.md）。
 */
export interface MealAnalysis {
  analysisId: string;
  /** CloudBase 云存储 fileID（预留，mock 阶段为空） */
  imageFileId?: string;
  /** 可访问的图片地址；mock 阶段为本地临时路径 */
  imageUrl: string;
  /** 餐盘直径（cm），用于几何尺度估算 */
  plateDiameterCm: number;
  status: AnalysisStatus;
  /** 预留：千问模型名 */
  modelName?: string;
  /** 预留：prompt 版本 */
  promptVersion?: string;
  dishes: Dish[];
  /** 用户食用比例选择结果 */
  consumptions: ConsumptionRecord[];
  createdAt: number;
  updatedAt: number;
  /** 仅 mock 阶段使用：用于模拟分析进度推进的起始时间戳 */
  mockStartedAt?: number;
}

/** 历史记录列表项（由 MealAnalysis 派生的轻量视图） */
export interface MealHistoryItem {
  analysisId: string;
  /** 创建时间戳 */
  date: number;
  imageUrl: string;
  /** 菜品摘要，如 "西兰花炒鸡胸肉、番茄炒蛋" */
  dishSummary: string;
  dishCount: number;
  /** 总预估重量（整数 g） */
  totalEstimatedG: number;
  /** 实际摄入合计重量（整数 g），未选择比例时为 0 */
  consumedG: number;
  /** 首道菜的食用比例，用于摘要展示；未选择时为 undefined */
  ratio?: ConsumptionRatio;
}
