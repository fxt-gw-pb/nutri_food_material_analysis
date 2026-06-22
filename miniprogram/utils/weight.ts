import { Dish, ConsumptionRatio, ConsumptionRecord } from '../types/index';
import { roundG } from './format';

/**
 * 根据食用比例计算单道菜的实际摄入。
 *   实际摄入菜品重量 = 菜品预估重量 × 食用比例
 *   实际摄入食材重量 = 食材预估重量 × 食用比例
 * 该计算完全在前端完成，不再调用大模型。
 */
export function computeConsumption(dish: Dish, ratio: ConsumptionRatio): ConsumptionRecord {
  return {
    dishId: dish.dishId,
    ratio,
    consumedTotalG: roundG(dish.estimatedTotalG * ratio),
    consumedIngredients: dish.ingredients.map((ing) => ({
      name: ing.name,
      consumedG: roundG(ing.estimatedG * ratio),
    })),
  };
}

/** 汇总一餐的实际摄入总重量 */
export function totalConsumedG(records: ConsumptionRecord[]): number {
  return records.reduce((sum, r) => sum + r.consumedTotalG, 0);
}
