// 识别记录接口：逐条对应 miniprogram/services/mealService.cloud.ts 的每个函数，业务规则保持一致。
// 饭后评估、审计快照、摄入汇总在这里用小程序同一份 utils/evaluation.ts 计算后落库。
import crypto from 'node:crypto';
import { actorKey, assertCode, canAccessCode, normalizeCode, Session } from './auth';
import { Doc, Store } from './db';
import { HttpError } from './http';
import { Images } from './images';
import { modelFields, qrCardAvailable, REFERENCE_CARD_CM, VisionQueue } from './vision';
import type { AnalysisStatus, Dish, MealAnalysis, MealType } from '../../miniprogram/types/index';
import { resolveMeal } from '../../miniprogram/utils/texture';
import { buildAuditSnapshot, buildConsumption, validateExcluded } from '../../miniprogram/utils/evaluation';
import { MEAL_TYPE_OPTIONS } from '../../miniprogram/utils/format';

const STATUS_PROGRESS: Record<AnalysisStatus, number> = {
  pending: 0.08, preprocessing: 0.25, recognizing: 0.6, completed: 1, discarded: 1, failed: 1,
};
const MEAL_TYPES = new Set<string>(MEAL_TYPE_OPTIONS.map((o) => o.type));
/** 每个身份每小时最多发起的识别次数，防止误操作或链接外泄后刷接口额度。 */
const CREATE_LIMIT_PER_HOUR = 80;

function docDish(doc: Doc): Dish | null {
  const result = (doc.result || {}) as { dish?: Dish | null; dishes?: Dish[] };
  if (result.dish) return result.dish;
  return result.dishes && result.dishes.length ? result.dishes[0] : null;
}

/** 文档 → 前端 MealAnalysis（与 mealService.cloud.ts 的 docToMealAnalysis 相同） */
export function docToMealAnalysis(doc: Doc): MealAnalysis {
  const d = doc as Record<string, unknown>;
  return {
    analysisId: doc._id,
    mealSessionId: d.mealSessionId as string | undefined,
    mealSessionFinishedAt: d.mealSessionFinishedAt as number | undefined,
    imageFileId: d.imageFileId as string | undefined,
    imageUrl: d.imageUrl as string,
    participantCode: d.participantCode as string | undefined,
    discardedAt: d.discardedAt as number | undefined,
    status: d.status as AnalysisStatus,
    mealType: d.mealType as MealType | undefined,
    modelName: d.modelName as string | undefined,
    promptVersion: d.promptVersion as string | undefined,
    dish: docDish(doc),
    selectedRecords: (d.selectedRecords as Record<string, string>) || {},
    excludedIngredients: (d.excludedIngredients as string[]) || [],
    evaluationStatus: d.evaluationStatus as MealAnalysis['evaluationStatus'],
    consumption: d.consumption as MealAnalysis['consumption'],
    auditSnapshot: d.auditSnapshot as MealAnalysis['auditSnapshot'],
    plateDiameterCm: d.plateDiameterCm as number | undefined,
    scaleMode: d.scaleMode as MealAnalysis['scaleMode'],
    plateDiameterSource: d.plateDiameterSource as MealAnalysis['plateDiameterSource'],
    referenceCardVisible: d.referenceCardVisible as boolean | undefined,
    errorStage: d.errorStage as string | undefined,
    errorMessage: d.errorMessage as string | undefined,
    createdAt: d.createdAt as number,
    updatedAt: d.updatedAt as number,
  };
}

export class Meals {
  private createLog = new Map<string, number[]>();

  constructor(private store: Store, private images: Images, private queue: VisionQueue, private mock: boolean) {}

  /** 读取一条本人有权访问的记录；无权时与不存在一样返回 404，不泄露记录是否存在。 */
  private load(session: Session, id: string): Doc {
    const doc = /^[a-f0-9]{32}$/.test(id) ? this.store.getMeal(id) : null;
    if (!doc || !canAccessCode(session, String(doc.participantCode || ''))) throw new HttpError(404, '记录不存在或无权查看', 'NOT_FOUND');
    return doc;
  }

  private scope(session: Session): { where: string; params: string[] } {
    return session.role === 'researcher' ? { where: '1 = 1', params: [] } : { where: 'participantCode = ?', params: [String(session.participantCode)] };
  }

