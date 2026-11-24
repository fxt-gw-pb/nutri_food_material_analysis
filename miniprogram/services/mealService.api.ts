// 餐盘分析 service 的统一契约。
// mock 实现（mealService.mock.ts）与 CloudBase 实现（mealService.cloud.ts）都必须满足
// 此接口，由 mealService.ts 按 config.useCloud 选择其一对外导出。
// 任何一侧签名漂移都会在 type-check 时报错，从而保证两套实现始终对齐。

import { MealAnalysis, AnalysisStatus, MealHistoryItem, MealType } from '../types/index';

/** 状态轮询的返回值 */
export interface AnalysisProgress {
  status: AnalysisStatus;
  progress: number;
  /** 失败时走到了哪一步 */
  errorStage?: string;
  /** 失败原因原文 */
  errorMessage?: string;
}

export interface CreateMealAnalysisParams {
  imageUrl: string;
  imageFileId?: string;
  /** 用户选的餐盘直径（cm），估重的尺度基准 */
  plateDiameterCm: number;
  participantCode?: string;
  /** 当前饭局的标识；同一顿饭的多道菜共用。 */
  mealSessionId?: string;
}

export interface MealServiceApi {
  /** 上传餐盘图片，返回云存储 fileID 与可展示地址 */
  uploadMealImage(filePath: string): Promise<{ fileId: string; imageUrl: string }>;
  /** 创建一次分析任务，返回 analysisId */
  createMealAnalysis(params: CreateMealAnalysisParams): Promise<{ analysisId: string }>;
  /**
   * 查询分析状态与进度（0–1）。
   * status='failed' 时带上 errorStage / errorMessage，好让加载页直接显示失败原因，
   * 而不是笼统的一句「识别失败」——线上排查全靠这两个字段。
   */
  getMealAnalysisStatus(analysisId: string): Promise<AnalysisProgress>;
  /** 读取完整分析结果 */
  getMealAnalysisResult(analysisId: string): Promise<MealAnalysis>;
  /**
   * 保存用户在结果页逐食材手动改选的质构记录（识别食材名 → 记录 id）。
   * 整份覆盖：传空对象表示全部恢复自动匹配。
   */
  saveRecordSelections(analysisId: string, selections: Record<string, string>): Promise<void>;
  /** 保存餐次（早餐 / 午餐 / 加餐…） */
  saveMealType(analysisId: string, mealType: MealType): Promise<void>;
  getPendingMealEvaluation(): Promise<MealAnalysis | null>;
  saveExcludedIngredients(analysisId: string, names: string[]): Promise<void>;
  saveConsumptionEvaluation(analysisId: string, percentages: Record<string, number>, complete: boolean): Promise<void>;
  saveAuditSnapshot(analysisId: string): Promise<void>;
  /** 获取历史记录列表（仅已完成的分析） */
  getMealHistory(): Promise<MealHistoryItem[]>;
  /** 删除一条分析记录（含云存储图片） */
  deleteMealRecord(analysisId: string): Promise<void>;
  discardMealAnalysis(analysisId: string): Promise<void>;
  /** 结束当前饭局的拍摄阶段，饭后再逐条评估。 */
  finishMealSession(mealSessionId: string): Promise<void>;
}
