// ============================================================================
// 质构数据匹配引擎（纯本地，无网络、无模型调用）。
//
// 按需求文档的两步走：
//   第一步  菜名匹配：拍照识别出的菜名若与数据库中的菜名几乎一致，直接用该菜的数据。
//   第二步  食材匹配：菜名对不上时，把识别出的原食材 + 烹饪方式拿去库里找最像的一条，
//           遵循「食材优先、烹饪方式其次」——先看食材像不像，再看烹饪方式合不合。
// 另外：同一道菜有多个烹饪时长版本时，优先取时间较久的那条（需求第 3 点）。
//
// 每个结果都带一组备选（alternatives），结果页展示在下方供老人自行改选。
// ============================================================================

import {
  TEXTURE_RECORDS,
  TextureRecord,
  recordsOfDish,
  ALL_DISH_NAMES,
} from '../data/textureDb';
import { similarity, normalize } from '../utils/similarity';

/** 菜名判定为「几乎一致」的相似度门槛 */
const DISH_SAME_THRESHOLD = 0.82;
/** 食材匹配可接受的最低总分，低于此值视为没匹配上（但仍给备选） */
const INGREDIENT_MIN_SCORE = 0.34;
/** 每条结果附带的备选数量 */
const ALTERNATIVE_COUNT = 6;

/** 烹饪方式族群：同族视为「比较接近」，给一半的方式分 */
const METHOD_FAMILIES: string[][] = [
  ['煮', '炖', '煲', '焖', '油焖', '黄焖', '烩', '煨', '慢炖', '汆', '涮', '焯', '熬', '高压锅'],
  ['蒸', '清蒸', '粉蒸'],
  ['炒', '清炒', '爆炒', '爆', '熘', '溜', '干煸', '扒'],
  ['煎', '生煎', '炸', '油炸', '烙', '空气炸锅'],
  ['烤', '烘', '熏'],
  ['烧', '红烧', '酱烧', '干烧', '卤', '酱'],
  ['凉拌', '拌', '腌', '白切', '白灼'],
];

function methodFamily(method: string): number {
  const m = normalize(method);
  if (!m) return -1;
  for (let i = 0; i < METHOD_FAMILIES.length; i += 1) {
    if (METHOD_FAMILIES[i].some((x) => m.includes(x) || x.includes(m))) return i;
  }
  return -1;
}

/** 烹饪方式接近程度：完全一致 1，同族 0.5，都没写 0.3，其余 0 */
export function methodScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0.3; // 有一方没标烹饪方式：不加分也不重罚
  if (na === nb) return 1;
  const fa = methodFamily(na);
  const fb = methodFamily(nb);
  if (fa >= 0 && fa === fb) return 0.5;
  return 0;
}

// ----------------------------------------------------------------------------
// 对外类型
// ----------------------------------------------------------------------------

/** 视觉模型识别出的一道菜（匹配的输入） */
export interface RecognizedDish {
  dishName: string;
  cookingMethod: string;
  /** 识别出的原食材，如 [{name:'虾仁',cookingMethod:'煮'}] */
  ingredients: { name: string; cookingMethod?: string }[];
}

/** 一条候选匹配 */
export interface MatchCandidate {
  recordId: string;
  /** 展示用标题，如「大煮干丝 · 豆腐丝」 */
  title: string;
  dish: string;
  ingredient: string;
  method: string;
  minutes: number;
  category: string;
  /** 0–100 的匹配度，供页面展示 */
  scorePercent: number;
  /** 一句话说明为什么匹配到它 */
  reason: string;
}

export type MatchType = 'dish' | 'ingredient' | 'none';

/** 识别出的一个食材（或一道菜）的匹配结果 */
export interface MatchedItem {
  /** 识别侧的名字（食材名，菜名匹配时是该菜的原食材名） */
  queryName: string;
  matchType: MatchType;
  /** 选中的那条（none 时为空串） */
  selectedRecordId: string;
  candidates: MatchCandidate[];
}

/** 一道菜的完整匹配结果 */
export interface MatchedDish {
  dishName: string;
  cookingMethod: string;
  matchType: MatchType;
  /** 命中的数据库菜名（菜名匹配时有值） */
  matchedDishName: string;
  items: MatchedItem[];
}

