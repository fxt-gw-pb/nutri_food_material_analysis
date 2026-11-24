// 把「识别结果 + 用户改选」还原成页面直接可渲染的质构视图。
//
// 一次识别 = 一道菜 + 这道菜里的若干种食材；每种食材各自对应库里的一条实测数据。
// 页面拿到的就是一个食材列表，逐条展示软硬 / 咀嚼 / 黏牙与九项完整指标。
//
// 页面每次按当前算法重算；用户改选和排除项覆盖自动结果。
// 后台另存 auditSnapshot，供导出估重依据、匹配记录和来源，老人界面不显示这些说明。
//
// 估重需要餐盘直径（拍照时用户选的，存在记录里），换算逻辑见 utils/weight.ts。

import { ConfidenceLevel, Dish } from '../types/index';
import {
  DEFAULT_PLATE_DIAMETER,
  WeightEstimate,
  estimateWeight,
  weightRangeText,
  weightText,
} from './weight';
import {
  IngredientMatchType,
  RecordCandidate,
  alternateTestModes,
  cookingText,
  ingredientSimilarity,
  matchMeal,
  methodScore,
} from '../services/textureMatch';
import { prepare } from './similarity';
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
  /** 历史改选与识别食材差距过大时，提示用户复核。 */
  reviewNote: string;
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

  /** ---- 估重 ---- */
  /** 估算重量（整数 g），估不出为 0 */
  grams: number;
  /** 「约 120 g」 */
  weightText: string;
  /** 「85–155 g」 */
  weightRangeText: string;
  /** 这个数是怎么算出来的，详情页展示 */
  weightBasis: string;
  weightConfidence: ConfidenceLevel;
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
  /** 估算总重（整数 g） */
  totalG: number;
  /** 「约 350 g」 */
  totalWeightText: string;
  /** 估重用的餐盘直径（cm） */
  plateDiameterCm: number;
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
  totalG: 0,
  totalWeightText: '',
  plateDiameterCm: DEFAULT_PLATE_DIAMETER,
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
export function resolveMeal(
  dish: Dish | null,
  selections?: RecordSelections,
  plateDiameterCm?: number,
  excludedIngredients: string[] = [],
): ResolvedMeal {
  if (!dish) {
    return { ...EMPTY };
  }
  const plate = plateDiameterCm && plateDiameterCm > 0 ? plateDiameterCm : DEFAULT_PLATE_DIAMETER;
  // 识别出的几何量按食材名索引，匹配结果里只带了名字。
  const geomByName: Record<string, (typeof dish.ingredients)[number]> = {};
  dish.ingredients.forEach((ing) => {
    geomByName[ing.name] = ing;
  });
  const match = matchMeal({
    dishName: dish.dishName,
    cookingMethod: dish.cookingMethod,
    ingredients: dish.ingredients,
  });
  const picked = selections || {};
  const primaries: TextureRecord[] = [];
  let totalG = 0;

  const ingredients: IngredientRow[] = match.ingredients.filter((im) => excludedIngredients.indexOf(im.query) < 0).map((im) => {
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

    // 估重与质构匹配相互独立：即使库里没有这种食材的质构数据，重量照样能估出来。
    // 密度优先按食材名判断，匹配上了就再拿库里的菜品类别兜底。
    const geom = geomByName[im.query];
    const weight: WeightEstimate = estimateWeight(
      {
        name: im.query,
        category: rec ? rec.category : undefined,
        areaRatio: geom ? geom.areaRatio : undefined,
        heightCm: geom ? geom.heightCm : undefined,
        grams: geom ? geom.estimatedG : undefined,
        confidence: geom ? geom.weightConfidence : dish.weightConfidence,
      },
      plate,
    );
    totalG += weight.grams;

    const selectedSimilarity = rec ? ingredientSimilarity(prepare(im.query), prepare(rec.ingredient)) : 0;
    const matchType: IngredientMatchType = rec
      ? edited ? (selectedSimilarity >= 0.95 ? 'exact' : 'similar') : im.matchType
      : 'none';
    let reviewNote = '';
    if (edited && rec && selectedSimilarity < 0.7) {
      reviewNote = `当前选用「${rec.ingredient}」的数据，与识别的「${im.query}」可能不是同一种食材，请核对或恢复自动匹配。`;
    } else if (!edited && rec && im.reason.includes('配方可能不同')) {
      reviewNote = `当前参考「${rec.dish}」的数据，配方可能不同，请核对。`;
    } else if (!edited && rec && im.queryMethod && rec.method && methodScore(im.queryMethod, rec.method) === 0) {
      reviewNote = `当前参考「${rec.dish}」中${rec.method}的实测值，与这道菜的${im.queryMethod}做法不同，请核对。`;
    }
    return {
      name: im.query,
      cookingMethod: im.queryMethod,
      matchType,
      matched: !!rec,
      edited,
      reviewNote,
      recordId: rec ? rec.id : '',
      matchedIngredient: rec ? rec.ingredient : '',
      matchedDish: rec ? rec.dish : '',
      category: rec ? rec.category : '',
      matchedCookingText: rec ? cookingText(rec.method, rec.minutes) : '',
      matchTypeText: edited ? '已手动改选' : matchTypeLabel(matchType),
      reason: edited ? `已改选为「${rec!.dish}」里的「${rec!.ingredient}」` : im.reason,
      readings,
      candidates: im.candidates,
      grams: weight.grams,
      weightText: weightText(weight),
      weightRangeText: weightRangeText(weight),
      weightBasis: weight.basis,
      weightConfidence: weight.confidence,
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
    totalG,
    totalWeightText: totalG ? `约 ${totalG} g` : '',
    plateDiameterCm: plate,
  };
}
