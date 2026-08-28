import { getMealAnalysisResult } from '../../services/mealService';
import { confidenceLabel } from '../../utils/confidence';
import { formatDateTime, mealTypeLabel } from '../../utils/format';
import { resolveMeal, IngredientRow } from '../../utils/texture';

Page({
  data: {
    imageUrl: '',
    dateText: '',
    mealTypeText: '',
    recognizedName: '',
    cookingMethod: '',
    confidenceText: '',
    matchedDish: '',
    summary: '',
    matchedCount: 0,
    totalCount: 0,
    /** 逐食材结果（详情页只读，九项指标全部展开） */
    ingredients: [] as IngredientRow[],
  },

  onLoad(query: Record<string, string | undefined>) {
    const analysisId = query.analysisId || '';
    if (!analysisId) {
      wx.showToast({ title: '缺少记录', icon: 'none' });
      return;
    }
    getMealAnalysisResult(analysisId)
      .then((meal) => {
        const r = resolveMeal(meal.dish, meal.selectedRecords);
        this.setData({
          imageUrl: meal.imageUrl,
          dateText: formatDateTime(meal.createdAt),
          mealTypeText: mealTypeLabel(meal.mealType),
          recognizedName: r.recognizedName,
          cookingMethod: r.cookingMethod,
          confidenceText: confidenceLabel(meal.dish ? meal.dish.recognitionConfidence : 'medium'),
          matchedDish: r.matchedDish,
          summary: r.summary,
          matchedCount: r.matchedCount,
          totalCount: r.totalCount,
          ingredients: r.ingredients,
        });
      })
      .catch((err) => {
        console.error('[detail] load failed', err);
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },
});
