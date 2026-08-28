// ============================================================================
// 餐盘分析 service —— 分发器（页面唯一的数据访问入口）。
//
// 页面一律从这里导入函数，不直接读写 Storage / 调用云能力。
// 按 config.useCloud 选择实现：
//   false → mealService.mock.ts （本地 mock）
//   true  → mealService.cloud.ts（CloudBase + 千问识别）
// 两套实现都满足 MealServiceApi 契约，签名不一致会在 type-check 报错。
//
// 注意：质构匹配不在这一层，它是纯本地计算（services/textureMatch.ts），
// 无论走 mock 还是云端都一样。
// ============================================================================

import { CONFIG } from './config';
import { MealServiceApi } from './mealService.api';
import * as mockImpl from './mealService.mock';
import * as cloudImpl from './mealService.cloud';

const impl: MealServiceApi = CONFIG.useCloud ? cloudImpl : mockImpl;

export const uploadMealImage = impl.uploadMealImage;
export const createMealAnalysis = impl.createMealAnalysis;
export const getMealAnalysisStatus = impl.getMealAnalysisStatus;
export const getMealAnalysisResult = impl.getMealAnalysisResult;
export const saveRecordSelections = impl.saveRecordSelections;
export const saveMealType = impl.saveMealType;
export const getMealHistory = impl.getMealHistory;
export const deleteMealRecord = impl.deleteMealRecord;

export type { CreateMealAnalysisParams } from './mealService.api';
