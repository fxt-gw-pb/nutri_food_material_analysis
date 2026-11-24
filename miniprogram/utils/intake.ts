// ============================================================================
// 摄入汇总：质量加权的 TPA 切割质构系数 + 营养素摄入量（纯本地计算）。
//
// 质构（按 1124《切割质构系数_质量加权计算说明》）：
//   加权质构系数 = Σ(各食物摄入质量 × 切割实验质构参数) ÷ Σ(各食物摄入质量)
//   - 只用「切割测试」的读数；某种食材只有下压测试数据时，它不进入切割系数；
//   - 缺失值不当作 0，分母也排除这部分质量（每项指标各自计算分母）；
//   - 全天不平均各餐的结果，而是把当天所有餐次的食物放在一起重新加权。
// 营养：摄入质量 × 折算系数（可食部、干湿）× 每 100 g 含量 ÷ 100，逐项相加。
//   原书未检测（—）的营养素不当作 0，只是不累加，页面标注「部分食物无此项数据」。
//
// 摄入质量 = 饭后评估填写的比例 × 拍照估重，即 consumption.consumedGrams。
// 「一天」按北京时间（UTC+08:00）的自然日，以拍照时间 createdAt 为准；
// 「一餐」是同一天、同一餐次（早餐 / 午餐…）的所有菜。
// ============================================================================

import { MealAnalysis, MealType, StoredIntake } from '../types/index';
import { TextureMetrics, TextureRecord, findRecordById, hardnessLabel, chewinessLabel } from '../data/textureDb';
import { alternateTestModes } from '../services/textureMatch';
import { NUTRIENTS, NutrientKey } from '../data/nutritionDb';
import { matchNutrition } from '../services/nutritionMatch';
import { resolveMeal } from './texture';
import { MEAL_TYPE_OPTIONS } from './format';

export const INTAKE_ALGORITHM_VERSION = 'intake-2026-11-24';

export type CutMetricKey = Exclude<keyof TextureMetrics, 'heightMm'>;

/** 参与加权的切割质构指标（样品高度不是质构性质，不加权） */
export const CUT_METRICS: { key: CutMetricKey; label: string; unit: string; digits: number }[] = [
  { key: 'hardness', label: '硬度', unit: 'gf', digits: 1 },
  { key: 'fracturability', label: '脆度', unit: 'gf', digits: 1 },
  { key: 'adhesiveness', label: '黏着性', unit: 'gf·s', digits: 2 },
  { key: 'springiness', label: '弹性', unit: '', digits: 3 },
  { key: 'chewiness', label: '咀嚼性', unit: 'gf', digits: 1 },
  { key: 'gumminess', label: '胶着性', unit: 'gf', digits: 1 },
  { key: 'cohesiveness', label: '内聚性', unit: '', digits: 3 },
  { key: 'resilience', label: '回复性', unit: '', digits: 3 },
];

/** 一种食材的实际摄入 */
export interface IntakeItem {
  analysisId: string;
  dishName: string;
  name: string;
  consumedG: number;
  /** 切割测试记录；该食材没有切割数据时为 null */
  cut: TextureRecord | null;
  nutritionCode: string;
  nutritionName: string;
  nutritionReason: string;
  /** 实际摄入的各营养素量；原书未检测的营养素不出现在这里 */
  nutrients: Partial<Record<NutrientKey, number>>;
}

/** 某项指标的加权结果 */
export interface WeightedMetric {
  key: CutMetricKey;
  label: string;
  unit: string;
  /** 加权平均值；没有任何有效数据时为 null */
  value: number | null;
  valueText: string;
  /** 进入这项指标分母的摄入质量（g） */
  grams: number;
}

export interface NutrientTotal {
  key: NutrientKey;
  label: string;
  unit: string;
  value: number;
  valueText: string;
  /** 已匹配食物里有缺测（—）的，合计偏低 */
  incomplete: boolean;
  main: boolean;
}

export interface IntakeSummary {
  /** 全部已评估食材的摄入质量（g） */
  consumedG: number;
  texture: WeightedMetric[];
  hardness: WeightedMetric;
  /** 硬度档位文案，如「偏软」；没有数据时为空串 */
  hardnessText: string;
  chewinessText: string;
  /** 有切割硬度数据的摄入质量（g） */
  textureG: number;
  nutrients: NutrientTotal[];
  energyKcal: number;
  /** 匹配到成分表的摄入质量（g） */
  nutritionG: number;
  /** 没有切割数据的食材（去重） */
  noTexture: string[];
  /** 没有匹配到成分表的食材（去重） */
  noNutrition: string[];
}

