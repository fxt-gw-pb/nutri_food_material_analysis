// ============================================================================
// 餐盘分析 service —— CloudBase 实现。
//
// 通过 config.ts 的 useCloud=true 启用（见分发器 mealService.ts）。
// 启用前需在云开发控制台完成：
//   1) 部署云函数 analyzeMeal（cloudfunctions/analyzeMeal，右键「上传并部署：云端安装依赖」）；
//   2) 为该云函数配置环境变量 DASHSCOPE_API_KEY（换 Key 也在这里改，详见 README）；
//   3) 创建云数据库集合 meal_records，权限设为「仅创建者可读写」；
//   4) 开通云存储（图片存于 config.uploadDir 前缀下）。
// 详见 docs/cloudbase-integration.md。
// ============================================================================

import { MealAnalysis, AnalysisStatus, MealHistoryItem, MealType, Dish } from '../types/index';
import { resolveMeal } from '../utils/texture';
import { buildAuditSnapshot, buildConsumption, validateExcluded } from '../utils/evaluation';
import { CONFIG } from './config';
import { AnalysisProgress, CreateMealAnalysisParams } from './mealService.api';

const COLLECTION = 'meal_records';

// 数据库只存 status，进度按阶段映射给 analyzing 页展示。
const STATUS_PROGRESS: Record<AnalysisStatus, number> = {
  pending: 0.08,
  preprocessing: 0.25,
  recognizing: 0.6,
  completed: 1,
  failed: 1,
};

// 延迟取 db，避免模块加载期（wx.cloud.init 之前）触发云能力；取到后缓存复用，
// 不要每次查询都新建一个 database 实例。
let dbRef: DB.Database | null = null;
function db(): DB.Database {
  if (!dbRef) {
    dbRef = wx.cloud.database();
  }
  return dbRef;
}

