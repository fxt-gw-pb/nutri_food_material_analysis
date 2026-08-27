// 餐盘分析 service 的统一契约。
// mock 实现（mealService.mock.ts）与 CloudBase 实现（mealService.cloud.ts）都必须满足
// 此接口，由 mealService.ts 按 config.useCloud 选择其一对外导出。
// 任何一侧签名漂移都会在 type-check 时报错，从而保证两套实现始终对齐。

import {
  MealAnalysis,
  AnalysisStatus,
  TextureSelection,
  MealHistoryItem,
  MealType,
} from '../types/index';

export interface CreateMealAnalysisParams {
  imageUrl: string;
  imageFileId?: string;
}

export interface MealServiceApi {
  /** 上传餐盘图片，返回云存储 fileID 与可展示地址 */
  uploadMealImage(filePath: string): Promise<{ fileId: string; imageUrl: string }>;
  /** 创建一次分析任务，返回 analysisId */
  createMealAnalysis(params: CreateMealAnalysisParams): Promise<{ analysisId: string }>;
  /** 查询分析状态与进度（0–1） */
  getMealAnalysisStatus(
    analysisId: string,
  ): Promise<{ status: AnalysisStatus; progress: number }>;
  /** 读取完整分析结果 */
  getMealAnalysisResult(analysisId: string): Promise<MealAnalysis>;
  /** 保存用户在结果页改选的质构匹配项 */
  saveTextureSelections(analysisId: string, selections: TextureSelection[]): Promise<void>;
  /** 保存餐次（早餐 / 午餐 / 加餐…） */
  saveMealType(analysisId: string, mealType: MealType): Promise<void>;
  /** 获取历史记录列表（仅已完成的分析） */
  getMealHistory(): Promise<MealHistoryItem[]>;
  /** 删除一条分析记录（含云存储图片） */
  deleteMealRecord(analysisId: string): Promise<void>;
}
