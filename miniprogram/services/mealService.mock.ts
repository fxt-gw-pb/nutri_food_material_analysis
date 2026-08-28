// ============================================================================
// 餐盘分析 service —— mock 实现。
//
// 全部读写本地 Storage，模拟后端异步识别与持久化（不调用任何模型）。
// 通过 config.ts 的 useCloud=false 启用（见分发器 mealService.ts）。
// 真实实现见 mealService.cloud.ts。
//
// 注意：质构匹配在两种模式下完全一致（本地 textureMatch，逐食材匹配），
// mock 只负责伪造「视觉模型识别出的菜名与全部食材」。
// ============================================================================

import { MealAnalysis, AnalysisStatus, MealHistoryItem, MealType, Dish } from '../types/index';
import { CreateMealAnalysisParams } from './mealService.api';
import { MOCK_DISHES } from '../mock/dishes';
import { buildSeedHistory } from '../mock/history';
import { resolveMeal } from '../utils/texture';
import { safeGet, safeSet } from '../utils/storage';

const STORAGE_KEY = 'meal_records_v3';
const SEEDED_KEY = 'meal_seeded_v3';
/** 模拟识别总时长（毫秒），用于推进状态机 */
const MOCK_ANALYZE_DURATION = 3000;

// ----------------------------------------------------------------------------
// 本地存储辅助（mock 阶段充当“数据库”）
// ----------------------------------------------------------------------------

function loadRecords(): MealAnalysis[] {
  const raw = safeGet<MealAnalysis[] | null>(STORAGE_KEY, null);
  if (Array.isArray(raw)) {
    return raw;
  }
  // 首次启动注入示例历史；删除后不再重复注入。
  if (!safeGet<boolean>(SEEDED_KEY, false)) {
    const seed = buildSeedHistory();
    saveRecords(seed);
    safeSet(SEEDED_KEY, true);
    return seed;
  }
  return [];
}

function saveRecords(list: MealAnalysis[]): void {
  safeSet(STORAGE_KEY, list);
}

function findRecord(analysisId: string): MealAnalysis | undefined {
  return loadRecords().find((r) => r.analysisId === analysisId);
}

function upsertRecord(record: MealAnalysis): void {
  const list = loadRecords();
  const idx = list.findIndex((r) => r.analysisId === record.analysisId);
  if (idx >= 0) {
    list[idx] = record;
  } else {
    list.unshift(record);
  }
  saveRecords(list);
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function pickMockDish(): Dish {
  const idx = loadRecords().length % MOCK_DISHES.length;
  // 深拷贝，避免多条记录共享同一引用。
  return JSON.parse(JSON.stringify(MOCK_DISHES[idx])) as Dish;
}

function mapProgressToStatus(ratio: number): AnalysisStatus {
  if (ratio < 0.25) return 'preprocessing';
  if (ratio < 1) return 'recognizing';
  return 'completed';
}

// ----------------------------------------------------------------------------
// 对外 service 接口
// ----------------------------------------------------------------------------

export function uploadMealImage(filePath: string): Promise<{ fileId: string; imageUrl: string }> {
  return Promise.resolve({ fileId: '', imageUrl: filePath });
}

export function createMealAnalysis(
  params: CreateMealAnalysisParams,
): Promise<{ analysisId: string }> {
  const now = Date.now();
  const record: MealAnalysis = {
    analysisId: genId('meal'),
    imageFileId: params.imageFileId,
    imageUrl: params.imageUrl,
    status: 'pending',
    modelName: 'qwen-vl-mock',
    promptVersion: 'mock-v0',
    dish: pickMockDish(),
    createdAt: now,
    updatedAt: now,
    mockStartedAt: now,
  };
  upsertRecord(record);
  return Promise.resolve({ analysisId: record.analysisId });
}

export function getMealAnalysisStatus(
  analysisId: string,
): Promise<{ status: AnalysisStatus; progress: number }> {
  const rec = findRecord(analysisId);
  if (!rec) {
    return Promise.reject(new Error('analysis not found'));
  }
  if (rec.status === 'completed' || rec.status === 'failed') {
    return Promise.resolve({ status: rec.status, progress: 1 });
  }
  const elapsed = Date.now() - (rec.mockStartedAt ?? rec.createdAt);
  const progress = Math.min(elapsed / MOCK_ANALYZE_DURATION, 1);
  const status = mapProgressToStatus(progress);
  if (status === 'completed') {
    rec.status = 'completed';
    rec.updatedAt = Date.now();
    upsertRecord(rec);
  }
  return Promise.resolve({ status, progress });
}

export function getMealAnalysisResult(analysisId: string): Promise<MealAnalysis> {
  const rec = findRecord(analysisId);
  if (!rec) {
    return Promise.reject(new Error('analysis not found'));
  }
  return Promise.resolve(rec);
}

export function saveRecordSelections(
  analysisId: string,
  selections: Record<string, string>,
): Promise<void> {
  const rec = findRecord(analysisId);
  if (!rec) {
    return Promise.reject(new Error('analysis not found'));
  }
  rec.selectedRecords = selections;
  rec.updatedAt = Date.now();
  upsertRecord(rec);
  return Promise.resolve();
}

export function saveMealType(analysisId: string, mealType: MealType): Promise<void> {
  const rec = findRecord(analysisId);
  if (!rec) {
    return Promise.reject(new Error('analysis not found'));
  }
  rec.mealType = mealType;
  rec.updatedAt = Date.now();
  upsertRecord(rec);
  return Promise.resolve();
}

export function getMealHistory(): Promise<MealHistoryItem[]> {
  const items = loadRecords()
    .filter((r) => r.status === 'completed')
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toHistoryItem);
  return Promise.resolve(items);
}

export function deleteMealRecord(analysisId: string): Promise<void> {
  const list = loadRecords().filter((r) => r.analysisId !== analysisId);
  saveRecords(list);
  return Promise.resolve();
}

function toHistoryItem(rec: MealAnalysis): MealHistoryItem {
  const resolved = resolveMeal(rec.dish, rec.selectedRecords);
  return {
    analysisId: rec.analysisId,
    date: rec.createdAt,
    mealType: rec.mealType,
    imageUrl: rec.imageUrl,
    dishName: resolved.recognizedName,
    matchedCount: resolved.matchedCount,
    totalCount: resolved.totalCount,
    ingredientText: resolved.ingredients.map((i) => i.name).join('、'),
    textureSummary: resolved.summary,
  };
}