function round(v: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

function fmt(v: number, digits: number): string {
  return String(round(v, digits));
}

/** 取一条质构记录对应的切割测试记录：本身就是切割测试，或同菜同食材的切割那一条 */
export function cutRecordOf(recordId: string): TextureRecord | null {
  const rec = recordId ? findRecordById(recordId) : undefined;
  if (!rec) return null;
  if (rec.testMode === '切割测试') return rec;
  return alternateTestModes(rec.id).find((r) => r.testMode === '切割测试') || null;
}

/**
 * 一道菜的逐食材摄入。
 * @param consumedGrams 食材名 → 摄入克数；不传则用记录里已保存的评估
 */
export function dishIntakeItems(meal: MealAnalysis, consumedGrams?: Record<string, number>): IntakeItem[] {
  const grams = consumedGrams || (meal.consumption && meal.consumption.consumedGrams) || {};
  const resolved = resolveMeal(meal.dish, meal.selectedRecords, meal.plateDiameterCm, meal.excludedIngredients);
  const items: IntakeItem[] = [];
  resolved.ingredients.forEach((row) => {
    const g = grams[row.name];
    if (typeof g !== 'number' || !isFinite(g) || g < 0) return;
    const match = matchNutrition(row.name, row.matchedIngredient || undefined);
    const nutrients: Partial<Record<NutrientKey, number>> = {};
    if (match.food) {
      const base = g * match.factor;
      NUTRIENTS.forEach(({ key }) => {
        const per100 = match.food!.per100g[key];
        if (per100 !== null) nutrients[key] = (base * per100) / 100;
      });
    }
    items.push({
      analysisId: meal.analysisId,
      dishName: resolved.recognizedName,
      name: row.name,
      consumedG: g,
      cut: cutRecordOf(row.recordId),
      nutritionCode: match.food ? match.food.code : '',
      nutritionName: match.food ? match.food.name : '',
      nutritionReason: match.reason,
      nutrients,
    });
  });
  return items;
}

/** 把一组食材（一道菜、一餐或一天）汇总成加权质构与营养合计 */
export function summarizeIntake(items: IntakeItem[]): IntakeSummary {
  const texture: WeightedMetric[] = CUT_METRICS.map(({ key, label, unit, digits }) => {
    let num = 0;
    let den = 0;
    items.forEach((it) => {
      const v = it.cut ? it.cut.metrics[key] : null;
      if (v === null || v === undefined || it.consumedG <= 0) return;
      num += it.consumedG * v;
      den += it.consumedG;
    });
    const value = den > 0 ? num / den : null;
    return { key, label, unit, value, valueText: value === null ? '—' : fmt(value, digits), grams: round(den, 1) };
  });
  const hardness = texture[0];
  const chew = texture.find((t) => t.key === 'chewiness')!;
  const matched = items.filter((it) => it.nutritionCode);
  const nutrients: NutrientTotal[] = NUTRIENTS.map(({ key, label, unit, digits, main }) => {
    let value = 0;
    let incomplete = false;
    matched.forEach((it) => {
      const v = it.nutrients[key];
      if (v === undefined) { if (it.consumedG > 0) incomplete = true; } else value += v;
    });
    return { key, label, unit, value: round(value, digits + 1), valueText: fmt(value, digits), incomplete, main: !!main };
  });
  const unique = (list: string[]) => list.filter((n, i) => list.indexOf(n) === i);
  return {
    consumedG: round(items.reduce((s, it) => s + it.consumedG, 0), 1),
    texture,
    hardness,
    hardnessText: hardness.value === null ? '' : hardnessLabel(hardness.value),
    chewinessText: chew.value === null ? '' : chewinessLabel(chew.value),
    textureG: hardness.grams,
    nutrients,
    energyKcal: nutrients[0].value,
    nutritionG: round(matched.reduce((s, it) => s + it.consumedG, 0), 1),
    noTexture: unique(items.filter((it) => it.consumedG > 0 && (!it.cut || it.cut.metrics.hardness === null)).map((it) => it.name)),
    noNutrition: unique(items.filter((it) => it.consumedG > 0 && !it.nutritionCode).map((it) => it.name)),
  };
}

/**
 * 存进 consumption.intake 的紧凑结果：分子分母分开存，后台可以把多道菜直接相加再除，
 * 得到与小程序一致的整餐、全天加权值，不必重新匹配。
 */
export function storedIntake(items: IntakeItem[]): StoredIntake {
  const textureSums: StoredIntake['textureSums'] = {};
  CUT_METRICS.forEach(({ key }) => {
    let weighted = 0;
    let grams = 0;
    items.forEach((it) => {
      const v = it.cut ? it.cut.metrics[key] : null;
      if (v === null || v === undefined || it.consumedG <= 0) return;
      weighted += it.consumedG * v;
      grams += it.consumedG;
    });
    textureSums[key] = { weightedSum: round(weighted, 3), grams: round(grams, 2) };
  });
  const nutrients: Record<string, number> = {};
  NUTRIENTS.forEach(({ key }) => {
    nutrients[key] = round(items.reduce((s, it) => s + (it.nutrients[key] || 0), 0), 3);
  });
  return {
    algorithmVersion: INTAKE_ALGORITHM_VERSION,
    consumedG: round(items.reduce((s, it) => s + it.consumedG, 0), 2),
    textureSums,
    nutrients,
    nutritionG: round(items.filter((it) => it.nutritionCode).reduce((s, it) => s + it.consumedG, 0), 2),
    ingredients: items.map((it) => ({
      name: it.name, consumedG: it.consumedG,
      cutRecordId: it.cut ? it.cut.id : '', nutritionCode: it.nutritionCode, nutritionName: it.nutritionName,
    })),
  };
}

// ----------------------------------------------------------------------------
// 按北京时间分日、按餐次分餐
// ----------------------------------------------------------------------------

const CHINA_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 时间戳 → 北京时间日期「YYYY-MM-DD」，与手机时区无关 */
export function chinaDateKey(ts: number): string {
  const d = new Date(ts + CHINA_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 「YYYY-MM-DD」→ 该北京时间自然日的 [start, end) 毫秒时间戳；格式不对返回 null */
export function chinaDayRange(key: string): { start: number; end: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return null;
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - CHINA_OFFSET_MS;
  if (!isFinite(start) || chinaDateKey(start) !== key) return null;
  return { start, end: start + DAY_MS };
}

/** 日期加减若干天 */
export function shiftDateKey(key: string, days: number): string {
  const range = chinaDayRange(key);
  return range ? chinaDateKey(range.start + days * DAY_MS) : key;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function weekdayOf(key: string): string {
  const range = chinaDayRange(key);
  return range ? WEEKDAYS[new Date(range.start + CHINA_OFFSET_MS).getUTCDay()] : '';
}

export interface DishIntake {
  analysisId: string;
  dishName: string;
  imageUrl: string;
  createdAt: number;
  mealType?: MealType;
  evaluated: boolean;
  summary: IntakeSummary | null;
}

export interface MealGroup {
  mealType: MealType | '';
  label: string;
  dishes: DishIntake[];
  /** 只含已评估的菜 */
  summary: IntakeSummary;
  evaluatedCount: number;
}

export interface DailyIntake {
  dateKey: string;
  day: IntakeSummary;
  meals: MealGroup[];
  evaluatedCount: number;
  pendingCount: number;
}

/** 把某人某天的识别记录汇总成「全天 + 逐餐 + 逐菜」 */
export function buildDailyIntake(dateKey: string, meals: MealAnalysis[]): DailyIntake {
  const usable = meals
    .filter((m) => m.status === 'completed' && chinaDateKey(m.createdAt) === dateKey)
    .sort((a, b) => a.createdAt - b.createdAt);
  const dayItems: IntakeItem[] = [];
  const groups: Record<string, { items: IntakeItem[]; dishes: DishIntake[] }> = {};
  usable.forEach((meal) => {
    const evaluated = meal.evaluationStatus === 'completed' && !!meal.consumption;
    const items = evaluated ? dishIntakeItems(meal) : [];
    const key = meal.mealType || '';
    const g = groups[key] || (groups[key] = { items: [], dishes: [] });
    g.items.push(...items);
    dayItems.push(...items);
    g.dishes.push({
      analysisId: meal.analysisId,
      dishName: meal.dish ? meal.dish.dishName : '未识别到菜品',
      imageUrl: meal.imageUrl,
      createdAt: meal.createdAt,
      mealType: meal.mealType,
      evaluated,
      summary: evaluated ? summarizeIntake(items) : null,
    });
  });
  const order: (MealType | '')[] = [...MEAL_TYPE_OPTIONS.map((o) => o.type), ''];
  const mealGroups: MealGroup[] = order.filter((t) => groups[t]).map((t) => {
    const option = MEAL_TYPE_OPTIONS.find((o) => o.type === t);
    return {
      mealType: t,
      label: option ? option.label : '未选餐次',
      dishes: groups[t].dishes,
      summary: summarizeIntake(groups[t].items),
      evaluatedCount: groups[t].dishes.filter((d) => d.evaluated).length,
    };
  });
  const evaluatedCount = usable.filter((m) => m.evaluationStatus === 'completed' && !!m.consumption).length;
  return {
    dateKey,
    day: summarizeIntake(dayItems),
    meals: mealGroups,
    evaluatedCount,
    pendingCount: usable.length - evaluatedCount,
  };
}
