// ============================================================================
// 质构数据匹配引擎（纯本地，无网络、无模型调用）。
//
// 匹配的单位是「一道菜」：一次识别只出一道菜，给出它在质构库里的源数据。
// 识别出的原食材不单独展示，只用来在库里找最像的那道菜。
//
// 按需求文档的两步走：
//   第一步  菜名匹配：识别出的菜名若与库中菜名几乎一致，直接用该菜的数据。
//   第二步  食材匹配：菜名对不上时，拿识别出的原食材 + 烹饪方式去库里找最像的一道菜，
//           遵循「食材优先、烹饪方式其次」——先看食材像不像，再看烹饪方式合不合。
// 另外：同一道菜的同一种食材有多个烹饪时长时，取时间较久的那条（需求第 3 点）。
//
// 结果始终附一组备选菜（candidates），结果页展示在下方供老人自行改选。
// ============================================================================

import { TextureRecord, allDishNames, allRecords, recordsOfDish } from '../data/textureDb';
import { Prepared, normalize, prepare, similarityPrepared } from '../utils/similarity';

/** 菜名判定为「几乎一致」的相似度门槛 */
const DISH_SAME_THRESHOLD = 0.82;
/** 食材匹配可接受的最低总分，低于此值视为没匹配上（但仍给备选） */
const MIN_SCORE = 0.34;
/** 备选菜数量 */
const CANDIDATE_COUNT = 8;
/** 参与打分的识别食材上限：模型偶尔会列出十几种配料，全部参与打分只会拖慢匹配 */
const MAX_QUERY_INGREDIENTS = 6;

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
// 按菜聚合
// ----------------------------------------------------------------------------

/** 库中一道菜的聚合视图 */
export interface DishEntry {
  dish: string;
  category: string;
  /** 展示用记录：同一种原食材只保留烹饪时间最久的那条（需求第 3 点） */
  records: TextureRecord[];
  /** 该菜的全部原始记录 */
  allRecords: TextureRecord[];
  /** 该菜里最久的烹饪时长，用于同分排序 */
  maxMinutes: number;
  /** 菜名的预处理形式（建索引时算一次，匹配时直接用） */
  name: Prepared;
}

/** 打分时用的记录 + 预处理过的食材名 */
interface IndexedRecord {
  rec: TextureRecord;
  ingredient: Prepared;
}

/**
 * 需求第 3 点：同一道菜、同一种原食材有多个烹饪时长版本时，只保留时间较久的一条。
 * 注意不能按「整道菜」统一挑时长——像土豆炖牛肉里土豆测的是 3/6 分钟、
 * 牛肉测的是 30/50 分钟，必须按食材各自取最久的。
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

// 索引同样**懒加载**：第一次匹配时才建，避免拖慢小程序启动。
let index: {
  entries: Record<string, DishEntry>;
  names: string[];
  records: IndexedRecord[];
  /** 记录 id → 预处理过的食材名，搜索时直接查表 */
  ingPrepared: Record<string, Prepared>;
} | null = null;

function ensureIndex() {
  if (index) return index;
  const entries: Record<string, DishEntry> = {};
  const names = allDishNames();
  names.forEach((dish) => {
    const all = recordsOfDish(dish);
    const records = preferLongerCooking(all);
    entries[dish] = {
      dish,
      category: all[0] ? all[0].category : '',
      records,
      allRecords: all,
      maxMinutes: records.reduce((m, r) => Math.max(m, r.minutes), 0),
      name: prepare(dish),
    };
  });
  const records = allRecords().map((rec) => ({ rec, ingredient: prepare(rec.ingredient) }));
  const ingPrepared: Record<string, Prepared> = {};
  records.forEach((r) => {
    ingPrepared[r.rec.id] = r.ingredient;
  });
  index = { entries, names, records, ingPrepared };
  return index;
}

export function getDishEntry(dish: string): DishEntry | undefined {
  return ensureIndex().entries[dish];
}

// ----------------------------------------------------------------------------
// 对外类型
// ----------------------------------------------------------------------------

/** 视觉模型识别出的那道菜（匹配的输入） */
export interface RecognizedDish {
  dishName: string;
  cookingMethod: string;
  /** 识别出的原食材，只用于回库里找最像的菜，不单独展示 */
  ingredients: { name: string; cookingMethod?: string }[];
}

/** 一道备选菜 */
export interface DishCandidate {
  dish: string;
  category: string;
  /** 该菜测了哪些原食材，如「火腿丝、豆腐丝」 */
  ingredientText: string;
  /** 烹饪方式与时长摘要，如「煮 15分钟」 */
  cookingText: string;
  scorePercent: number;
  reason: string;
}

