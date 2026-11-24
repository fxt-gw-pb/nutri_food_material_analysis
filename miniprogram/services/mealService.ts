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
import { normalizeParticipantCode } from './userProfile';

const impl: MealServiceApi = CONFIG.useCloud ? cloudImpl : mockImpl;

export const uploadMealImage = impl.uploadMealImage;
let creating = false;
export async function createMealAnalysis(params: import('./mealService.api').CreateMealAnalysisParams): Promise<{ analysisId: string }> {
  if (creating) throw new Error('正在创建识别，请稍候');
  creating = true;
  try {
    // 兼容没有饭局标识的旧调用；新版上传流程总会带 mealSessionId，
    // 同一顿饭的多道菜因此不会互相阻塞。
    if (!params.mealSessionId) {
      const pending = await impl.getPendingMealEvaluation();
      if (pending) throw new Error('请先完成上一餐的饭后评估');
    }
    const participantCode = normalizeParticipantCode(params.participantCode || '');
    return await impl.createMealAnalysis({ ...params, participantCode });
  } finally { creating = false; }
}
export const getMealAnalysisStatus = impl.getMealAnalysisStatus;
export const getMealAnalysisResult = impl.getMealAnalysisResult;
export const saveRecordSelections = impl.saveRecordSelections;
export const saveMealType = impl.saveMealType;
export const getMealHistory = impl.getMealHistory;
export const deleteMealRecord = impl.deleteMealRecord;
export const discardMealAnalysis = impl.discardMealAnalysis;
export const getPendingMealEvaluation = impl.getPendingMealEvaluation;
export const saveExcludedIngredients = impl.saveExcludedIngredients;
export const saveConsumptionEvaluation = impl.saveConsumptionEvaluation;
export const saveAuditSnapshot = impl.saveAuditSnapshot;
export const finishMealSession = impl.finishMealSession;
export const getMealsInRange = impl.getMealsInRange;

export type { CreateMealAnalysisParams, AnalysisProgress } from './mealService.api';
