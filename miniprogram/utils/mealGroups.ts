// 饮食记录分层：日期 → 这一天的哪一餐 → 这一餐的菜品。
// 同一参与者、同一北京时间自然日、同一餐次的菜归为「一餐」，方便老人按顿找到并逐道评估。
// 餐次以结果页选的 mealType 为准；没选过的旧记录归入「未选餐次」。

import { MealHistoryItem, MealType } from '../types/index';
import { MEAL_TYPE_OPTIONS, mealTypeLabel } from './format';
import { chinaDateKey, chinaDayRange, shiftDateKey, weekdayOf } from './intake';

export interface MealGroup {
  key: string;
  participantCode: string;
  dateKey: string;
  /** 空字符串表示未选餐次 */
  mealType: MealType | '';
  mealTypeText: string;
  analysisIds: string[];
  dishCount: number;
  pendingCount: number;
  evaluatedCount: number;
  /** 菜名摘要，如「番茄炒蛋、米饭、青菜」 */
  dishNames: string;
  /** 最多 3 张缩略图 */
  thumbs: string[];
  statusClass: 'pending' | 'evaluated';
  statusText: string;
}

export interface DayGroup {
  dateKey: string;
  dateText: string;
  /** 今天 / 昨天，其余为空 */
  label: string;
  meals: MealGroup[];
}

const MEAL_ORDER: string[] = MEAL_TYPE_OPTIONS.map((o) => o.type);

export function mealGroupKey(participantCode: string, dateKey: string, mealType: string): string {
  return `${participantCode}|${dateKey}|${mealType || 'none'}`;
}

/** 「2026-11-27」→「11月27日 周五」 */
export function dayText(dateKey: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(dateKey);
  return m ? `${Number(m[1])}月${Number(m[2])}日 ${weekdayOf(dateKey)}` : dateKey;
}

export function dayLabel(dateKey: string, now = Date.now()): string {
  const today = chinaDateKey(now);
  if (dateKey === today) return '今天';
  if (dateKey === shiftDateKey(today, -1)) return '昨天';
  return '';
}

export function mealGroupTitle(mealType: string): string {
  return mealType ? mealTypeLabel(mealType as MealType) : '未选餐次';
}

/** 历史记录 → 按天分组、天内按餐次排序（早餐在前）；天按日期倒序。 */
export function groupHistory(items: MealHistoryItem[], now = Date.now()): DayGroup[] {
  const meals = new Map<string, MealGroup>();
  const firstAt = new Map<string, number>();
  for (const item of [...items].sort((a, b) => a.date - b.date)) {
    const code = item.participantCode || '';
    const dateKey = chinaDateKey(item.date);
    const mealType = (item.mealType || '') as MealType | '';
    const key = mealGroupKey(code, dateKey, mealType);
    let group = meals.get(key);
    if (!group) {
      group = { key, participantCode: code, dateKey, mealType, mealTypeText: mealGroupTitle(mealType), analysisIds: [],
        dishCount: 0, pendingCount: 0, evaluatedCount: 0, dishNames: '', thumbs: [], statusClass: 'pending', statusText: '' };
      meals.set(key, group);
      firstAt.set(key, item.date);
    }
    group.analysisIds.push(item.analysisId);
    group.dishCount += 1;
    if (item.evaluationStatus === 'completed') group.evaluatedCount += 1; else group.pendingCount += 1;
    group.dishNames = group.dishNames ? `${group.dishNames}、${item.dishName}` : item.dishName;
    if (item.imageUrl && group.thumbs.length < 3) group.thumbs.push(item.imageUrl);
  }
  const days = new Map<string, DayGroup>();
  for (const group of meals.values()) {
    group.statusClass = group.pendingCount ? 'pending' : 'evaluated';
    group.statusText = group.pendingCount ? `${group.pendingCount} 道待评估` : '✓ 已评估';
    if (!days.has(group.dateKey)) {
      days.set(group.dateKey, { dateKey: group.dateKey, dateText: dayText(group.dateKey), label: dayLabel(group.dateKey, now), meals: [] });
    }
    (days.get(group.dateKey) as DayGroup).meals.push(group);
  }
  const order = (t: string) => (t ? MEAL_ORDER.indexOf(t) : MEAL_ORDER.length);
  const result = [...days.values()].sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0));
  result.forEach((day) => day.meals.sort((a, b) => order(a.mealType) - order(b.mealType)
    || (firstAt.get(a.key) as number) - (firstAt.get(b.key) as number)
    || a.participantCode.localeCompare(b.participantCode)));
  return result;
}

/** 「这一餐」页的查询参数是否有效 */
export function validMealQuery(dateKey: string): boolean {
  return !!chinaDayRange(dateKey);
}