/** meal_records 文档形状（落库结构见 docs/cloudbase-integration.md） */
interface AnyDoc {
  _id: string;
  imageFileId?: string;
  imageUrl: string;
  /** 拍照时选的餐盘直径（cm），估重的尺度基准 */
  plateDiameterCm?: number;
  status: AnalysisStatus;
  mealType?: MealType;
  modelName?: string;
  promptVersion?: string;
  // 旧版文档存的是 result.dishes 数组，读取时兼容取第一道。
  result?: { dish?: Dish | null; dishes?: Dish[] };
  selectedRecords?: Record<string, string>;
  excludedIngredients?: string[];
  evaluationStatus?: MealAnalysis['evaluationStatus'];
  consumption?: MealAnalysis['consumption'];
  auditSnapshot?: MealAnalysis['auditSnapshot'];
  errorStage?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

function docDish(doc: AnyDoc): Dish | null {
  if (doc.result?.dish) return doc.result.dish;
  const legacy = doc.result?.dishes;
  return legacy && legacy.length ? legacy[0] : null;
}

/** 云数据库文档 → 前端 MealAnalysis（dish 从 result.dish 提到顶层） */
function docToMealAnalysis(doc: AnyDoc): MealAnalysis {
  return {
    analysisId: doc._id,
    imageFileId: doc.imageFileId,
    imageUrl: doc.imageUrl,
    status: doc.status,
    mealType: doc.mealType,
    modelName: doc.modelName,
    promptVersion: doc.promptVersion,
    dish: docDish(doc),
    selectedRecords: doc.selectedRecords || {},
    excludedIngredients: doc.excludedIngredients || [],
    evaluationStatus: doc.evaluationStatus,
    consumption: doc.consumption,
    auditSnapshot: doc.auditSnapshot,
    plateDiameterCm: doc.plateDiameterCm,
    errorStage: doc.errorStage,
    errorMessage: doc.errorMessage,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function docToHistoryItem(doc: AnyDoc): MealHistoryItem {
  // 质构摘要在本地按同一套匹配规则现算，保证与详情页一致。
  const resolved = resolveMeal(docDish(doc), doc.selectedRecords, doc.plateDiameterCm, doc.excludedIngredients);
  return {
    analysisId: doc._id,
    date: doc.createdAt,
    mealType: doc.mealType,
    imageUrl: doc.imageUrl,
    dishName: resolved.recognizedName,
    matchedCount: resolved.matchedCount,
    totalCount: resolved.totalCount,
    ingredientText: resolved.ingredients.map((i) => i.name).join('、'),
    textureSummary: resolved.summary,
    totalG: resolved.totalG,
    evaluationStatus: doc.evaluationStatus,
    totalConsumedG: doc.consumption?.totalConsumedG,
  };
}

export function uploadMealImage(
  filePath: string,
): Promise<{ fileId: string; imageUrl: string }> {
  const ext = (filePath.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
  const cloudPath = `${CONFIG.uploadDir}${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  return wx.cloud
    .uploadFile({ cloudPath, filePath })
    // <image src> 可直接渲染 cloud:// fileID，故图片地址也用 fileID。
    .then((res) => ({ fileId: res.fileID, imageUrl: res.fileID }));
}

export function createMealAnalysis(
  params: CreateMealAnalysisParams,
): Promise<{ analysisId: string }> {
  // 第一步：建 pending 记录、秒回 analysisId。
  return wx.cloud
    .callFunction({
      name: CONFIG.analyzeFunctionName,
      data: {
        action: 'create',
        imageFileId: params.imageFileId,
        imageUrl: params.imageUrl,
        plateDiameterCm: params.plateDiameterCm,
      },
    })
    .then(async (res) => {
      const result = res.result as { analysisId?: string } | undefined;
      if (!result || !result.analysisId) {
        throw new Error('analyzeMeal 创建任务失败');
      }
      const analysisId = result.analysisId;
      await db().collection(COLLECTION).doc(analysisId).update({
        data: { evaluationStatus: 'pending', excludedIngredients: [], updatedAt: Date.now() },
      });
      // 第二步：触发后台识别（不 await；前端在 analyzing 页轮询 status 感知进度）。
      // 请求已发出后即使本页跳转，云函数仍会在服务端跑完。
      wx.cloud
        .callFunction({
          name: CONFIG.analyzeFunctionName,
          data: { action: 'process', analysisId },
        })
        .catch((err) => console.error('[mealService] 触发后台识别失败', err));
      return { analysisId };
    });
}

export function getMealAnalysisStatus(analysisId: string): Promise<AnalysisProgress> {
  return db()
    .collection(COLLECTION)
    .doc(analysisId)
    .get()
    .then((res) => {
      const doc = res.data as AnyDoc;
      return {
        status: doc.status,
        progress: STATUS_PROGRESS[doc.status] ?? 0,
        errorStage: doc.errorStage,
        errorMessage: doc.errorMessage,
      };
    });
}

export function getMealAnalysisResult(analysisId: string): Promise<MealAnalysis> {
  return db()
    .collection(COLLECTION)
    .doc(analysisId)
    .get()
    .then((res) => docToMealAnalysis(res.data as AnyDoc));
}

export function saveRecordSelections(
  analysisId: string,
  selections: Record<string, string>,
): Promise<void> {
  // 必须用 command.set 整份替换：直接传对象会被 CloudBase 拍平成
  // selectedRecords.<食材名> 的点路径去**合并**，那样「恢复自动匹配」删掉的键
  // 根本不会从库里消失，用户会发现撤销改选没生效。
  return db()
    .collection(COLLECTION)
    .doc(analysisId)
    .update({
      data: { selectedRecords: db().command.set(selections), updatedAt: Date.now() },
    })
    .then(() => undefined);
}

export function saveMealType(analysisId: string, mealType: MealType): Promise<void> {
  return db()
    .collection(COLLECTION)
    .doc(analysisId)
    .update({ data: { mealType, updatedAt: Date.now() } })
    .then(() => undefined);
}

export function getMealHistory(): Promise<MealHistoryItem[]> {
  return db()
    .collection(COLLECTION)
    .where({ status: 'completed' })
    .orderBy('createdAt', 'desc')
    // 每条记录都要在本地重跑一次质构匹配，不设上限会让历史页越用越卡。
    .limit(30)
    .get()
    .then((res) => (res.data as AnyDoc[]).map(docToHistoryItem));
}

export function deleteMealRecord(analysisId: string): Promise<void> {
  const docRef = db().collection(COLLECTION).doc(analysisId);
  return docRef.get().then((res) => {
    const fileId = (res.data as AnyDoc).imageFileId;
    const ops: Promise<unknown>[] = [docRef.remove()];
    if (fileId) {
      ops.push(wx.cloud.deleteFile({ fileList: [fileId] }));
    }
    return Promise.all(ops).then(() => undefined);
  });
}

export async function getPendingMealEvaluation(): Promise<MealAnalysis | null> {
  // 只检索新版的待评记录；不从最近 30 条历史猜测，也不要求老记录补评。
  const res = await db().collection(COLLECTION)
    .where({ evaluationStatus: 'pending', status: 'completed' }).limit(1).get();
  return res.data.length ? docToMealAnalysis(res.data[0] as AnyDoc) : null;
}

export async function saveAuditSnapshot(analysisId: string): Promise<void> {
  const meal = await getMealAnalysisResult(analysisId);
  await db().collection(COLLECTION).doc(analysisId).update({
    data: { auditSnapshot: db().command.set(buildAuditSnapshot(meal)) },
  });
}

export async function saveExcludedIngredients(analysisId: string, names: string[]): Promise<void> {
  const meal = await getMealAnalysisResult(analysisId);
  meal.excludedIngredients = validateExcluded(meal, names);
  const empty = resolveMeal(meal.dish, meal.selectedRecords, meal.plateDiameterCm, meal.excludedIngredients).totalCount === 0;
  const complete = empty || meal.evaluationStatus === 'completed';
  const consumption = buildConsumption(meal, meal.consumption?.percentages || {}, complete);
  await db().collection(COLLECTION).doc(analysisId).update({ data: {
    excludedIngredients: meal.excludedIngredients,
    consumption: db().command.set(consumption),
    evaluationStatus: complete ? 'completed' : 'pending',
    auditSnapshot: db().command.set(buildAuditSnapshot(meal)), updatedAt: Date.now(),
  } });
}

export async function saveConsumptionEvaluation(analysisId: string, percentages: Record<string, number>, complete: boolean): Promise<void> {
  const meal = await getMealAnalysisResult(analysisId);
  if (!complete && meal.evaluationStatus === 'completed') throw new Error('这餐已评估完成，请重新打开页面');
  if (meal.status !== 'completed') throw new Error('请等待识别完成');
  const consumption = buildConsumption(meal, percentages, complete);
  await db().collection(COLLECTION).doc(analysisId).update({ data: {
    consumption: db().command.set(consumption), evaluationStatus: complete ? 'completed' : 'pending',
    auditSnapshot: db().command.set(buildAuditSnapshot(meal)), updatedAt: Date.now(),
  } });
}
