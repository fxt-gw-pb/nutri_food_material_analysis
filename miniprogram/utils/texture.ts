// 把「识别结果 + 用户改选」还原成页面直接可渲染的质构视图。
//
// 一次识别 = 一道菜 + 这道菜里的若干种食材；每种食材各自对应库里的一条实测数据。
// 页面拿到的就是一个食材列表，逐条展示软硬 / 咀嚼 / 黏牙与九项完整指标。
//
// 匹配结果不落库：每次打开记录都用 services/textureMatch.ts 现算一遍（同样的
// 输入必然得到同样的输出），只有用户手动改过的那几种食材（selectedRecords）
// 才存进记录里覆盖。好处是质构库升级后，老记录也会自动用上新的匹配结果。

import { Dish } from '../types/index';
import {
  IngredientMatchType,
  RecordCandidate,
  alternateTestModes,
  cookingText,
  matchMeal,
} from '../services/textureMatch';
import {
  MetricRow,
  TextureRecord,
  findRecordById,
  metricRows,
  hardnessLabel,
  hardnessPercent,
  chewinessLabel,
  adhesivenessLabel,
} from '../data/textureDb';

/** 一种测试模式下的实测数值（切割 / 下压各一份） */
export interface TextureReading {
  /** 切割测试 / 下压测试 */
  testMode: string;
  hardnessText: string;
  hardnessPercent: number;
  chewinessText: string;
  adhesivenessText: string;
  /** 九项完整指标 */
  metrics: MetricRow[];
  source: string;
}

/** 页面上的一行：识别出的一种食材 + 它匹配到的库中数据 */
export interface IngredientRow {
  /** 识别出的食材名（原样，也用作列表 key 与改选时的标识） */
  name: string;
  /** 识别出的烹饪方式 */
  cookingMethod: string;
  matchType: IngredientMatchType;
  /** 是否匹配到了数据 */
  matched: boolean;
  /** 是否被用户手动改过 */
  edited: boolean;
  /** 匹配到的库中记录 id */
  recordId: string;
  /** 库中该食材的写法，如「带皮五花肉」 */
  matchedIngredient: string;
  /** 数据出自库里的哪道菜 */
  matchedDish: string;
  category: string;
  /** 库中标注的烹饪方式与时长，如「炖 40分钟」 */
  matchedCookingText: string;
  matchTypeText: string;
  reason: string;
  /** 切割 / 下压两种测试模式的数据，规则 2：都测过就都给 */
  readings: TextureReading[];
  /** 备选记录，供用户改选 */
  candidates: RecordCandidate[];
}

/** 一次识别的完整视图 */
export interface ResolvedMeal {
  /** 识别出的菜名 */
  recognizedName: string;
  cookingMethod: string;
  /** 库中的同名菜；没有则空串 */
  matchedDish: string;
  /** 识别出的食材逐条结果 */
  ingredients: IngredientRow[];
  /** 匹配上的食材数 / 总食材数 */
  matchedCount: number;
  totalCount: number;
  /** 一句话摘要，如「偏软 · 好嚼」 */
  summary: string;
}

/** 用户改选：识别食材名 → 库中记录 id */
export type RecordSelections = Record<string, string>;

function toReading(rec: TextureRecord): TextureReading {
  return {
    testMode: rec.testMode,
    hardnessText: hardnessLabel(rec.metrics.hardness),
    hardnessPercent: hardnessPercent(rec.metrics.hardness),
    chewinessText: chewinessLabel(rec.metrics.chewiness),
    adhesivenessText: adhesivenessLabel(rec.metrics.adhesiveness),
    metrics: metricRows(rec.metrics),
    source: rec.source,
  };
}

/** 匹配方式 → 展示文案 */
export function matchTypeLabel(type: IngredientMatchType): string {
  if (type === 'exact') return '精确匹配';
  if (type === 'similar') return '相近食材';
  return '未匹配';
}

const EMPTY: ResolvedMeal = {
  recognizedName: '未识别到菜品',
  cookingMethod: '',
  matchedDish: '',
  ingredients: [],
  matchedCount: 0,
  totalCount: 0,
  summary: '未匹配到质构数据',
};

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

/** 识别结果 + 用户改选 → 页面视图 */
export function resolveMeal(dish: Dish | null, selections?: RecordSelections): ResolvedMeal {
  if (!dish) {
    return { ...EMPTY };
  }
  const match = matchMeal({
    dishName: dish.dishName,
    cookingMethod: dish.cookingMethod,
    ingredients: dish.ingredients,
  });
  const picked = selections || {};
  const primaries: TextureRecord[] = [];

  const ingredients: IngredientRow[] = match.ingredients.map((im) => {
    const override = picked[im.query];
    const recordId = override || im.recordId;
    const rec = recordId ? findRecordById(recordId) : undefined;
    const edited = !!override && override !== im.recordId;
    if (rec) primaries.push(rec);

    // 主记录 + 另一种测试模式的记录，切割在前。
    const readings = rec
      ? [rec, ...alternateTestModes(rec.id)]
          .sort((a, b) => (a.testMode === '切割测试' ? -1 : b.testMode === '切割测试' ? 1 : 0))
          .map(toReading)
      : [];

    const matchType: IngredientMatchType = rec ? (edited ? 'exact' : im.matchType) : 'none';
    return {
      name: im.query,
      cookingMethod: im.queryMethod,
      matchType,
      matched: !!rec,
      edited,
      recordId: rec ? rec.id : '',
      matchedIngredient: rec ? rec.ingredient : '',
      matchedDish: rec ? rec.dish : '',
      category: rec ? rec.category : '',
      matchedCookingText: rec ? cookingText(rec.method, rec.minutes) : '',
      matchTypeText: edited ? '已手动改选' : matchTypeLabel(matchType),
      reason: edited ? `已改选为「${rec!.dish}」里的「${rec!.ingredient}」` : im.reason,
      readings,
      candidates: im.candidates,
    };
  });

  return {
    recognizedName: dish.dishName,
    cookingMethod: dish.cookingMethod,
    matchedDish: match.matchedDish,
    ingredients,
    matchedCount: ingredients.filter((i) => i.matched).length,
    totalCount: ingredients.length,
    summary: summarize(primaries),
  };
}