export type MatchType = 'dish' | 'ingredient' | 'none';

/** 一次识别的匹配结果 */
export interface MealMatch {
  matchType: MatchType;
  /** 自动匹配到的库中菜名；none 时为空串 */
  matchedDish: string;
  candidates: DishCandidate[];
}

function toCandidate(entry: DishEntry, score: number, reason: string): DishCandidate {
  const ings = entry.records.map((r) => r.ingredient);
  const methods: string[] = [];
  entry.records.forEach((r) => {
    const t = cookingText(r.method, r.minutes);
    if (methods.indexOf(t) < 0) methods.push(t);
  });
  return {
    dish: entry.dish,
    category: entry.category,
    ingredientText:
      ings.length === 1 && ings[0] === entry.dish ? '整菜取样' : ings.join('、'),
    cookingText: methods.join(' / '),
    scorePercent: Math.round(Math.max(0, Math.min(1, score)) * 100),
    reason,
  };
}

// ----------------------------------------------------------------------------
// 第一步：菜名匹配
// ----------------------------------------------------------------------------

function findSameDish(query: Prepared): { dish: string; score: number } {
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
  return { dish: bestScore >= DISH_SAME_THRESHOLD ? bestName : '', score: bestScore };
}

// ----------------------------------------------------------------------------
// 第二步：食材匹配（食材优先、烹饪方式其次），仍然以「整道菜」为单位打分
// ----------------------------------------------------------------------------

const W_INGREDIENT = 0.78;
const W_METHOD = 0.18;
const W_DISH = 0.04;
/** 一道菜命中多个识别食材时的加成（每多命中一个） */
const MULTI_HIT_BONUS = 0.06;
const MULTI_HIT_CAP = 0.12;

interface ScoredDish {
  candidate: DishCandidate;
  score: number;
  /** 该菜里最久的烹饪时长，用于同分时排序 */
  maxMinutes: number;
}

function rankDishes(query: RecognizedDish, queryName: Prepared): ScoredDish[] {
  const idx = ensureIndex();
  const ingredients = (
    query.ingredients && query.ingredients.length
      ? query.ingredients.slice(0, MAX_QUERY_INGREDIENTS)
      : [{ name: query.dishName, cookingMethod: query.cookingMethod }]
  ).map((ing) => ({
    name: ing.name,
    prepared: prepare(ing.name),
    method: ing.cookingMethod || query.cookingMethod,
  }));

  // 先把「识别食材 × 库中记录」的分数按菜归拢
  interface Acc {
    best: number;
    bestReason: string;
    hits: Record<string, boolean>;
  }
  const acc: Record<string, Acc> = {};

  idx.records.forEach((item) => {
    const rec = item.rec;
    const entry = idx.entries[rec.dish];
    const dishSim = entry ? similarityPrepared(queryName, entry.name) : 0;
    ingredients.forEach((ing) => {
      const ingSim = similarityPrepared(ing.prepared, item.ingredient);
      if (ingSim < 0.15) return;
      const method = ing.method;
      const mScore = methodScore(method, rec.method);
      const score = W_INGREDIENT * ingSim + W_METHOD * mScore + W_DISH * dishSim;
      let reason: string;
      if (!rec.method || !normalize(method)) {
        reason = `识别到的「${ing.name}」与库中「${rec.ingredient}」相近，库中未标注烹饪方式`;
      } else if (mScore >= 1) {
        reason = `识别到的「${ing.name}」与库中「${rec.ingredient}」相近，烹饪方式同为${rec.method}`;
      } else if (mScore >= 0.5) {
        reason = `识别到的「${ing.name}」与库中「${rec.ingredient}」相近，烹饪方式接近（${rec.method}）`;
      } else {
        reason = `识别到的「${ing.name}」与库中「${rec.ingredient}」相近，烹饪方式不同（${rec.method}）`;
      }
      const cur = acc[rec.dish] || { best: 0, bestReason: '', hits: {} };
      if (score > cur.best) {
        cur.best = score;
        cur.bestReason = reason;
      }
      if (ingSim >= 0.5) cur.hits[ing.name] = true;
      acc[rec.dish] = cur;
    });
  });

  const out: ScoredDish[] = [];
  Object.keys(acc).forEach((dish) => {
    const a = acc[dish];
    const entry = idx.entries[dish];
    if (!entry) return;
    const extraHits = Math.max(0, Object.keys(a.hits).length - 1);
    const bonus = Math.min(MULTI_HIT_CAP, extraHits * MULTI_HIT_BONUS);
    const score = Math.min(1, a.best + bonus);
    const reason =
      extraHits > 0 ? `${a.bestReason}；另有 ${extraHits} 种识别到的食材也对得上` : a.bestReason;
    out.push({ candidate: toCandidate(entry, score, reason), score, maxMinutes: entry.maxMinutes });
  });

  // 分数降序；完全同分时按需求第 3 点取烹饪时间更久的那道
  out.sort((a, b) =>
    Math.abs(a.score - b.score) < 1e-6 ? b.maxMinutes - a.maxMinutes : b.score - a.score,
  );
  return out;
}

