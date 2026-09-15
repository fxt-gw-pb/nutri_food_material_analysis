import { getMealAnalysisResult, saveExcludedIngredients, saveAuditSnapshot } from '../../services/mealService';
import { confidenceLabel } from '../../utils/confidence';
import { formatDateTime, mealTypeLabel } from '../../utils/format';
import { resolveMeal, IngredientRow } from '../../utils/texture';

Page({
  data: {
    imageUrl: '', dateText: '', mealTypeText: '', recognizedName: '', cookingMethod: '',
    confidenceText: '', matchedDish: '', summary: '', matchedCount: 0, totalCount: 0,
    totalWeightText: '', plateDiameterCm: 0, ingredients: [] as IngredientRow[],
    loaded: false, busy: false, evaluationCompleted: false, totalConsumedG: 0,
  },
  analysisId: '',
  excludedIngredients: [] as string[],
  onLoad(query: Record<string, string | undefined>) { this.analysisId = query.analysisId || ''; },
  onShow() { void this.loadMeal(); },
  async loadMeal() {
    if (!this.analysisId) return;
    this.setData({ loaded: false });
    try {
      const meal = await getMealAnalysisResult(this.analysisId);
      const r = resolveMeal(meal.dish, meal.selectedRecords, meal.plateDiameterCm, meal.excludedIngredients);
      this.excludedIngredients = meal.excludedIngredients || [];
      await saveAuditSnapshot(this.analysisId);
      this.setData({
        imageUrl: meal.imageUrl, dateText: formatDateTime(meal.createdAt), mealTypeText: mealTypeLabel(meal.mealType),
        recognizedName: r.recognizedName, cookingMethod: r.cookingMethod,
        confidenceText: confidenceLabel(meal.dish ? meal.dish.recognitionConfidence : 'medium'),
        matchedDish: r.matchedDish, summary: r.summary, matchedCount: r.matchedCount, totalCount: r.totalCount,
        totalWeightText: r.totalWeightText, plateDiameterCm: r.plateDiameterCm, ingredients: r.ingredients,
        loaded: true, evaluationCompleted: meal.evaluationStatus === 'completed', totalConsumedG: meal.consumption?.totalConsumedG || 0,
      });
    } catch (err) {
      console.error('[detail] load failed', err);
      wx.showToast({ title: '加载失败，请联网重试', icon: 'none' });
    }
  },
  async removeIngredient(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || !this.data.loaded) return;
    const name = e.currentTarget.dataset.name as string;
    if (!this.data.ingredients.some((i) => i.name === name)) return;
    this.setData({ busy: true });
    try {
      const answer = await wx.showModal({ title: '删除食材', content: `确定删除「${name}」吗？删除后不再计入这餐的重量和饭后评估。`, confirmColor: '#c44b3e' });
      if (!answer.confirm) return;
      await saveExcludedIngredients(this.analysisId, [...this.excludedIngredients, name]);
      await this.loadMeal();
      wx.showToast({ title: '食材已删除', icon: 'success' });
    } catch (err) {
      console.error('[detail] delete failed', err);
      wx.showToast({ title: '删除未保存，请重试', icon: 'none' });
    } finally { this.setData({ busy: false }); }
  },
  goEvaluation() {
    if (!this.data.loaded || this.data.busy) return;
    wx.navigateTo({ url: `/pages/evaluation/evaluation?analysisId=${encodeURIComponent(this.analysisId)}` });
  },
});
