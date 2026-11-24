// ============================================================================
// 内置营养成分库（只读）。
//
// 数据来源：《中国食物成分表标准版（第 6 版）》第一册（植物性食物）、第二册（动物性食物）
// 的「表一 能量和食物一般营养成分」，以每 100 g 可食部计。扫描版 PDF 经 scripts/nutrition/
// 本地识别、双遍校对后编译成 nutritionDb.data.ts（受原书版权约束，不进公开仓库）。
// 未收婴幼儿食品与「其他」（药食两用）两类。
//
// 和质构库一样随小程序包下发、首次用到时才解码，计算全部在手机本地完成。
// ============================================================================

import { NUTRITION_CATEGORIES, NUTRITION_FIELDS, NUTRITION_ROWS } from './nutritionDb.data';
import { normalize } from '../utils/similarity';

export type NutrientKey = Exclude<(typeof NUTRITION_FIELDS)[number], 'edible'>;

/** 每 100 g 可食部的含量；null 表示原书未检测（印作「—」），不能当 0 */
export type NutrientValues = Record<NutrientKey, number | null>;

export interface NutritionFood {
  /** 原书食物编码，如 012401x（x 结尾为代表值） */
  code: string;
  /** 原书食物名称，如「米饭（蒸，代表值）」 */
  name: string;
  category: string;
  /** 食部（%）：市售状态下可食部分所占比例 */
  edible: number;
  per100g: NutrientValues;
}

export interface NutrientMeta {
  key: NutrientKey;
  label: string;
  unit: string;
  /** 展示保留的小数位 */
  digits: number;
  /** 页面默认展示的核心几项 */
  main?: boolean;
}

/** 展示顺序与单位，与原书表头一致 */
export const NUTRIENTS: NutrientMeta[] = [
  { key: 'energyKcal', label: '能量', unit: 'kcal', digits: 0, main: true },
  { key: 'protein', label: '蛋白质', unit: 'g', digits: 1, main: true },
  { key: 'fat', label: '脂肪', unit: 'g', digits: 1, main: true },
  { key: 'carbohydrate', label: '碳水化合物', unit: 'g', digits: 1, main: true },
  { key: 'fiber', label: '不溶性膳食纤维', unit: 'g', digits: 1 },
  { key: 'cholesterol', label: '胆固醇', unit: 'mg', digits: 0 },
  { key: 'vitaminA', label: '维生素A', unit: 'μgRAE', digits: 0 },
  { key: 'thiamin', label: '维生素B1（硫胺素）', unit: 'mg', digits: 2 },
  { key: 'riboflavin', label: '维生素B2（核黄素）', unit: 'mg', digits: 2 },
  { key: 'niacin', label: '烟酸', unit: 'mg', digits: 1 },
  { key: 'vitaminC', label: '维生素C', unit: 'mg', digits: 1 },
  { key: 'vitaminE', label: '维生素E', unit: 'mg', digits: 1 },
  { key: 'calcium', label: '钙', unit: 'mg', digits: 0 },
  { key: 'phosphorus', label: '磷', unit: 'mg', digits: 0 },
  { key: 'potassium', label: '钾', unit: 'mg', digits: 0 },
  { key: 'sodium', label: '钠', unit: 'mg', digits: 0 },
  { key: 'magnesium', label: '镁', unit: 'mg', digits: 0 },
  { key: 'iron', label: '铁', unit: 'mg', digits: 1 },
  { key: 'zinc', label: '锌', unit: 'mg', digits: 1 },
  { key: 'selenium', label: '硒', unit: 'μg', digits: 1 },
  { key: 'copper', label: '铜', unit: 'mg', digits: 2 },
  { key: 'manganese', label: '锰', unit: 'mg', digits: 2 },
];

/** 名称拆成主名与别名：「马铃薯［土豆、洋芋］」→ 马铃薯 / 土豆 / 洋芋 */
function nameParts(name: string): { base: string; aliases: string[] } {
  const base = name.split(/[（［(\[]/)[0];
  const aliases: string[] = [];
  const re = /［([^］]*)］/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(name))) {
    m[1].split(/[，、,]/).forEach((a) => { if (a.trim()) aliases.push(a.trim()); });
  }
  return { base, aliases };
}

let cache: {
  foods: NutritionFood[];
  byCode: Record<string, NutritionFood>;
  /** 归一化全名 → 食物 */
  byName: Record<string, NutritionFood[]>;
  /** 归一化主名或别名 → 食物 */
  byBase: Record<string, NutritionFood[]>;
  bases: { key: string; food: NutritionFood }[];
} | null = null;

function ensure() {
  if (cache) return cache;
  const fields = NUTRITION_FIELDS;
  const foods: NutritionFood[] = NUTRITION_ROWS.map((row) => {
    const per100g = {} as NutrientValues;
    let edible = 100;
    fields.forEach((key, i) => {
      const v = row[3 + i];
      const value = typeof v === 'number' ? v : null;
      if (key === 'edible') edible = value && value > 0 ? value : 100;
      else per100g[key] = value;
    });
    return { code: row[0], name: row[1], category: NUTRITION_CATEGORIES[row[2]] || '', edible, per100g };
  });
  const byCode: Record<string, NutritionFood> = {};
  const byName: Record<string, NutritionFood[]> = {};
  const byBase: Record<string, NutritionFood[]> = {};
  const bases: { key: string; food: NutritionFood }[] = [];
  const push = (map: Record<string, NutritionFood[]>, key: string, food: NutritionFood) => {
    if (!key) return;
    (map[key] = map[key] || []).push(food);
  };
  foods.forEach((food) => {
    byCode[food.code] = food;
    push(byName, normalize(food.name), food);
    const { base, aliases } = nameParts(food.name);
    [base, ...aliases].forEach((n) => {
      const key = normalize(n);
      push(byBase, key, food);
      if (key.length >= 2) bases.push({ key, food });
    });
  });
  cache = { foods, byCode, byName, byBase, bases };
  return cache;
}

export function allNutritionFoods(): NutritionFood[] {
  return ensure().foods;
}

export function findNutritionFood(code: string): NutritionFood | undefined {
  return ensure().byCode[code];
}

/** 全名精确相同的食物（已归一化） */
export function foodsByFullName(name: string): NutritionFood[] {
  return ensure().byName[normalize(name)] || [];
}

/** 主名或别名相同的食物，如「土豆」→ 马铃薯［土豆、洋芋］ */
export function foodsByBaseName(name: string): NutritionFood[] {
  return ensure().byBase[normalize(name)] || [];
}

/** 全部主名与别名（长度 ≥ 2），供「名字里包含某种食物」的兜底匹配 */
export function nutritionBaseNames(): { key: string; food: NutritionFood }[] {
  return ensure().bases;
}