// ----------------------------------------------------------------------------
// 对外入口
// ----------------------------------------------------------------------------

// 同一条记录会被结果页、详情页、历史页反复解析，而输入完全相同 → 结果必然相同。
// 缓存住，历史页 20 条记录就不用把全库扫 20 遍。
const matchCache: Record<string, MealMatch> = {};
let matchCacheSize = 0;
const MATCH_CACHE_LIMIT = 60;

function cacheKey(query: RecognizedDish): string {
  const ings = (query.ingredients || [])
    .map((i) => `${i.name}/${i.cookingMethod || ''}`)
    .join(',');
  return `${query.dishName}|${query.cookingMethod}|${ings}`;
}

/** 给识别出的这道菜找库中对应的菜：先菜名、后食材 */
export function matchMeal(query: RecognizedDish): MealMatch {
  const key = cacheKey(query);
  if (matchCache[key]) return matchCache[key];
  const result = computeMatch(query);
  if (matchCacheSize >= MATCH_CACHE_LIMIT) {
    // 简单粗暴地整体清空，避免在小程序里维护 LRU。
    Object.keys(matchCache).forEach((k) => delete matchCache[k]);
    matchCacheSize = 0;
  }
  matchCache[key] = result;
  matchCacheSize += 1;
  return result;
}

function computeMatch(query: RecognizedDish): MealMatch {
  const idx = ensureIndex();
  const queryName = prepare(query.dishName);
  const same = findSameDish(queryName);
  const ranked = rankDishes(query, queryName);

  if (same.dish) {
    const entry = idx.entries[same.dish];
    const head = entry
      ? [toCandidate(entry, 1, `菜名与库中「${same.dish}」一致，直接取该菜数据`)]
      : [];
    // 备选里排掉已命中的那道，避免重复出现
    const rest = ranked
      .filter((s) => s.candidate.dish !== same.dish)
      .slice(0, CANDIDATE_COUNT)
      .map((s) => s.candidate);
    return { matchType: 'dish', matchedDish: same.dish, candidates: [...head, ...rest] };
  }

  const top = ranked[0];
  const matched = !!top && top.score >= MIN_SCORE;
  return {
    matchType: matched ? 'ingredient' : 'none',
    matchedDish: matched ? top.candidate.dish : '',
    candidates: ranked.slice(0, CANDIDATE_COUNT).map((s) => s.candidate),
  };
}

/** 结果页「手动搜索」用：按关键词在库里找菜 */
export function searchDishes(keyword: string, limit = 20): DishCandidate[] {
  const kwPrepared = prepare(keyword);
  const kw = kwPrepared.norm;
  if (!kw) return [];
  const idx = ensureIndex();
  const out: ScoredDish[] = [];
  idx.names.forEach((name) => {
    const entry = idx.entries[name];
    let best = similarityPrepared(kwPrepared, entry.name);
    if (entry.name.norm.indexOf(kw) >= 0) best = Math.max(best, 0.9);
    entry.records.forEach((r) => {
      const ing = idx.ingPrepared[r.id];
      if (!ing) return;
      let s = similarityPrepared(kwPrepared, ing) * 0.9;
      if (ing.norm.indexOf(kw) >= 0) s = Math.max(s, 0.8);
      best = Math.max(best, s);
    });
    if (best < 0.3) return;
    out.push({
      candidate: toCandidate(entry, best, `搜索「${keyword}」匹配到`),
      score: best,
      maxMinutes: entry.maxMinutes,
    });
  });
  out.sort((a, b) =>
    Math.abs(a.score - b.score) < 1e-6 ? b.maxMinutes - a.maxMinutes : b.score - a.score,
  );
  return out.slice(0, limit).map((s) => s.candidate);
}
