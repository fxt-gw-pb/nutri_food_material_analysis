import { getMealAnalysisResult } from '../../services/mealService';
import { Dish, ConsumptionRatio } from '../../types/index';
import { confidenceLabel } from '../../utils/confidence';
import { computeConsumption, totalConsumedG } from '../../utils/weight';
import { formatDateTime, ratioLabel } from '../../utils/format';

interface IngredientView {
  name: string;
  estimatedG: number;
  consumedG: number | null;
}

interface DishView {
  dishName: string;
  cookingMethod: string;
  estimatedTotalG: number;
  minTotalG: number;
  maxTotalG: number;
  recognitionConfidenceLabel: string;
  weightConfidenceLabel: string;
  ratioText: string;
  consumedTotalG: number | null;
  ingredients: IngredientView[];
  limitations: string[];
}

Page({
  data: {
    imageUrl: '',
    plateDiameterCm: 0,
    dateText: '',
    dishViews: [] as DishView[],
    totalConsumedG: 0,
  },

  onLoad(query: Record<string, string | undefined>) {
    const analysisId = query.analysisId || '';
    if (!analysisId) {
      wx.showToast({ title: '缺少记录', icon: 'none' });
      return;
    }
    getMealAnalysisResult(analysisId)
      .then((meal) => {
        const ratioMap: Record<string, ConsumptionRatio> = {};
        meal.consumptions.forEach((c) => {
          ratioMap[c.dishId] = c.ratio;
        });
        const dishViews = meal.dishes.map((d) => this.toDishView(d, ratioMap[d.dishId]));
        this.setData({
          imageUrl: meal.imageUrl,
          plateDiameterCm: meal.plateDiameterCm,
          dateText: formatDateTime(meal.createdAt),
          dishViews,
          totalConsumedG: totalConsumedG(meal.consumptions),
        });
      })
      .catch((err) => {
        console.error('[detail] load failed', err);
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  toDishView(dish: Dish, ratio?: ConsumptionRatio): DishView {
    const consumption = ratio ? computeConsumption(dish, ratio) : null;
    const consumedMap: Record<string, number> = {};
    consumption?.consumedIngredients.forEach((ci) => {
      consumedMap[ci.name] = ci.consumedG;
    });
    return {
      dishName: dish.dishName,
      cookingMethod: dish.cookingMethod,
      estimatedTotalG: dish.estimatedTotalG,
      minTotalG: dish.minTotalG,
      maxTotalG: dish.maxTotalG,
      recognitionConfidenceLabel: confidenceLabel(dish.recognitionConfidence),
      weightConfidenceLabel: confidenceLabel(dish.weightConfidence),
      ratioText: ratio ? ratioLabel(ratio) : '未记录',
      consumedTotalG: consumption ? consumption.consumedTotalG : null,
      ingredients: dish.ingredients.map((ing) => ({
        name: ing.name,
        estimatedG: ing.estimatedG,
        consumedG: consumption ? consumedMap[ing.name] ?? null : null,
      })),
      limitations: dish.limitations,
    };
  },
});