// ----------------------------------------------------------------------------
// 内部工具
// ----------------------------------------------------------------------------

function minutesText(minutes: number): string {
  if (!minutes) return '';
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}小时`;
  return `${minutes % 1 === 0 ? minutes : minutes.toFixed(1)}分钟`;
}

/** 候选的展示描述：烹饪方式 + 时长 */
export function candidateCookingText(method: string, minutes: number): string {
  const t = minutesText(minutes);
  if (method && t) return `${method} ${t}`;
  return method || t || '未标注烹饪方式';
}

function toCandidate(rec: TextureRecord, score: number, reason: string): MatchCandidate {
  return {
    recordId: rec.id,
    title: rec.dish === rec.ingredient ? rec.dish : `${rec.dish} · ${rec.ingredient}`,
    dish: rec.dish,
    ingredient: rec.ingredient,
    method: rec.method,
    minutes: rec.minutes,
    category: rec.category,
    scorePercent: Math.round(Math.max(0, Math.min(1, score)) * 100),
    reason,
  };
}

/**
 * 需求第 3 点：同一道菜、同一种食材有多个烹饪时长版本时，优先保留时间较久的一条。
 * 返回按「食材」去重后的记录（每种食材只留时间最久的那条）。
 */
function preferLongerCooking(records: TextureRecord[]): TextureRecord[] {
  const best = new Map<string, TextureRecord>();
  records.forEach((rec) => {
    const key = normalize(rec.ingredient) + '|' + normalize(rec.method);
    const cur = best.get(key);
    if (!cur || rec.minutes > cur.minutes) {
      best.set(key, rec);
    }
  });
  return Array.from(best.values());
}

// ----------------------------------------------------------------------------
// 第一步：菜名匹配
// ----------------------------------------------------------------------------

/** 在数据库菜名里找与 dishName 最像的一个；不够像则返回空 */
function findSameDish(dishName: string): string {
  let bestName = '';
  let bestScore = 0;
  ALL_DISH_NAMES.forEach((name) => {
    const s = similarity(dishName, name);
    if (s > bestScore) {
      bestScore = s;
      bestName = name;
    }
  });
  return bestScore >= DISH_SAME_THRESHOLD ? bestName : '';
}

/** 把命中的菜拆成「每种原食材一条」的结果 */
function buildDishMatch(query: RecognizedDish, dbDishName: string): MatchedDish {
  const all = recordsOfDish(dbDishName);
  const picked = preferLongerCooking(all);
  const items: MatchedItem[] = picked.map((rec) => {
    // 备选 = 同一道菜的其它版本（不同时长 / 不同食材）+ 食材层面的相似项
    const sameDishOthers = all
      .filter((r) => r.id !== rec.id)
      .sort((a, b) => b.minutes - a.minutes)
      .map((r) =>
        toCandidate(
          r,
          0.9,
          r.ingredient === rec.ingredient
            ? `同一道菜的另一个烹饪时长（${candidateCookingText(r.method, r.minutes)}）`
            : `同一道菜的其它食材（${r.ingredient}）`,
        ),
      );
    const similarOthers = rankByIngredient(rec.ingredient, rec.method, dbDishName)
      .slice(0, ALTERNATIVE_COUNT)
      .map((c) => c.candidate);
    return {
      queryName: rec.ingredient,
      matchType: 'dish' as MatchType,
      selectedRecordId: rec.id,
      candidates: [
        toCandidate(rec, 1, `菜名与「${dbDishName}」一致，直接取库中该菜数据`),
        ...sameDishOthers,
        ...similarOthers,
      ],
    };
  });
  return {
    dishName: query.dishName,
    cookingMethod: query.cookingMethod,
    matchType: 'dish',
    matchedDishName: dbDishName,
    items,
  };
}

// ----------------------------------------------------------------------------
// 第二步：食材匹配（食材优先、烹饪方式其次）
// ----------------------------------------------------------------------------

const W_INGREDIENT = 0.78;
const W_METHOD = 0.18;
const W_DISH = 0.04;

interface Scored {
  candidate: MatchCandidate;
  score: number;
  minutes: number;
}

/**
 * 用「食材名 + 烹饪方式」给全库打分并排序。
 * excludeDish 用于在菜名已命中时，把同一道菜排除出「相似备选」，避免重复。
 */
function rankByIngredient(
  ingredientName: string,
  method: string,
  excludeDish = '',
  dishName = '',
): Scored[] {
  const scored: Scored[] = [];
  TEXTURE_RECORDS.forEach((rec) => {
    if (excludeDish && rec.dish === excludeDish) return;
    const ingSim = similarity(ingredientName, rec.ingredient);
    if (ingSim < 0.15) return; // 食材完全不沾边，直接跳过
    const mScore = methodScore(method, rec.method);
    const dSim = dishName ? similarity(dishName, rec.dish) : 0;
    const score = W_INGREDIENT * ingSim + W_METHOD * mScore + W_DISH * dSim;
    let reason: string;
    if (!rec.method || !normalize(method)) {
      reason = `食材「${rec.ingredient}」相近，库中未标注烹饪方式`;
    } else if (mScore >= 1) {
      reason = `食材「${rec.ingredient}」相近，烹饪方式同为${rec.method}`;
    } else if (mScore >= 0.5) {
      reason = `食材「${rec.ingredient}」相近，烹饪方式接近（${rec.method}）`;
    } else {
      reason = `食材「${rec.ingredient}」相近，烹饪方式不同（${rec.method}）`;
    }
    scored.push({ candidate: toCandidate(rec, score, reason), score, minutes: rec.minutes });
  });
  // 分数降序；完全同分（同一道菜、同一食材的不同烹饪时长）时，
  // 按需求第 3 点取烹饪时间更久的那条。
  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) < 1e-6) return b.minutes - a.minutes;
    return b.score - a.score;
  });
  return scored;
}

function buildIngredientMatch(query: RecognizedDish): MatchedDish {
  // 模型没给出食材时，退而用菜名本身当食材去找
  const ingredients =
    query.ingredients && query.ingredients.length
      ? query.ingredients
      : [{ name: query.dishName, cookingMethod: query.cookingMethod }];

  const items: MatchedItem[] = ingredients.map((ing) => {
    const method = ing.cookingMethod || query.cookingMethod;
    const ranked = rankByIngredient(ing.name, method, '', query.dishName).slice(
      0,
      ALTERNATIVE_COUNT + 1,
    );
    const top = ranked[0];
    const matched = !!top && top.score >= INGREDIENT_MIN_SCORE;
    return {
      queryName: ing.name,
      matchType: (matched ? 'ingredient' : 'none') as MatchType,
      selectedRecordId: matched ? top.candidate.recordId : '',
      candidates: ranked.map((s) => s.candidate),
    };
  });

  return {
    dishName: query.dishName,
    cookingMethod: query.cookingMethod,
    matchType: items.some((i) => i.matchType === 'ingredient') ? 'ingredient' : 'none',
    matchedDishName: '',
    items,
  };
}

// ----------------------------------------------------------------------------
// 对外入口
// ----------------------------------------------------------------------------

/** 给一道识别出的菜找质构数据：先菜名、后食材 */
export function matchDish(query: RecognizedDish): MatchedDish {
  const sameDish = findSameDish(query.dishName);
  if (sameDish) {
    return buildDishMatch(query, sameDish);
  }
  return buildIngredientMatch(query);
}

export function matchDishes(dishes: RecognizedDish[]): MatchedDish[] {
  return dishes.map(matchDish);
}

/** 结果页「手动搜索」用：按关键词在全库里找菜名 / 食材 */
export function searchCandidates(keyword: string, limit = 20): MatchCandidate[] {
  const kw = normalize(keyword);
  if (!kw) return [];
  const scored: Scored[] = [];
  TEXTURE_RECORDS.forEach((rec) => {
    const s = Math.max(
      similarity(kw, rec.dish),
      similarity(kw, rec.ingredient),
      normalize(rec.dish).includes(kw) || normalize(rec.ingredient).includes(kw) ? 0.9 : 0,
    );
    if (s < 0.3) return;
    scored.push({
      candidate: toCandidate(rec, s, `搜索「${keyword}」匹配到`),
      score: s,
      minutes: rec.minutes,
    });
  });
  scored.sort((a, b) =>
    Math.abs(a.score - b.score) < 1e-6 ? b.minutes - a.minutes : b.score - a.score,
  );
  return scored.slice(0, limit).map((s) => s.candidate);
}