  private rateLimit(session: Session): void {
    const key = actorKey(session);
    const now = Date.now();
    const recent = (this.createLog.get(key) || []).filter((t) => now - t < 3600 * 1000);
    if (recent.length >= CREATE_LIMIT_PER_HOUR) throw new HttpError(429, '识别次数过多，请稍后再试', 'RATE_LIMITED');
    recent.push(now);
    this.createLog.set(key, recent);
  }

  create(session: Session, body: Record<string, unknown>): { analysisId: string } {
    const participantCode = normalizeCode(body.participantCode);
    assertCode(session, participantCode);
    const imageFileId = typeof body.imageFileId === 'string' ? body.imageFileId : '';
    const mealSessionId = typeof body.mealSessionId === 'string' ? body.mealSessionId.trim().slice(0, 80) : '';
    this.rateLimit(session);
    this.images.attach(session, imageFileId, participantCode);
    const qrCard = body.scaleMode === 'qr-card' && qrCardAvailable(this.mock);
    const now = Date.now();
    const id = crypto.randomBytes(16).toString('hex');
    const doc: Doc = {
      _id: id,
      _openid: actorKey(session),
      source: 'web',
      imageFileId,
      imageUrl: `/api/images/${imageFileId}`,
      participantCode,
      mealSessionId,
      // 估重的尺度基准。没传就按 26cm 家用菜盘兜底；二维码卡片模式识别后再写入量出的盘径（与云函数一致）。
      ...(qrCard
        ? { scaleMode: 'qr-card', referenceCardCm: REFERENCE_CARD_CM }
        : { scaleMode: 'plate', plateDiameterSource: 'user', plateDiameterCm: Number(body.plateDiameterCm) > 0 ? Number(body.plateDiameterCm) : 26 }),
      status: 'pending',
      ...modelFields(this.mock, qrCard),
      result: { dish: null },
      selectedRecords: {},
      errorStage: '',
      errorMessage: '',
      evaluationStatus: 'pending',
      excludedIngredients: [],
      createdAt: now,
      updatedAt: now,
    };
    this.store.putMeal(doc);
    this.queue.enqueue(id);
    return { analysisId: id };
  }

  status(session: Session, id: string) {
    const doc = this.load(session, id);
    const status = doc.status as AnalysisStatus;
    return { status, progress: STATUS_PROGRESS[status] ?? 0, errorStage: doc.errorStage, errorMessage: doc.errorMessage };
  }

  result(session: Session, id: string): MealAnalysis {
    return docToMealAnalysis(this.load(session, id));
  }

