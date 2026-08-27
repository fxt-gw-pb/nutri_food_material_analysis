// 展示格式化工具。

import { MealType } from '../types/index';

/** 餐次选项（有序，供选择器渲染） */
export const MEAL_TYPE_OPTIONS: { type: MealType; label: string }[] = [
  { type: 'breakfast', label: '早餐' },
  { type: 'morning_snack', label: '早加餐' },
  { type: 'lunch', label: '午餐' },
  { type: 'afternoon_snack', label: '下午加餐' },
  { type: 'dinner', label: '晚餐' },
  { type: 'evening_snack', label: '晚加餐' },
];

const MEAL_TYPE_LABEL: Record<MealType, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '下午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
};

/** 餐次 → 文案 */
export function mealTypeLabel(type?: MealType): string {
  return type ? MEAL_TYPE_LABEL[type] : '未选择';
}

/** 按当前时段推荐餐次（结果页默认选中，用户可改） */
export function suggestMealType(date = new Date()): MealType {
  const h = date.getHours();
  if (h >= 5 && h < 10) return 'breakfast';
  if (h >= 10 && h < 11) return 'morning_snack';
  if (h >= 11 && h < 14) return 'lunch';
  if (h >= 14 && h < 17) return 'afternoon_snack';
  if (h >= 17 && h < 21) return 'dinner';
  return 'evening_snack';
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 时间戳 → YYYY-MM-DD */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 时间戳 → YYYY-MM-DD HH:mm */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${formatDate(ts)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
