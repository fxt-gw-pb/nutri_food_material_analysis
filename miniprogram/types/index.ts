// 核心数据类型定义。
// 这些类型同时约束前端展示、mock service 和 CloudBase 云函数的返回结构。
//
// 本版本的主线是「拍照 → 识别菜品 → 拆出全部食材 → 每种食材各自匹配质构数据」，
// 不估算任何重量。

/** 可信度等级（统一使用 高 / 中 / 低 三档） */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** 餐次类型 */
export type MealType =
  | 'breakfast'
  | 'morning_snack'
  | 'lunch'
  | 'afternoon_snack'
  | 'dinner'
  | 'evening_snack';

/**
 * 分析异步任务状态机。
 * 与云函数 analyzeMeal 的真实状态保持一致，前端只负责展示。
 */
export type AnalysisStatus =
  | 'pending'
  | 'preprocessing'
  | 'recognizing'
  | 'completed'
  | 'failed';

/** 视觉模型识别出的一种食材 */
export interface RecognizedIngredient {
  name: string;
  /** 该食材的烹饪方式（如 煮 / 蒸 / 炒），模型给不出时为空 */
  cookingMethod?: string;
}

/** 视觉模型识别出的那道菜（一次识别只出一道菜，不含任何重量信息） */
export interface Dish {
  dishName: string;
  /** 整道菜的烹饪方式，如 炒 / 蒸 / 红烧 */
  cookingMethod: string;
  /** 菜品识别可信度 */
  recognitionConfidence: ConfidenceLevel;
  /** 这道菜里识别出的**全部**食材；每一种都会各自去质构库里匹配并展示 */
  ingredients: RecognizedIngredient[];
}

/**
 * 一次完整的餐盘分析记录。
 * 对应 CloudBase 云数据库集合 meal_records 的一条文档。
 * dish 在数据库中嵌套于 result 字段内（见 docs/cloudbase-integration.md）。
 */
export interface MealAnalysis {
  analysisId: string;
  /** CloudBase 云存储 fileID */
  imageFileId?: string;
  /** 可访问的图片地址；mock 阶段为本地临时路径 */
  imageUrl: string;
  status: AnalysisStatus;
  /** 餐次（早餐 / 午餐 / 加餐…），由结果页选择 */
  mealType?: MealType;
  /** 千问模型名 */
  modelName?: string;
  /** prompt 版本 */
  promptVersion?: string;
  /** 识别出的那道菜；识别不到食物时为 null */
  dish: Dish | null;
  /**
   * 用户在结果页手动改选的质构记录：识别食材名 → 质构库记录 id。
   * 只存被改过的那几种食材，其余仍走自动匹配。
   */
  selectedRecords?: Record<string, string>;
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
  /** 餐次 */
  mealType?: MealType;
  imageUrl: string;
  /** 识别出的菜名 */
  dishName: string;
  /** 已匹配到质构数据的食材数 */
  matchedCount: number;
  /** 识别出的食材总数 */
  totalCount: number;
  /** 食材名摘要，如 "五花肉、土豆、青椒" */
  ingredientText: string;
  /** 质构摘要，如 "偏软 · 好嚼" */
  textureSummary: string;
}
