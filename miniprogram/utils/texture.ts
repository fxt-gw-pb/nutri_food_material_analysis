// 把「识别结果 + 用户改选」还原成页面直接可渲染的质构视图。
//
// 一次识别只对应一道菜：先按菜名、后按食材在库里定位到那道菜，
// 然后把这道菜的源数据（每种原食材一行）列出来。
//
// 匹配结果不落库：每次打开记录都用 services/textureMatch.ts 现算一遍（同样的
// 输入必然得到同样的输出），只有用户手动改过的菜名（selectedDish）才存进记录里覆盖。
// 好处是数据库升级后，老记录也会自动用上新的匹配结果。

import { Dish } from '../types/index';
import {
  DishCandidate,
  MatchType,
  cookingText,
  getDishEntry,
  matchMeal,
} from '../services/textureMatch';
import {
  MetricRow,
  TextureRecord,
  metricRows,
  hardnessLabel,
  hardnessPercent,
  chewinessLabel,
  adhesivenessLabel,
} from '../data/textureDb';

/** 这道菜源数据里的一行（一种原食材的一次 TPA 测试） */
export interface TextureRow {
  /** 原食材名；整菜取样时等于菜名 */
  ingredient: string;
  /** 是否整道菜作为一个样品测的（此时不必强调食材名） */
  wholeDish: boolean;
  cookingText: string;
  hardnessText: string;
  hardnessPercent: number;
  chewinessText: string;
  adhesivenessText: string;
  /** 九项完整指标 */
  metrics: MetricRow[];
  source: string;
}

/** 一次识别的完整视图 */
export interface ResolvedMeal {
  /** 识别出的菜名 */
  recognizedName: string;
  cookingMethod: string;
  matchType: MatchType;
  /** 最终采用的库中菜名；没匹配上且用户没选时为空串 */
  matchedDish: string;
  /** 是否由用户手动改过 */
  edited: boolean;
  /** 这道菜的源数据行 */
  rows: TextureRow[];
  /** 备选菜，供用户改选 */
  candidates: DishCandidate[];
  /** 一句话摘要，如「偏软 · 好嚼」 */
  summary: string;
}

function toRow(rec: TextureRecord): TextureRow {
  return {
    ingredient: rec.ingredient,
    wholeDish: rec.ingredient === rec.dish,
    cookingText: cookingText(rec.method, rec.minutes),
    hardnessText: hardnessLabel(rec.metrics.hardness),
    hardnessPercent: hardnessPercent(rec.metrics.hardness),
    chewinessText: chewinessLabel(rec.metrics.chewiness),
    adhesivenessText: adhesivenessLabel(rec.metrics.adhesiveness),
    metrics: metricRows(rec.metrics),
    source: rec.source,
  };
}

/** 一组记录的整体质构摘要，如「偏软 · 好嚼」 */
function summarize(records: TextureRecord[]): string {
  if (records.length === 0) return '未匹配到质构数据';
  const avg = (pick: (r: TextureRecord) => number | null): number | null => {
    const vals = records.map(pick).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };
  return `${hardnessLabel(avg((r) => r.metrics.hardness))} · ${chewinessLabel(
    avg((r) => r.metrics.chewiness),
  )}`;
}

const EMPTY: ResolvedMeal = {
  recognizedName: '未识别到菜品',
  cookingMethod: '',
  matchType: 'none',
  matchedDish: '',
  edited: false,
  rows: [],
  candidates: [],
  summary: '未匹配到质构数据',
};

/** 识别结果 + 用户改选 → 页面视图 */
export function resolveMeal(dish: Dish | null, selectedDish?: string): ResolvedMeal {
  if (!dish) {
    return { ...EMPTY };
  }
  const match = matchMeal({
    dishName: dish.dishName,
    cookingMethod: dish.cookingMethod,
    ingredients: dish.ingredients,
  });
  const finalDish = selectedDish || match.matchedDish;
  const entry = finalDish ? getDishEntry(finalDish) : undefined;
  const records = entry ? entry.records : [];
  return {
    recognizedName: dish.dishName,
    cookingMethod: dish.cookingMethod,
    matchType: match.matchType,
    matchedDish: entry ? entry.dish : '',
    edited: !!selectedDish && selectedDish !== match.matchedDish,
    rows: records.map(toRow),
    candidates: match.candidates,
    summary: summarize(records),
  };
}

/** 匹配方式 → 展示文案 */
export function matchTypeLabel(type: MatchType): string {
  if (type === 'dish') return '菜名匹配';
  if (type === 'ingredient') return '按食材匹配';
  return '未匹配';
}
