// ============================================================================
// 质构数据匹配引擎（纯本地，无网络、无模型调用）。
//
// 匹配的单位是「一种食材」：视觉模型识别出这道菜里的全部食材后，
// 每一种食材都各自去库里找它自己的那条 TPA 实测数据，最后一并返回。
// （上一版是以「整道菜」为单位只返回一条，已废弃。）
//
// 两步走，与需求一致：
//   第一步  菜名匹配：识别出的菜名若与库中某道菜几乎一致，优先在这道菜内部为
//           每种食材找对应记录——同一道菜里的「土豆」显然比别的菜里的「土豆」更准。
//   第二步  食材匹配：菜名对不上（或该菜里没有这种食材）时，放开到全库按
//           「食材优先、烹饪方式其次」打分。
//
// 三条硬规则：
//   1) 多个烹饪时间 → 取时间最长的那条（用户明确要求）；
//   2) 同一食材若切割测试与下压测试都做过，两条都返回，由页面并列展示；
//   3) 每种食材都附一组备选记录，供用户在结果页自行改选。
// ============================================================================

import {
  TextureRecord,
  allDishNames,
  allRecords,
  recordsOfDish,
  findRecordById,
} from '../data/textureDb';
import { Prepared, normalize, prepare, similarityPrepared } from '../utils/similarity';

/** 菜名判定为「几乎一致」的相似度门槛 */
const DISH_SAME_THRESHOLD = 0.82;
/** 在「同名菜」内部接受某条食材记录的门槛（比全库低，因为菜已经对上了） */
const IN_DISH_THRESHOLD = 0.5;
/** 食材名判定为「就是它」的门槛 */
const EXACT_THRESHOLD = 0.95;
/** 全库匹配可接受的最低总分，低于此值视为没匹配上（但仍给备选） */
const MIN_SCORE = 0.34;
/** 每种食材给出的备选记录条数 */
const CANDIDATE_COUNT = 8;
/** 参与匹配的识别食材上限：模型偶尔会把葱姜蒜都列出来，太多既慢也没意义 */
const MAX_QUERY_INGREDIENTS = 10;

/** 成型主食的原料名不等于食用时的质构；旧识别结果可能仍把馒头写成面粉。 */
const FORMED_STAPLE = /(馒头|花卷|包子|面包|饼干|米饭|面条)$/;
const STAPLE_RAW_MATERIAL = /^(面粉|小麦粉|面团|酵母|生米)$/;

function matchingName(ingredientName: string, dishName: string): string {
  const dish = normalize(dishName);
  return FORMED_STAPLE.test(dish) && STAPLE_RAW_MATERIAL.test(normalize(ingredientName))
    ? dishName
    : ingredientName;
}

/** 少量同义菜名：煎蛋与摊鸡蛋说的是同一种成品。 */
function prepareDishName(name: string): Prepared {
  return prepare(normalize(name).replace(/(煎蛋|摊鸡蛋)$/, '鸡蛋'));
}

/** 名字相近不代表可作为同一种食物的实测值。 */
export function ingredientSimilarity(a: Prepared, b: Prepared): number {
  const seed = (name: string) => name === '花生仁';
  const sprout = (name: string) => /^花生[芽苗]$/.test(name);
  if ((seed(a.norm) && sprout(b.norm)) || (sprout(a.norm) && seed(b.norm))) return 0;
  if ((a.norm === '面粉' && b.norm === '粉丝') || (b.norm === '面粉' && a.norm === '粉丝')) return 0;
  return similarityPrepared(a, b);
}

/** 烹饪方式族群：同族视为「比较接近」，给一半的方式分 */
const METHOD_FAMILIES: string[][] = [
  ['煮', '炖', '煲', '焖', '油焖', '黄焖', '烩', '煨', '慢炖', '汆', '涮', '焯', '熬', '高压锅'],
  ['蒸', '清蒸', '粉蒸'],
  ['炒', '清炒', '爆炒', '爆', '熘', '溜', '干煸', '扒'],
  ['煎', '生煎', '炸', '油炸', '烙', '空气炸锅', '焗'],
  ['烤', '烘', '熏'],
  ['烧', '红烧', '酱烧', '干烧', '卤', '酱'],
  ['凉拌', '拌', '腌', '白切', '白灼', '生食'],
];

