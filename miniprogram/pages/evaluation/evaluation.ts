import { getMealAnalysisResult, saveConsumptionEvaluation, saveExcludedIngredients } from '../../services/mealService';
import { getEvaluationDraft, saveEvaluationDraft, clearEvaluationDraft } from '../../services/evaluationDraft';
import { MealAnalysis } from '../../types/index';
import { resolveMeal } from '../../utils/texture';
import { formatDateTime } from '../../utils/format';
import { confirmRetake } from '../../utils/retakeNavigation';
import { chinaDateKey, dishIntakeItems, summarizeIntake } from '../../utils/intake';
import { SummaryView, toSummaryView } from '../../utils/intakeView';

/** 滑条只到 100%（不识字的老人拖到头就是吃完）；超过一份用预设按钮或输入框，最多 500%。 */
const SLIDER_MAX = 100;
const MAX_PERCENT = 500;

interface EvaluationRow {
  name: string; grams: number; percent: number; confirmed: boolean; consumedG: number;
  /** 滑条位置：比例超过 100% 时停在最右 */
  sliderValue: number;
  /** 输入框里显示的数字 */
  inputText: string;
}

Page({
  data: {
    loaded: false, loadError: '', busy: false, recognizedName: '', dateText: '',
    participantCode: '', imageUrl: '',
    rows: [] as EvaluationRow[], presets: [0, 25, 50, 75, 100, 200, 500],
    totalConsumedG: 0, remaining: 0, completed: false, saveText: '',
    /** 按已确认比例算出的这道菜摄入（质量加权切割质构 + 营养）；还没确认任何食材时为 null */
    intake: null as SummaryView | null, textureOpen: false, nutrientOpen: false,
  },
  analysisId: '',
  meal: null as MealAnalysis | null,
  percentages: {} as Record<string, number>,
  saveQueue: null as Promise<void> | null,
  revision: 0,
  /** 从「这一餐」页进来：评估完回到那一页，接着评估同一餐的下一道菜 */
  fromMeal: false,
  onLoad(query: Record<string, string | undefined>) {
    this.saveQueue = Promise.resolve();
    this.fromMeal = query.from === 'meal';
    this.analysisId = query.analysisId || '';
    void this.loadMeal();
  },
  async loadMeal() {
    if (!this.analysisId) {
      this.setData({ loadError: '缺少记录编号，请返回饮食记录重新打开。' });
      return;
    }
    this.setData({ loadError: '' });
    try {
      this.meal = await getMealAnalysisResult(this.analysisId);
      if (this.meal.status === 'discarded') {
        wx.showToast({ title: '这条识别已作废', icon: 'none' });
        wx.reLaunch({ url: '/pages/index/index' });
        return;
      }
      if (this.meal.status !== 'completed') throw new Error('识别尚未完成');
      // 同一饭局的所有菜拍完前，不允许从历史或深链提前填写某一道菜的比例。
      if (this.meal.mealSessionId && !this.meal.mealSessionFinishedAt) {
        wx.showToast({ title: '请先结束本顿饭的菜品识别', icon: 'none' });
        wx.navigateBack({ delta: 1 });
        return;
      }
      const completed = this.meal.evaluationStatus === 'completed';
      const local = getEvaluationDraft(this.analysisId);
      this.percentages = { ...(this.meal.consumption?.percentages || {}),
        ...(!completed && local ? local.percentages : {}) };
      this.setData({ loaded: true, recognizedName: this.meal.dish?.dishName || '这一餐',
        participantCode: this.meal.participantCode || '', imageUrl: this.meal.imageUrl,
        dateText: formatDateTime(this.meal.createdAt), completed,
        saveText: completed ? '已完成饭后评估' : '请逐项确认吃了多少',
      });
      this.refreshRows();
    } catch (err) {
      console.error('[evaluation] load failed', err);
      this.setData({ loadError: '请检查网络后重试，已填写的草稿仍会保留。' });
      wx.showToast({ title: '加载失败，请联网后重试', icon: 'none' });
    }
  },
  previewImage() {
    if (this.data.imageUrl) wx.previewImage({ current: this.data.imageUrl, urls: [this.data.imageUrl] });
  },
  refreshRows() {
    if (!this.meal) return;
    const meal = this.meal;
    const resolved = resolveMeal(meal.dish, meal.selectedRecords, meal.plateDiameterCm, meal.excludedIngredients);
    const rows = resolved.ingredients.map((i): EvaluationRow => {
      const p = this.percentages[i.name];
      const confirmed = typeof p === 'number' && isFinite(p) && p >= 0 && p <= 500;
      const percent = confirmed ? p : 100;
      return { name: i.name, grams: i.grams, percent, confirmed,
        consumedG: confirmed ? Math.round(i.grams * p) / 100 : 0,
        sliderValue: Math.min(percent, SLIDER_MAX), inputText: confirmed ? String(p) : '' };
    });
    const grams: Record<string, number> = {};
    rows.forEach((r) => { if (r.confirmed) grams[r.name] = r.consumedG; });
    const confirmedCount = Object.keys(grams).length;
    const intake = confirmedCount ? toSummaryView(summarizeIntake(dishIntakeItems(meal, grams))) : null;
    this.setData({ rows, remaining: rows.filter((r) => !r.confirmed).length, intake,
      totalConsumedG: Math.round(rows.reduce((s, r) => s + r.consumedG, 0) * 100) / 100 });
  },
  toggleTexture() { this.setData({ textureOpen: !this.data.textureOpen }); },
  toggleNutrient() { this.setData({ nutrientOpen: !this.data.nutrientOpen }); },
  onSliderChange(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
    this.setPercent(e.currentTarget.dataset.name as string, e.detail.value);
  },
  /** 输入框：点键盘上的完成或离开输入框时生效，只收 0–500 的整数 */
  applyManual(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const name = e.currentTarget.dataset.name as string;
    const raw = String((e.detail && e.detail.value) ?? '').trim();
    const row = this.data.rows.find((r) => r.name === name);
    if (!raw || !row || this.data.busy || !this.data.loaded) return;
    const value = Number(raw);
    if (!/^\d{1,3}$/.test(raw) || value > MAX_PERCENT) {
      wx.showToast({ title: `请输入 0 到 ${MAX_PERCENT} 之间的整数`, icon: 'none' });
      return;
    }
    if (row.confirmed && row.percent === value) return;
    this.setPercent(name, value);
  },
  choosePercent(e: WechatMiniprogram.TouchEvent) {
    this.setPercent(e.currentTarget.dataset.name as string, Number(e.currentTarget.dataset.value));
  },
  setPercent(name: string, percent: number) {
    if (this.data.busy || !this.data.loaded || !this.data.rows.some((r) => r.name === name)) return;
    if (!isFinite(percent) || percent < 0 || percent > MAX_PERCENT) return;
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
    this.saveQueue = (this.saveQueue || Promise.resolve()).catch(() => undefined).then(async () => {
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
  async retake() {
    if (this.data.busy || !this.data.loaded || (this.data.completed && this.data.rows.length > 0)) return;
    this.setData({ busy: true });
    try {
      await confirmRetake(this.analysisId, this.saveQueue || undefined, this.meal?.mealSessionId);
    } finally {
      this.setData({ busy: false });
    }
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
      // 评估完直接看这顿饭和这一天的质构系数与营养；旧记录没有编号时回首页。
      const meal = this.meal;
      if (this.fromMeal) {
        // 回到「这一餐」，接着评估下一道；那一页 onShow 会刷新状态。
        wx.navigateBack({ delta: 1 });
      } else if (meal && meal.participantCode) {
        const query = `participantCode=${encodeURIComponent(meal.participantCode)}&date=${chinaDateKey(meal.createdAt)}&analysisId=${encodeURIComponent(this.analysisId)}`;
        wx.reLaunch({ url: `/pages/daily/daily?${query}` });
      } else {
        wx.reLaunch({ url: '/pages/index/index' });
      }
    } catch (err) {
      console.error('[evaluation] complete failed', err);
      this.setData({ saveText: '评估未提交成功，请联网后重试' });
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally { this.setData({ busy: false }); }
  },
});