  saveSelections(session: Session, id: string, body: Record<string, unknown>): void {
    this.load(session, id);
    const input = body.selections;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '改选数据格式有误');
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length > 20 || entries.some(([k, v]) => typeof v !== 'string' || k.length > 60 || (v as string).length > 80)) {
      throw new HttpError(400, '改选数据格式有误');
    }
    // 整份替换（等同 CloudBase 的 db.command.set），撤销改选删掉的键不会残留。
    this.store.updateMeal(id, (doc) => { doc.selectedRecords = Object.fromEntries(entries); doc.updatedAt = Date.now(); });
  }

  saveMealType(session: Session, id: string, body: Record<string, unknown>): void {
    this.load(session, id);
    if (typeof body.mealType !== 'string' || !MEAL_TYPES.has(body.mealType)) throw new HttpError(400, '餐次无效');
    this.store.updateMeal(id, (doc) => { doc.mealType = body.mealType; doc.updatedAt = Date.now(); });
  }

  history(session: Session): MealAnalysis[] {
    const s = this.scope(session);
    // 与小程序一致：只看已完成的识别，最近 30 条。
    return this.store.queryMeals(`${s.where} AND status = 'completed'`, s.params, 'createdAt DESC', 60).map(docToMealAnalysis);
  }

  remove(session: Session, id: string): void {
    const doc = this.load(session, id);
    this.store.deleteMeal(id);
    if (doc.imageFileId) this.images.removeIfUnused(String(doc.imageFileId));
  }

  discard(session: Session, id: string): void {
    const doc = this.load(session, id);
    if (doc.status === 'discarded') return;
    // 只作废已结束的识别，避免后台随后完成并覆盖作废状态。
    if (doc.status !== 'completed' && doc.status !== 'failed') throw new HttpError(409, '请等待识别结束后重拍', 'NOT_FINISHED');
    const now = Date.now();
    this.store.updateMeal(id, (d) => { d.status = 'discarded'; d.evaluationStatus = 'discarded'; d.discardedAt = now; d.updatedAt = now; });
  }

  pendingLegacy(session: Session): MealAnalysis | null {
    const s = this.scope(session);
    const found = this.store.queryMeals(`${s.where} AND evaluationStatus = 'pending' AND status = 'completed' AND mealSessionId = ''`, s.params, 'createdAt DESC', 1);
    return found.length ? docToMealAnalysis(found[0]) : null;
  }

  saveAuditSnapshot(session: Session, id: string): void {
    const meal = docToMealAnalysis(this.load(session, id));
    const snapshot = buildAuditSnapshot(meal);
    this.store.updateMeal(id, (doc) => { doc.auditSnapshot = snapshot; });
  }

  saveExcluded(session: Session, id: string, body: Record<string, unknown>): void {
    const meal = docToMealAnalysis(this.load(session, id));
    if (meal.status === 'discarded') throw new HttpError(409, '这条识别已作废，请重新拍照', 'DISCARDED');
    const names = Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === 'string') : null;
    if (!names) throw new HttpError(400, '食材列表格式有误');
    meal.excludedIngredients = validateExcluded(meal, names);
    const empty = resolveMeal(meal.dish, meal.selectedRecords, meal.plateDiameterCm, meal.excludedIngredients).totalCount === 0;
    const complete = empty || meal.evaluationStatus === 'completed';
    const consumption = this.consumption(meal, meal.consumption?.percentages || {}, complete);
    const snapshot = buildAuditSnapshot(meal);
    this.store.updateMeal(id, (doc) => {
      doc.excludedIngredients = meal.excludedIngredients;
      doc.consumption = consumption;
      doc.evaluationStatus = complete ? 'completed' : 'pending';
      doc.auditSnapshot = snapshot;
      doc.updatedAt = Date.now();
    });
  }

  saveConsumption(session: Session, id: string, body: Record<string, unknown>): void {
    const meal = docToMealAnalysis(this.load(session, id));
    const complete = body.complete === true;
    const percentages = body.percentages;
    if (!percentages || typeof percentages !== 'object' || Array.isArray(percentages)) throw new HttpError(400, '食用比例格式有误');
    if (meal.status === 'discarded') throw new HttpError(409, '这条识别已作废，请重新拍照', 'DISCARDED');
    if (!complete && meal.evaluationStatus === 'completed') throw new HttpError(409, '这餐已评估完成，请重新打开页面', 'ALREADY_COMPLETED');
    if (meal.status !== 'completed') throw new HttpError(409, '请等待识别完成', 'NOT_FINISHED');
    const consumption = this.consumption(meal, percentages as Record<string, number>, complete);
    const snapshot = buildAuditSnapshot(meal);
    this.store.updateMeal(id, (doc) => {
      doc.consumption = consumption;
      doc.evaluationStatus = complete ? 'completed' : 'pending';
      doc.auditSnapshot = snapshot;
      doc.updatedAt = Date.now();
    });
  }

  private consumption(meal: MealAnalysis, percentages: Record<string, number>, complete: boolean) {
    try {
      return buildConsumption(meal, percentages, complete);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : '食用比例无效', 'INVALID_INPUT');
    }
  }

  finishSession(session: Session, mealSessionId: string): void {
    const id = mealSessionId.trim();
    if (!id || id.length > 80) throw new HttpError(400, '缺少饭局标识');
    const s = this.scope(session);
    const records = this.store.queryMeals(`${s.where} AND mealSessionId = ? AND status = 'completed'`, [...s.params, id], 'createdAt ASC', 200);
    if (!records.length) throw new HttpError(404, '没有找到这顿饭的识别记录', 'NOT_FOUND');
    const now = Date.now();
    this.store.tx(() => {
      for (const doc of records) {
        const latest = this.store.getMeal(doc._id);
        if (!latest) continue;
        latest.mealSessionFinishedAt = now;
        latest.updatedAt = now;
        this.store.putMeal(latest);
      }
    });
  }

  range(session: Session, query: URLSearchParams): MealAnalysis[] {
    const code = normalizeCode(query.get('participantCode') || '');
    assertCode(session, code);
    const start = Number(query.get('start'));
    const end = Number(query.get('end'));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || end - start > 40 * 86400000) {
      throw new HttpError(400, '时间范围无效');
    }
    return this.store.queryMeals("participantCode = ? AND status = 'completed' AND createdAt >= ? AND createdAt < ?", [code, start, end], 'createdAt ASC', 300)
      .map(docToMealAnalysis);
  }
}