function methodFamily(method: string): number {
  const m = normalize(method);
  if (!m) return -1;
  for (let i = 0; i < METHOD_FAMILIES.length; i += 1) {
    if (METHOD_FAMILIES[i].some((x) => m.includes(x) || x.includes(m))) return i;
  }
  return -1;
}

/** 烹饪方式接近程度：完全一致 1，同族 0.5，有一方没标注 0.3，其余 0 */
export function methodScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0.3;
  if (na === nb) return 1;
  const fa = methodFamily(na);
  const fb = methodFamily(nb);
  if (fa >= 0 && fa === fb) return 0.5;
  return 0;
}

// ----------------------------------------------------------------------------
// 时长与展示文案
// ----------------------------------------------------------------------------

export function minutesText(minutes: number): string {
  if (!minutes) return '';
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}小时`;
  return `${minutes % 1 === 0 ? minutes : minutes.toFixed(1)}分钟`;
}

/** 「煮 15分钟」这样的一行描述 */
export function cookingText(method: string, minutes: number): string {
  const t = minutesText(minutes);
  if (method && t) return `${method} ${t}`;
  return method || t || '未标注烹饪方式';
}

// ----------------------------------------------------------------------------
// 索引（懒加载：第一次匹配时才建，避免拖慢小程序启动）
// ----------------------------------------------------------------------------

interface IndexedRecord {
  rec: TextureRecord;
  /** 预处理过的食材名，匹配时直接用，不必每次重跑正则 */
  ingredient: Prepared;
}

interface DishEntry {
  dish: string;
  category: string;
  name: Prepared;
  records: IndexedRecord[];
}

let index: {
  records: IndexedRecord[];
  entries: Record<string, DishEntry>;
  names: string[];
} | null = null;

function ensureIndex() {
  if (index) return index;
  const records = allRecords().map((rec) => ({ rec, ingredient: prepare(rec.ingredient) }));
  const byId: Record<string, IndexedRecord> = {};
  records.forEach((r) => {
    byId[r.rec.id] = r;
  });
  const entries: Record<string, DishEntry> = {};
  const names = allDishNames();
  names.forEach((dish) => {
    const recs = recordsOfDish(dish).map((r) => byId[r.id]);
    entries[dish] = {
      dish,
      category: recs[0] ? recs[0].rec.category : '',
      name: prepareDishName(dish),
      records: recs,
    };
  });
  index = { records, entries, names };
  return index;
}

// ----------------------------------------------------------------------------
// 对外类型
// ----------------------------------------------------------------------------

/** 视觉模型识别出的一种食材 */
export interface RecognizedIngredient {
  name: string;
  cookingMethod?: string;
}

/** 视觉模型识别出的那道菜（匹配的输入） */
export interface RecognizedDish {
  dishName: string;
  cookingMethod: string;
  ingredients: RecognizedIngredient[];
}

/** 一条备选记录 */
export interface RecordCandidate {
  /** 质构记录 id，用户改选时存这个 */
  id: string;
  dish: string;
  ingredient: string;
  category: string;
  testMode: string;
  /** 烹饪方式与时长摘要，如「炖 40分钟」 */
  cookingText: string;
  scorePercent: number;
  reason: string;
}

export type IngredientMatchType = 'exact' | 'similar' | 'none';

/** 一种食材的匹配结果 */
export interface IngredientMatch {
  /** 识别出的食材名（原样，用作稳定 key） */
  query: string;
  /** 识别出的该食材烹饪方式 */
  queryMethod: string;
  matchType: IngredientMatchType;
  /** 命中的主记录 id；none 时为空串 */
  recordId: string;
  score: number;
  reason: string;
  candidates: RecordCandidate[];
}

/** 一次识别的完整匹配结果 */
export interface MealMatch {
  /** 识别出的菜名在库中的同名菜；没有则为空串 */
  matchedDish: string;
  /** 每种识别出的食材各一条 */
  ingredients: IngredientMatch[];
}

// ----------------------------------------------------------------------------
// 打分
// ----------------------------------------------------------------------------

const W_INGREDIENT = 0.72;
const W_METHOD = 0.16;
const W_DISH = 0.12;

/**
 * 同分时的取舍顺序（规则 1）：
 *   烹饪时间长的优先 → 切割测试优先（数据量大得多，作为默认展示模式）。
 */
function betterThan(a: IndexedRecord, b: IndexedRecord): boolean {
  if (a.rec.minutes !== b.rec.minutes) return a.rec.minutes > b.rec.minutes;
  return a.rec.testMode === '切割测试' && b.rec.testMode !== '切割测试';
}

function scoreRecord(
  item: IndexedRecord,
  ing: { prepared: Prepared; method: string },
  dishName: Prepared,
): { score: number; ingSim: number; mScore: number } {
  const ingSim = ingredientSimilarity(ing.prepared, item.ingredient);
  const mScore = methodScore(ing.method, item.rec.method);
  const entry = ensureIndex().entries[item.rec.dish];
  const dishSim = entry ? similarityPrepared(dishName, entry.name) : 0;
  return { score: W_INGREDIENT * ingSim + W_METHOD * mScore + W_DISH * dishSim, ingSim, mScore };
}

function reasonText(queryName: string, rec: TextureRecord, ingSim: number, mScore: number, comparedName = queryName): string {
  if (comparedName !== queryName) {
    return `识别到的「${queryName}」按成型主食「${comparedName}」查库，参考「${rec.dish}」的实测值；配方可能不同，请核对`;
  }
  const who =
    ingSim >= EXACT_THRESHOLD
      ? `库中「${rec.dish}」里的「${rec.ingredient}」就是它`
      : `与库中「${rec.dish}」里的「${rec.ingredient}」相近`;
  let how: string;
  if (mScore >= 1) how = `烹饪方式同为${rec.method}`;
  else if (mScore >= 0.5) how = `烹饪方式接近（${rec.method}）`;
  else if (mScore >= 0.3) how = '烹饪方式未标注';
  else how = `烹饪方式不同（${rec.method}）`;
  return `识别到的「${queryName}」${who}，${how}`;
}

function toCandidate(item: IndexedRecord, score: number, reason: string): RecordCandidate {
  const rec = item.rec;
  return {
    id: rec.id,
    dish: rec.dish,
    ingredient: rec.ingredient,
    category: rec.category,
    testMode: rec.testMode,
    cookingText: cookingText(rec.method, rec.minutes),
    scorePercent: Math.round(Math.max(0, Math.min(1, score)) * 100),
    reason,
  };
}

/**
 * 备选列表去重：同一「菜 + 食材 + 方式 + 测试模式」只留一条。
 * 规则 1 在这里落地——留下的是烹饪时间最长的那条。
 */
function dedupe(scored: { item: IndexedRecord; score: number; reason: string }[]) {
  const best = new Map<string, { item: IndexedRecord; score: number; reason: string }>();
  scored.forEach((s) => {
    const rec = s.item.rec;
    const key = `${rec.dish}|${normalize(rec.ingredient)}|${normalize(rec.method)}|${rec.testMode}`;
    const cur = best.get(key);
    if (!cur || s.score > cur.score + 1e-6 || betterThan(s.item, cur.item)) {
      best.set(key, s);
    }
  });
  return Array.from(best.values()).sort((a, b) =>
    Math.abs(a.score - b.score) < 1e-6
      ? betterThan(a.item, b.item)
        ? -1
        : 1
      : b.score - a.score,
  );
}

// ----------------------------------------------------------------------------
// 单种食材的匹配
// ----------------------------------------------------------------------------

/** 「同名菜内部」这一轮的最佳候选 */
interface ScoredInDish {
  item: IndexedRecord;
  score: number;
  ingSim: number;
  mScore: number;
}

function matchOneIngredient(
  ing: RecognizedIngredient,
  fallbackMethod: string,
  dishName: Prepared,
  dishEntry: DishEntry | undefined,
): IngredientMatch {
  const idx = ensureIndex();
  const comparedName = matchingName(ing.name, dishName.norm);
  const query = { prepared: prepare(comparedName), method: ing.cookingMethod || fallbackMethod };

  // 第一步：菜名已对上时，先只在这道菜里找这种食材。
  let picked: { item: IndexedRecord; score: number; reason: string } | null = null;
  if (dishEntry) {
    // 用普通 for 而不是 forEach：闭包里的赋值不参与 TS 控制流分析，会把 bestIn 收窄成 never。
    let bestIn: ScoredInDish | null = null;
    for (let i = 0; i < dishEntry.records.length; i += 1) {
      const item = dishEntry.records[i];
      const s = scoreRecord(item, query, dishName);
      if (
        bestIn === null ||
        s.ingSim > bestIn.ingSim + 1e-6 ||
        (Math.abs(s.ingSim - bestIn.ingSim) < 1e-6 && betterThan(item, bestIn.item))
      ) {
        bestIn = { item, score: s.score, ingSim: s.ingSim, mScore: s.mScore };
      }
    }
    if (bestIn !== null && bestIn.ingSim >= IN_DISH_THRESHOLD) {
      picked = {
        item: bestIn.item,
        // 同名菜内部命中时以食材相似度为准，别被「烹饪方式没标注」拉低分。
        score: Math.max(bestIn.score, bestIn.ingSim),
        reason: reasonText(ing.name, bestIn.item.rec, bestIn.ingSim, bestIn.mScore, comparedName),
      };
    }
  }

  // 第二步：全库按「食材优先、烹饪方式其次」打分（同时用来生成备选）。
  const scored: { item: IndexedRecord; score: number; reason: string; ingSim: number }[] = [];
  idx.records.forEach((item) => {
    const s = scoreRecord(item, query, dishName);
    if (s.ingSim < 0.15) return;
    scored.push({
      item,
      score: s.score,
      ingSim: s.ingSim,
      reason: reasonText(ing.name, item.rec, s.ingSim, s.mScore, comparedName),
    });
  });
  const ranked = dedupe(scored);

  if (!picked && ranked.length && ranked[0].score >= MIN_SCORE) {
    picked = ranked[0];
  }

  const candidates = ranked.slice(0, CANDIDATE_COUNT).map((s) => toCandidate(s.item, s.score, s.reason));
  // 命中的那条若不在前 N 里（走了「同名菜内部」这条路时可能发生），补到队首。
  if (picked && !candidates.some((c) => c.id === picked!.item.rec.id)) {
    candidates.unshift(toCandidate(picked.item, picked.score, picked.reason));
    candidates.pop();
  }

  if (!picked) {
    return {
      query: ing.name,
      queryMethod: query.method,
      matchType: 'none',
      recordId: '',
      score: 0,
      reason: `库里没有与「${ing.name}」足够接近的实测数据`,
      candidates,
    };
  }

  const exact =
    comparedName === ing.name && ingredientSimilarity(query.prepared, picked.item.ingredient) >= EXACT_THRESHOLD;
  return {
    query: ing.name,
    queryMethod: query.method,
    matchType: exact ? 'exact' : 'similar',
    recordId: picked.item.rec.id,
    score: picked.score,
    reason: picked.reason,
    candidates,
  };
}

// ----------------------------------------------------------------------------
// 对外入口
// ----------------------------------------------------------------------------

/** 库中与识别菜名「几乎一致」的那道菜；没有则空串 */
function findSameDish(query: Prepared): string {
  const idx = ensureIndex();
  let bestName = '';
  let bestScore = 0;
  idx.names.forEach((name) => {
    const s = similarityPrepared(query, idx.entries[name].name);
    if (s > bestScore) {
      bestScore = s;
      bestName = name;
    }
  });
  return bestScore >= DISH_SAME_THRESHOLD ? bestName : '';
}

// 同一条识别结果会被结果页、详情页、历史页反复解析，输入相同则输出必然相同。
// 缓存住，历史页 30 条记录才不用把全库扫 30 遍。
const matchCache: Record<string, MealMatch> = {};
let matchCacheSize = 0;
const MATCH_CACHE_LIMIT = 60;

function cacheKey(query: RecognizedDish): string {
  const ings = (query.ingredients || [])
    .map((i) => `${i.name}/${i.cookingMethod || ''}`)
    .join(',');
  return `${query.dishName}|${query.cookingMethod}|${ings}`;
}

/** 给识别出的这道菜里的**每一种食材**都找到库中对应的实测数据 */
export function matchMeal(query: RecognizedDish): MealMatch {
  const key = cacheKey(query);
  if (matchCache[key]) return matchCache[key];
  const result = computeMatch(query);
  if (matchCacheSize >= MATCH_CACHE_LIMIT) {
    // 简单粗暴地整体清空，避免在小程序里维护一套 LRU。
    Object.keys(matchCache).forEach((k) => delete matchCache[k]);
    matchCacheSize = 0;
  }
  matchCache[key] = result;
  matchCacheSize += 1;
  return result;
}

function computeMatch(query: RecognizedDish): MealMatch {
  const idx = ensureIndex();
  const dishName = prepareDishName(query.dishName);
  const matchedDish = findSameDish(dishName);
  const dishEntry = matchedDish ? idx.entries[matchedDish] : undefined;

  const list =
    query.ingredients && query.ingredients.length
      ? query.ingredients.slice(0, MAX_QUERY_INGREDIENTS)
      : [{ name: query.dishName, cookingMethod: query.cookingMethod }];

  // 识别结果里偶有重复食材（如「青椒」出现两次），按归一化名去重。
  const seen: Record<string, boolean> = {};
  const ingredients: IngredientMatch[] = [];
  list.forEach((ing) => {
    const k = normalize(ing.name);
    if (!k || seen[k]) return;
    seen[k] = true;
    ingredients.push(matchOneIngredient(ing, query.cookingMethod, dishName, dishEntry));
  });

  return { matchedDish, ingredients };
}

/**
 * 取某条记录的「另一种测试模式」记录：同菜、同食材、同烹饪方式，但测试模式不同。
 * 规则 2：切割与下压都做过时两条并列展示，让用户看到两种受力下的差别。
 */
export function alternateTestModes(recordId: string): TextureRecord[] {
  const rec = findRecordById(recordId);
  if (!rec) return [];
  return recordsOfDish(rec.dish).filter(
    (r) =>
      r.id !== rec.id &&
      normalize(r.ingredient) === normalize(rec.ingredient) &&
      normalize(r.method) === normalize(rec.method) &&
      r.testMode !== rec.testMode,
  );
}

/** 结果页「手动改选」用：按关键词在库里搜食材 / 菜名 */
export function searchRecords(keyword: string, limit = 20): RecordCandidate[] {
  const kwPrepared = prepare(keyword);
  const kw = kwPrepared.norm;
  if (!kw) return [];
  const idx = ensureIndex();
  const scored: { item: IndexedRecord; score: number; reason: string }[] = [];
  idx.records.forEach((item) => {
    if (kw === '花生仁' && /^花生[芽苗]$/.test(item.ingredient.norm)) return;
    const entry = idx.entries[item.rec.dish];
    let s = ingredientSimilarity(kwPrepared, item.ingredient);
    if (item.ingredient.norm.indexOf(kw) >= 0) s = Math.max(s, 0.9);
    if (entry) {
      let ds = similarityPrepared(kwPrepared, entry.name) * 0.9;
      if (entry.name.norm.indexOf(kw) >= 0) ds = Math.max(ds, 0.85);
      s = Math.max(s, ds);
    }
    if (s < 0.3) return;
    scored.push({ item, score: s, reason: `搜索「${keyword}」匹配到` });
  });
  return dedupe(scored)
    .slice(0, limit)
    .map((s) => toCandidate(s.item, s.score, s.reason));
}
