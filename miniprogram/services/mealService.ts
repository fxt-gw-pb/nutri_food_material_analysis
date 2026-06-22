// ============================================================================
// 餐盘分析 service 层（可替换实现）。
//
// 当前阶段：全部返回 mock 数据 / 读写本地 Storage，模拟后端异步分析与持久化。
// 接入 CloudBase 时：保持下列函数签名不变，仅替换函数内部实现即可。
//   uploadMealImage        -> wx.cloud.uploadFile(...)
//   createMealAnalysis     -> wx.cloud.callFunction({ name: 'analyzeMeal', ... })
//   getMealAnalysisStatus  -> 查询 meal_records.status / 监听 watch
//   getMealAnalysisResult  -> 查询 meal_records 文档
//   saveDishConsumption    -> 更新 meal_records.consumptions
//   getMealHistory         -> 查询 meal_records 列表
//   deleteMealRecord       -> 删除 meal_records 文档（及云存储图片）
// 详见 docs/cloudbase-integration.md。
// ============================================================================

import {
  MealAnalysis,
  AnalysisStatus,
  ConsumptionRecord,
  MealHistoryItem,
  Dish,
} from '../types/index';
import { MOCK_DISH_SETS } from '../mock/dishes';
import { buildSeedHistory } from '../mock/history';
import { totalConsumedG } from '../utils/weight';
import { safeGet, safeSet } from '../utils/storage';

const STORAGE_KEY = 'meal_records_v1';
const SEEDED_KEY = 'meal_seeded_v1';
/** 模拟分析总时长（毫秒），用于推进状态机 */
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

function pickMockDishes(): Dish[] {
  const idx = loadRecords().length % MOCK_DISH_SETS.length;
  // 深拷贝，避免多条记录共享同一引用。
  return JSON.parse(JSON.stringify(MOCK_DISH_SETS[idx])) as Dish[];
}

function mapProgressToStatus(ratio: number): AnalysisStatus {
  if (ratio < 0.15) return 'preprocessing';
  if (ratio < 0.45) return 'stage_1_recognition';
  if (ratio < 0.65) return 'geometry_analysis';
  if (ratio < 1) return 'stage_2_weight_estimation';
  return 'completed';
}

// ----------------------------------------------------------------------------
// 对外 service 接口
// ----------------------------------------------------------------------------

/**
 * 上传餐盘图片。
 * mock：直接把本地临时路径当作可访问地址返回。
 * CloudBase：改为 wx.cloud.uploadFile，返回 fileID 与临时 URL。
 */
export function uploadMealImage(filePath: string): Promise<{ fileId: string; imageUrl: string }> {
  return Promise.resolve({ fileId: '', imageUrl: filePath });
}

export interface CreateMealAnalysisParams {
  imageUrl: string;
  imageFileId?: string;
  plateDiameterCm: number;
}

/**
 * 创建一次分析任务。
 * mock：立即生成结果并落地为 pending 记录，由 getMealAnalysisStatus 模拟推进。
 * CloudBase：改为调用云函数 analyzeMeal，由其异步写入 meal_records。
 */
export function createMealAnalysis(params: CreateMealAnalysisParams): Promise<{ analysisId: string }> {
  const now = Date.now();
  const record: MealAnalysis = {
    analysisId: genId('meal'),
    imageFileId: params.imageFileId,
    imageUrl: params.imageUrl,
    plateDiameterCm: params.plateDiameterCm,
    status: 'pending',
    modelName: 'qwen-vl-mock',
    promptVersion: 'mock-v0',
    dishes: pickMockDishes(),
    consumptions: [],
    createdAt: now,
    updatedAt: now,
    mockStartedAt: now,
  };
  upsertRecord(record);
  return Promise.resolve({ analysisId: record.analysisId });
}

/**
 * 查询分析状态。
 * mock：根据创建后经过的时间推进状态机。
 */
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

/** 读取分析结果（完整记录） */
export function getMealAnalysisResult(analysisId: string): Promise<MealAnalysis> {
  const rec = findRecord(analysisId);
  if (!rec) {
    return Promise.reject(new Error('analysis not found'));
  }
  return Promise.resolve(rec);
}

/** 保存某次分析下所有菜品的食用比例选择 */
export function saveDishConsumption(
  analysisId: string,
  records: ConsumptionRecord[],
): Promise<void> {
  const rec = findRecord(analysisId);
  if (!rec) {
    return Promise.reject(new Error('analysis not found'));
  }
  rec.consumptions = records;
  rec.updatedAt = Date.now();
  upsertRecord(rec);
  return Promise.resolve();
}

/** 获取历史记录列表（仅已完成的分析） */
export function getMealHistory(): Promise<MealHistoryItem[]> {
  const items = loadRecords()
    .filter((r) => r.status === 'completed')
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toHistoryItem);
  return Promise.resolve(items);
}

/** 删除一条分析记录（CloudBase 阶段需同时删除云存储图片） */
export function deleteMealRecord(analysisId: string): Promise<void> {
  const list = loadRecords().filter((r) => r.analysisId !== analysisId);
  saveRecords(list);
  return Promise.resolve();
}

function toHistoryItem(rec: MealAnalysis): MealHistoryItem {
  return {
    analysisId: rec.analysisId,
    date: rec.createdAt,
    imageUrl: rec.imageUrl,
    dishSummary: rec.dishes.map((d) => d.dishName).join('、'),
    dishCount: rec.dishes.length,
    totalEstimatedG: rec.dishes.reduce((s, d) => s + d.estimatedTotalG, 0),
    consumedG: totalConsumedG(rec.consumptions),
    ratio: rec.consumptions[0]?.ratio,
  };
}
