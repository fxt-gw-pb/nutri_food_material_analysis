import { getMealAnalysisResult } from '../../services/mealService';
import { confidenceLabel } from '../../utils/confidence';
import { formatDateTime, mealTypeLabel } from '../../utils/format';
import { resolveMeal, matchTypeLabel, TextureRow } from '../../utils/texture';

Page({
  data: {
    imageUrl: '',
    dateText: '',
    mealTypeText: '',
    recognizedName: '',
    cookingMethod: '',
    confidenceText: '',
    matchTypeText: '',
    matchedDish: '',
    matched: false,
    edited: false,
    summary: '',
    rows: [] as TextureRow[],
  },

  onLoad(query: Record<string, string | undefined>) {
    const analysisId = query.analysisId || '';
    if (!analysisId) {
      wx.showToast({ title: '缺少记录', icon: 'none' });
      return;
    }
    getMealAnalysisResult(analysisId)
      .then((meal) => {
        const r = resolveMeal(meal.dish, meal.selectedDish);
        this.setData({
          imageUrl: meal.imageUrl,
          dateText: formatDateTime(meal.createdAt),
          mealTypeText: mealTypeLabel(meal.mealType),
          recognizedName: r.recognizedName,
          cookingMethod: r.cookingMethod,
          confidenceText: confidenceLabel(meal.dish ? meal.dish.recognitionConfidence : 'medium'),
          matchTypeText: matchTypeLabel(r.matchType),
          matchedDish: r.matchedDish,
          matched: r.rows.length > 0,
          edited: r.edited,
          summary: r.summary,
          rows: r.rows,
        });
      })
      .catch((err) => {
        console.error('[detail] load failed', err);
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },
});
