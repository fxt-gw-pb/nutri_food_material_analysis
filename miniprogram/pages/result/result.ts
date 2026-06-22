import {
  getMealAnalysisResult,
  saveDishConsumption,
} from '../../services/mealService';
import { Dish, ConsumptionRatio, ConsumptionRecord } from '../../types/index';
import { confidenceLabel } from '../../utils/confidence';
import { computeConsumption } from '../../utils/weight';
import { formatDateTime } from '../../utils/format';

interface IngredientView {
  name: string;
  estimatedG: number;
  minG: number;
  maxG: number;
  confidenceLabel: string;
  consumedG: number | null;
}

interface DishView {
  dishId: string;
  dishName: string;
  cookingMethod: string;
  estimatedTotalG: number;
  minTotalG: number;
  maxTotalG: number;
  recognitionConfidenceLabel: string;
  weightConfidenceLabel: string;
  ingredients: IngredientView[];
  limitations: string[];
  selectedRatio: number | null;
  consumedTotalG: number | null;
}

const RATIO_CHOICES: { label: string; value: ConsumptionRatio }[] = [
  { label: '1/4', value: 0.25 },
  { label: '1/2', value: 0.5 },
  { label: '3/4', value: 0.75 },
  { label: '全吃完', value: 1 },
];

Page({
  data: {
    imageUrl: '',
    plateDiameterCm: 0,
    dateText: '',
    ratioChoices: RATIO_CHOICES,
    dishViews: [] as DishView[],
    totalConsumedG: 0,
    allSelected: false,
  },

  analysisId: '',
  dishes: [] as Dish[],

  onLoad(query: Record<string, string | undefined>) {
    this.analysisId = query.analysisId || '';
    if (!this.analysisId) {
      wx.showToast({ title: '缺少分析记录', icon: 'none' });
      return;
    }
    getMealAnalysisResult(this.analysisId)
      .then((meal) => {
        this.dishes = meal.dishes;
        const savedRatio: Record<string, ConsumptionRatio> = {};
        meal.consumptions.forEach((c) => {
          savedRatio[c.dishId] = c.ratio;
        });
        const dishViews = meal.dishes.map((d) => this.toDishView(d, savedRatio[d.dishId]));
        this.setData({
          imageUrl: meal.imageUrl,
          plateDiameterCm: meal.plateDiameterCm,
          dateText: formatDateTime(meal.createdAt),
          dishViews,
        });
        this.refreshTotals(dishViews);
      })
      .catch((err) => {
        console.error('[result] load failed', err);
        wx.showToast({ title: '加载结果失败', icon: 'none' });
      });
  },

  toDishView(dish: Dish, ratio?: ConsumptionRatio): DishView {
    const consumption = ratio ? computeConsumption(dish, ratio) : null;
    const consumedMap: Record<string, number> = {};
    consumption?.consumedIngredients.forEach((ci) => {
      consumedMap[ci.name] = ci.consumedG;
    });
    return {
      dishId: dish.dishId,
      dishName: dish.dishName,
      cookingMethod: dish.cookingMethod,
      estimatedTotalG: dish.estimatedTotalG,
      minTotalG: dish.minTotalG,
      maxTotalG: dish.maxTotalG,
      recognitionConfidenceLabel: confidenceLabel(dish.recognitionConfidence),
      weightConfidenceLabel: confidenceLabel(dish.weightConfidence),
      ingredients: dish.ingredients.map((ing) => ({
        name: ing.name,
        estimatedG: ing.estimatedG,
        minG: ing.minG,
        maxG: ing.maxG,
        confidenceLabel: confidenceLabel(ing.confidence),
        consumedG: consumption ? consumedMap[ing.name] ?? null : null,
      })),
      limitations: dish.limitations,
      selectedRatio: ratio ?? null,
      consumedTotalG: consumption ? consumption.consumedTotalG : null,
    };
  },

  selectRatio(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const ratio = Number(e.currentTarget.dataset.ratio) as ConsumptionRatio;
    const dish = this.dishes[index];
    if (!dish) {
      return;
    }
    const dishViews = this.data.dishViews.slice();
    dishViews[index] = this.toDishView(dish, ratio);
    this.setData({ dishViews });
    this.refreshTotals(dishViews);
    this.persist(dishViews);
  },

  refreshTotals(dishViews: DishView[]) {
    const total = dishViews.reduce((sum, d) => sum + (d.consumedTotalG ?? 0), 0);
    const allSelected = dishViews.length > 0 && dishViews.every((d) => d.selectedRatio !== null);
    this.setData({ totalConsumedG: total, allSelected });
  },

  persist(dishViews: DishView[]) {
    const records: ConsumptionRecord[] = [];
    dishViews.forEach((dv, i) => {
      if (dv.selectedRatio !== null) {
        records.push(computeConsumption(this.dishes[i], dv.selectedRatio as ConsumptionRatio));
      }
    });
    saveDishConsumption(this.analysisId, records).catch((err) => {
      console.error('[result] save consumption failed', err);
    });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
});
