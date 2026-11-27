// ============================================================================
// 餐盘分析 service —— 自建后端实现（网页版）。
//
// 替换 miniprogram/services/mealService.cloud.ts，导出完全相同的函数（满足 MealServiceApi），
// 页面和分发器 mealService.ts 一行不改。差别只在数据去哪：
//   小程序：wx.cloud.uploadFile / 云函数 analyzeMeal / 云数据库 meal_records
//   网页版：POST /api/images / POST /api/meals（服务端排队调用同一份 vision.js）/ SQLite meal_records
// 饭后评估、审计快照、摄入汇总都由服务端用同一套 utils/evaluation.ts 计算后落库，
// 页面拿到的仍是 MealAnalysis；历史列表的质构摘要照旧在本地按同一套匹配规则现算。
// ============================================================================

import { MealAnalysis, MealHistoryItem, MealType } from '../../../miniprogram/types/index';
import { resolveMeal } from '../../../miniprogram/utils/texture';
import { AnalysisProgress, CreateMealAnalysisParams } from '../../../miniprogram/services/mealService.api';
import { apiRequest } from '../api';

const id = (analysisId: string) => encodeURIComponent(analysisId);

function toHistoryItem(meal: MealAnalysis): MealHistoryItem {
  const resolved = resolveMeal(meal.dish, meal.selectedRecords, meal.plateDiameterCm, meal.excludedIngredients);
  return {
    analysisId: meal.analysisId,
    participantCode: meal.participantCode,
    mealSessionId: meal.mealSessionId,
    mealSessionFinishedAt: meal.mealSessionFinishedAt,
    date: meal.createdAt,
    mealType: meal.mealType,
    imageUrl: meal.imageUrl,
    dishName: resolved.recognizedName,
    matchedCount: resolved.matchedCount,
    totalCount: resolved.totalCount,
    ingredientText: resolved.ingredients.map((i) => i.name).join('、'),
    textureSummary: resolved.summary,
    totalG: resolved.totalG,
    evaluationStatus: meal.evaluationStatus,
    totalConsumedG: meal.consumption?.totalConsumedG,
  };
}

export async function uploadMealImage(filePath: string): Promise<{ fileId: string; imageUrl: string }> {
  // filePath 是选图时生成的 blob: 地址（已在本机压缩）。
  const blob = await fetch(filePath).then((r) => r.blob());
  return apiRequest('POST', '/api/images', blob);
}

export function createMealAnalysis(params: CreateMealAnalysisParams): Promise<{ analysisId: string }> {
  return apiRequest('POST', '/api/meals', {
    imageFileId: params.imageFileId,
    plateDiameterCm: params.plateDiameterCm,
    participantCode: params.participantCode,
    mealSessionId: params.mealSessionId || '',
  });
}

export function getMealAnalysisStatus(analysisId: string): Promise<AnalysisProgress> {
  return apiRequest('GET', `/api/meals/${id(analysisId)}/status`);
}

export function getMealAnalysisResult(analysisId: string): Promise<MealAnalysis> {
  return apiRequest('GET', `/api/meals/${id(analysisId)}`);
}

export async function saveRecordSelections(analysisId: string, selections: Record<string, string>): Promise<void> {
  await apiRequest('PUT', `/api/meals/${id(analysisId)}/selections`, { selections });
}

export async function saveMealType(analysisId: string, mealType: MealType): Promise<void> {
  await apiRequest('PUT', `/api/meals/${id(analysisId)}/meal-type`, { mealType });
}

export async function getMealHistory(): Promise<MealHistoryItem[]> {
  const meals = await apiRequest<MealAnalysis[]>('GET', '/api/meals?view=history');
  return meals.map(toHistoryItem);
}

export async function deleteMealRecord(analysisId: string): Promise<void> {
  await apiRequest('DELETE', `/api/meals/${id(analysisId)}`);
}

export async function discardMealAnalysis(analysisId: string): Promise<void> {
  await apiRequest('POST', `/api/meals/${id(analysisId)}/discard`, {});
}

export function getPendingMealEvaluation(): Promise<MealAnalysis | null> {
  return apiRequest('GET', '/api/meals/pending-legacy');
}

export async function saveAuditSnapshot(analysisId: string): Promise<void> {
  await apiRequest('POST', `/api/meals/${id(analysisId)}/audit-snapshot`, {});
}

export async function saveExcludedIngredients(analysisId: string, names: string[]): Promise<void> {
  await apiRequest('PUT', `/api/meals/${id(analysisId)}/excluded`, { names });
}

export async function saveConsumptionEvaluation(analysisId: string, percentages: Record<string, number>, complete: boolean): Promise<void> {
  await apiRequest('PUT', `/api/meals/${id(analysisId)}/consumption`, { percentages, complete });
}

export async function finishMealSession(mealSessionId: string): Promise<void> {
  if (!mealSessionId) throw new Error('缺少饭局标识');
  await apiRequest('POST', `/api/meal-sessions/${encodeURIComponent(mealSessionId)}/finish`, {});
}

export function getMealsInRange(participantCode: string, start: number, end: number): Promise<MealAnalysis[]> {
  const q = new URLSearchParams({ participantCode, start: String(start), end: String(end) });
  return apiRequest('GET', `/api/meals/range?${q}`);
}
