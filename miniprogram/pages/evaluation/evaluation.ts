import { getMealAnalysisResult, saveConsumptionEvaluation, saveExcludedIngredients } from '../../services/mealService';
import { getEvaluationDraft, saveEvaluationDraft, clearEvaluationDraft } from '../../services/evaluationDraft';
import { MealAnalysis } from '../../types/index';
import { resolveMeal } from '../../utils/texture';
import { formatDateTime } from '../../utils/format';

interface EvaluationRow { name: string; grams: number; percent: number; confirmed: boolean; consumedG: number }

Page({
  data: {
    loaded: false, busy: false, recognizedName: '', dateText: '',
    rows: [] as EvaluationRow[], presets: [0, 25, 50, 75, 100, 200, 500],
    totalConsumedG: 0, remaining: 0, completed: false, saveText: '',
  },
  analysisId: '',
  meal: null as MealAnalysis | null,
  percentages: {} as Record<string, number>,
  saveQueue: Promise.resolve() as Promise<void>,
  revision: 0,
  onLoad(query: Record<string, string | undefined>) {
    this.analysisId = query.analysisId || '';
    void this.loadMeal();
  },
  async loadMeal() {
    if (!this.analysisId) return;
    try {
      this.meal = await getMealAnalysisResult(this.analysisId);
      if (this.meal.status !== 'completed') throw new Error('识别尚未完成');
      const completed = this.meal.evaluationStatus === 'completed';
      const local = getEvaluationDraft(this.analysisId);
      this.percentages = { ...(this.meal.consumption?.percentages || {}),
        ...(!completed && local ? local.percentages : {}) };
      this.setData({ loaded: true, recognizedName: this.meal.dish?.dishName || '这一餐',
        dateText: formatDateTime(this.meal.createdAt), completed,
        saveText: completed ? '已完成饭后评估' : '请逐项确认吃了多少',
      });
      this.refreshRows();
    } catch (err) {
      console.error('[evaluation] load failed', err);
      wx.showToast({ title: '加载失败，请联网后重试', icon: 'none' });
    }
  },
  refreshRows() {
    if (!this.meal) return;
    const meal = this.meal;
    const resolved = resolveMeal(meal.dish, meal.selectedRecords, meal.plateDiameterCm, meal.excludedIngredients);
    const rows = resolved.ingredients.map((i): EvaluationRow => {
      const p = this.percentages[i.name];
      const confirmed = typeof p === 'number' && isFinite(p) && p >= 0 && p <= 500;
      return { name: i.name, grams: i.grams, percent: confirmed ? p : 100, confirmed,
        consumedG: confirmed ? Math.round(i.grams * p) / 100 : 0 };
    });
    this.setData({ rows, remaining: rows.filter((r) => !r.confirmed).length,
      totalConsumedG: Math.round(rows.reduce((s, r) => s + r.consumedG, 0) * 100) / 100 });
  },
  onSliderChange(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
    this.setPercent(e.currentTarget.dataset.name as string, e.detail.value);
  },
  choosePercent(e: WechatMiniprogram.TouchEvent) {
    this.setPercent(e.currentTarget.dataset.name as string, Number(e.currentTarget.dataset.value));
  },
  setPercent(name: string, percent: number) {
    if (this.data.busy || !this.data.loaded || !this.data.rows.some((r) => r.name === name)) return;
    if (!isFinite(percent) || percent < 0 || percent > 500) return;
    this.percentages = { ...this.percentages, [name]: Math.round(percent) };
    this.refreshRows();
    // 已完成记录可修改，点击完成时整份提交；草稿不能把已完成状态改回待评。
    if (!this.data.completed) this.persistDraft();
    else this.setData({ saveText: '比例已修改，请点击“完成评估”保存' });
  },
  persistDraft() {
    const percentages = { ...this.percentages };
    const revision = ++this.revision;
    try {
      saveEvaluationDraft(this.analysisId, percentages);
      this.setData({ saveText: '已保存在此手机，正在同步…' });
    } catch (err) {
      this.setData({ saveText: '本机保存失败，正在尝试同步…' });
    }
    // 串行写入，防止快速滑动时旧请求覆盖新比例。失败保留本地草稿。
    this.saveQueue = this.saveQueue.catch(() => undefined).then(async () => {
      try {
        await saveConsumptionEvaluation(this.analysisId, percentages, false);
        if (revision === this.revision) {
          try { clearEvaluationDraft(this.analysisId); } catch (err) { console.warn('[evaluation] draft cleanup failed', err); }
          this.setData({ saveText: '食用比例已保存' });
        }
      } catch (err) {
        console.error('[evaluation] sync failed', err);
        if (revision === this.revision) this.setData({ saveText: '尚未同步，请联网后点击“完成评估”' });
      }
    });
  },
  async removeIngredient(e: WechatMiniprogram.TouchEvent) {
    if (!this.meal || this.data.busy || !this.data.loaded) return;
    const name = e.currentTarget.dataset.name as string;
    if (!this.data.rows.some((r) => r.name === name)) return;
    this.setData({ busy: true });
    try {
      const answer = await wx.showModal({ title: '删除食材', content: `照片里没有「${name}」？删除后不再计入这餐的重量和评估。`, confirmColor: '#c44b3e' });
      if (!answer.confirm) return;
      await this.saveQueue;
      const excluded = [...(this.meal.excludedIngredients || []), name];
      await saveExcludedIngredients(this.analysisId, excluded);
      this.meal.excludedIngredients = excluded;
      delete this.percentages[name];
      if (!this.data.completed) saveEvaluationDraft(this.analysisId, this.percentages);
      this.refreshRows();
      if (this.data.rows.length === 0) {
        clearEvaluationDraft(this.analysisId);
        this.setData({ completed: true, saveText: '食材已全部删除，这餐无需评估' });
      }
    } catch (err) {
      console.error('[evaluation] delete failed', err);
      wx.showToast({ title: '删除未保存，请重试', icon: 'none' });
    } finally { this.setData({ busy: false }); }
  },
  async completeEvaluation() {
    if (this.data.busy || !this.data.loaded) return;
    if (this.data.remaining) {
      wx.showToast({ title: `还有 ${this.data.remaining} 种食材未确认`, icon: 'none' }); return;
    }
    this.setData({ busy: true });
    try {
      await this.saveQueue;
      await saveConsumptionEvaluation(this.analysisId, { ...this.percentages }, true);
      try { clearEvaluationDraft(this.analysisId); } catch (err) { console.warn('[evaluation] draft cleanup failed', err); }
      this.setData({ completed: true, saveText: '饭后评估已完成，可以记录下一餐' });
      wx.showToast({ title: '评估已保存', icon: 'success' });
      wx.reLaunch({ url: '/pages/index/index' });
    } catch (err) {
      console.error('[evaluation] complete failed', err);
      this.setData({ saveText: '评估未提交成功，请联网后重试' });
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally { this.setData({ busy: false }); }
  },
});
