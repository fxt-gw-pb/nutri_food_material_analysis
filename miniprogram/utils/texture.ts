// 把「识别结果 + 用户改选」还原成页面直接可渲染的质构视图。
//
// 匹配结果不落库：每次打开记录都用 services/textureMatch.ts 现算一遍（同样的
// 输入必然得到同样的输出），只有用户手动改过的选择才存进 selections 里覆盖。
// 好处是数据库升级后，老记录也会自动用上新的匹配结果。

import { Dish, TextureSelection } from '../types/index';
import {
  MatchCandidate,
  MatchType,
  MatchedDish,
  matchDish,
} from '../services/textureMatch';
import {
  TextureRecord,
  findRecordById,
  hardnessLabel,
  chewinessLabel,
} from '../data/textureDb';

/** 一道菜里的一个食材项：自动匹配 + 用户改选后的最终结果 */
export interface ResolvedItem {
  /** 识别侧的食材名 */
  queryName: string;
  matchType: MatchType;
  /** 最终选中的质构记录；没匹配上且用户也没选时为 null */
  record: TextureRecord | null;
  /** 自动匹配给出的记录 id（用于判断用户是否改过） */
  autoRecordId: string;
  /** 供用户改选的备选列表 */
  candidates: MatchCandidate[];
  /** 是否由用户手动改过 */
  edited: boolean;
}

export interface ResolvedDish {
  dishId: string;
  dishName: string;
  cookingMethod: string;
  matchType: MatchType;
  /** 菜名匹配命中的库中菜名 */
  matchedDishName: string;
  items: ResolvedItem[];
}

function pickMapOf(selections: TextureSelection[], dishId: string): Record<string, string> {
  const sel = selections.find((s) => s.dishId === dishId);
  const map: Record<string, string> = {};
  (sel ? sel.picks : []).forEach((p) => {
    map[p.queryName] = p.recordId;
  });
  return map;
}

function toResolved(dish: Dish, matched: MatchedDish, picks: Record<string, string>): ResolvedDish {
  return {
    dishId: dish.dishId,
    dishName: dish.dishName,
    cookingMethod: dish.cookingMethod,
    matchType: matched.matchType,
    matchedDishName: matched.matchedDishName,
    items: matched.items.map((item) => {
      const overrideId = picks[item.queryName];
      const finalId = overrideId || item.selectedRecordId;
      return {
        queryName: item.queryName,
        matchType: item.matchType,
        record: finalId ? findRecordById(finalId) || null : null,
        autoRecordId: item.selectedRecordId,
        candidates: item.candidates,
        edited: !!overrideId && overrideId !== item.selectedRecordId,
      };
    }),
  };
}

/** 识别结果 + 用户改选 → 页面视图 */
export function resolveMeal(dishes: Dish[], selections: TextureSelection[]): ResolvedDish[] {
  return dishes.map((dish) => {
    const matched = matchDish({
      dishName: dish.dishName,
      cookingMethod: dish.cookingMethod,
      ingredients: dish.ingredients,
    });
    return toResolved(dish, matched, pickMapOf(selections, dish.dishId));
  });
}

/** 一餐的质构摘要，如「偏软 · 好嚼」；没有任何匹配时返回「未匹配到质构数据」 */
export function summarizeTexture(resolved: ResolvedDish[]): string {
  const records: TextureRecord[] = [];
  resolved.forEach((d) =>
    d.items.forEach((it) => {
      if (it.record) records.push(it.record);
    }),
  );
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

/** 匹配方式 → 展示文案 */
export function matchTypeLabel(type: MatchType): string {
  if (type === 'dish') return '菜名匹配';
  if (type === 'ingredient') return '食材匹配';
  return '未匹配';
}
