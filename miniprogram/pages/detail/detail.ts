import { getMealAnalysisResult, saveExcludedIngredients, saveAuditSnapshot, finishMealSession } from '../../services/mealService';
import { confidenceLabel } from '../../utils/confidence';
import { formatDateTime, mealTypeLabel } from '../../utils/format';
import { resolveMeal, IngredientRow } from '../../utils/texture';
import { confirmRetake } from '../../utils/retakeNavigation';
import { clearMealSession } from '../../utils/mealSession';
import { chinaDateKey, dishIntakeItems, summarizeIntake } from '../../utils/intake';
import { SummaryView, toSummaryView } from '../../utils/intakeView';

Page({
  data: {
    imageUrl: '', participantCode: '', dateText: '', mealTypeText: '', recognizedName: '', cookingMethod: '',
    confidenceText: '', matchedDish: '', summary: '', matchedCount: 0, totalCount: 0,
    totalWeightText: '', plateDiameterCm: 0, ingredients: [] as (IngredientRow & { detailOpen: boolean })[],
    loaded: false, loadError: '', busy: false, evaluationCompleted: false, totalConsumedG: 0,
    mealSessionId: '', sessionFinished: false,
    /** 已完成饭后评估时，这道菜吃下的质构系数与营养 */
    intake: null as SummaryView | null, textureOpen: false, nutrientOpen: false, dateKey: '',
  },
  analysisId: '',
  excludedIngredients: [] as string[],
  onLoad(query: Record<string, string | undefined>) { this.analysisId = query.analysisId || ''; },
  onShow() { void this.loadMeal(); },
  async loadMeal() {
    if (!this.analysisId) {
      this.setData({ loadError: '缺少记录编号，请返回饮食记录重新打开。' });
      return;
    }
    this.setData({ loaded: false, loadError: '' });
    try {
      const meal = await getMealAnalysisResult(this.analysisId);
      if (meal.status === 'discarded') {
        wx.showToast({ title: '这条识别已作废', icon: 'none' });
        wx.reLaunch({ url: '/pages/index/index' });
        return;
      }
      const r = resolveMeal(meal.dish, meal.selectedRecords, meal.plateDiameterCm, meal.excludedIngredients);
      this.excludedIngredients = meal.excludedIngredients || [];
      await saveAuditSnapshot(this.analysisId);
      this.setData({
        imageUrl: meal.imageUrl, participantCode: meal.participantCode || '',
        dateText: formatDateTime(meal.createdAt), mealTypeText: mealTypeLabel(meal.mealType),
        recognizedName: r.recognizedName, cookingMethod: r.cookingMethod,
        confidenceText: confidenceLabel(meal.dish ? meal.dish.recognitionConfidence : 'medium'),
        matchedDish: r.matchedDish, summary: r.summary, matchedCount: r.matchedCount, totalCount: r.totalCount,
        totalWeightText: r.totalWeightText, plateDiameterCm: r.plateDiameterCm,
        ingredients: r.ingredients.map((row) => ({ ...row, detailOpen: this.data.ingredients.find((old) => old.name === row.name)?.detailOpen || false })),
        loaded: true, evaluationCompleted: meal.evaluationStatus === 'completed', totalConsumedG: meal.consumption?.totalConsumedG || 0,
        mealSessionId: meal.mealSessionId || '', sessionFinished: Boolean(meal.mealSessionFinishedAt),
        intake: meal.evaluationStatus === 'completed' && meal.consumption && r.totalCount > 0
          ? toSummaryView(summarizeIntake(dishIntakeItems(meal))) : null,
        dateKey: chinaDateKey(meal.createdAt),
      });
    } catch (err) {
      console.error('[detail] load failed', err);
      this.setData({ loadError: '请检查网络后重试，饮食记录仍会保留。' });
      wx.showToast({ title: '加载失败，请联网重试', icon: 'none' });
    }
  },
  toggleDetail(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    if (!this.data.ingredients[index]) return;
    this.setData({ [`ingredients[${index}].detailOpen`]: !this.data.ingredients[index].detailOpen });
  },
  previewImage() {
    if (this.data.imageUrl) wx.previewImage({ current: this.data.imageUrl, urls: [this.data.imageUrl] });
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
  async retake() {
    if (this.data.busy || !this.data.loaded || (this.data.evaluationCompleted && this.data.totalCount > 0)) return;
    this.setData({ busy: true });
    try { await confirmRetake(this.analysisId, undefined, this.data.mealSessionId); }
    finally { this.setData({ busy: false }); }
  },
  toggleTexture() { this.setData({ textureOpen: !this.data.textureOpen }); },
  toggleNutrient() { this.setData({ nutrientOpen: !this.data.nutrientOpen }); },
  goDaily() {
    if (!this.data.participantCode) return;
    wx.navigateTo({ url: `/pages/daily/daily?participantCode=${encodeURIComponent(this.data.participantCode)}&date=${this.data.dateKey}&analysisId=${encodeURIComponent(this.analysisId)}` });
  },
  goEvaluation() {
    if (!this.data.loaded || this.data.busy) return;
    if (this.data.mealSessionId && !this.data.sessionFinished) {
      wx.showToast({ title: '请先结束本顿饭的菜品识别', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/evaluation/evaluation?analysisId=${encodeURIComponent(this.analysisId)}` });
  },

  continueMeal() {
    if (!this.data.mealSessionId || this.data.busy) return;
    wx.navigateTo({ url: `/pages/upload/upload?mealSessionId=${encodeURIComponent(this.data.mealSessionId)}` });
  },

  async finishMeal() {
    if (!this.data.mealSessionId || this.data.busy || !this.data.loaded) return;
    this.setData({ busy: true });
    try {
      const answer = await wx.showModal({
        title: '结束这顿饭的识别？',
        content: '确认后会保存本顿饭的菜品，吃完饭再到历史记录里填写每道菜吃了多少。',
        confirmText: '确认结束',
        confirmColor: '#2fae76',
      });
      if (!answer.confirm) return;
      await finishMealSession(this.data.mealSessionId);
      clearMealSession(this.data.mealSessionId);
      wx.showToast({ title: '本顿饭已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
    } catch (err) {
      console.error('[detail] finish meal failed', err);
      wx.showToast({ title: '本顿饭未保存，请重试', icon: 'none' });
    } finally { this.setData({ busy: false }); }
  },
});
