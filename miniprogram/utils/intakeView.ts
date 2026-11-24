// 摄入汇总 → 页面展示用的视图（每日汇总、记录详情、饭后评估共用）。

import { IntakeSummary } from './intake';

/** 页面用的汇总视图：数值都已格式化 */
export interface SummaryView {
  consumedG: number;
  hasTexture: boolean;
  hardnessText: string;
  hardnessLabel: string;
  chewinessText: string;
  chewinessLabel: string;
  textureG: number;
  texture: { label: string; valueText: string; unit: string; grams: number }[];
  hasNutrition: boolean;
  energyText: string;
  mainNutrients: { label: string; valueText: string; unit: string; incomplete: boolean }[];
  otherNutrients: { label: string; valueText: string; unit: string; incomplete: boolean }[];
  nutritionG: number;
  /** 有营养素因原书缺测而合计偏低，页面加脚注 */
  hasIncomplete: boolean;
  noTexture: string;
  noNutrition: string;
}

export function toSummaryView(s: IntakeSummary): SummaryView {
  const nutrient = (n: IntakeSummary['nutrients'][number]) => ({ label: n.label, valueText: n.valueText, unit: n.unit, incomplete: n.incomplete });
  return {
    consumedG: s.consumedG,
    hasTexture: s.hardness.value !== null,
    hardnessText: s.hardness.valueText,
    hardnessLabel: s.hardnessText,
    chewinessText: s.texture.find((t) => t.key === 'chewiness')!.valueText,
    chewinessLabel: s.chewinessText,
    textureG: s.textureG,
    texture: s.texture.map((t) => ({ label: t.label, valueText: t.valueText, unit: t.unit, grams: t.grams })),
    hasNutrition: s.nutritionG > 0,
    energyText: s.nutrients[0].valueText,
    mainNutrients: s.nutrients.filter((n) => n.main).map(nutrient),
    otherNutrients: s.nutrients.filter((n) => !n.main).map(nutrient),
    nutritionG: s.nutritionG,
    hasIncomplete: s.nutrients.some((n) => n.incomplete),
    noTexture: s.noTexture.join('、'),
    noNutrition: s.noNutrition.join('、'),
  };
}
