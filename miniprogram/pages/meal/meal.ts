// 「这一餐」：某位参与者某一天某一餐的全部菜品。从饮食记录点进来，
// 再点每道菜看识别详情；饭后从这里逐道评估，评估完自动回到这一页接着评下一道。
import { deleteMealRecord, finishMealSession, getMealHistory, getMealsInRange } from '../../services/mealService';
import { normalizeParticipantCode } from '../../services/userProfile';
import { MealAnalysis, MealHistoryItem } from '../../types/index';
import { chinaDateKey, chinaDayRange } from '../../utils/intake';
import { clearMealSession } from '../../utils/mealSession';
import { dayText, mealGroupTitle } from '../../utils/mealGroups';
import { resolveMeal } from '../../utils/texture';

interface DishView {
  analysisId: string;
  dishName: string;
  imageUrl: string;
  timeText: string;
  ingredientText: string;
  summaryText: string;
  evaluated: boolean;
  consumedG: number;
  mealSessionId: string;
  sessionFinished: boolean;
  createdAt: number;
}

function timeText(ts: number): string {
  const d = new Date(ts + 8 * 3600 * 1000);
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function fromAnalysis(meal: MealAnalysis): DishView {
  const r = resolveMeal(meal.dish, meal.selectedRecords, meal.plateDiameterCm, meal.excludedIngredients);
  return {
    analysisId: meal.analysisId, dishName: r.recognizedName, imageUrl: meal.imageUrl, timeText: timeText(meal.createdAt),
    ingredientText: r.totalCount ? r.ingredients.map((i) => i.name).join('、') : '未识别出食材',
    summaryText: [r.summary, r.totalG ? `约 ${r.totalG} g` : ''].filter(Boolean).join(' · '),
    evaluated: meal.evaluationStatus === 'completed', consumedG: meal.consumption?.totalConsumedG || 0,
    mealSessionId: meal.mealSessionId || '', sessionFinished: !meal.mealSessionId || Boolean(meal.mealSessionFinishedAt),
    createdAt: meal.createdAt,
  };
}

function fromHistory(item: MealHistoryItem): DishView {
  return {
    analysisId: item.analysisId, dishName: item.dishName, imageUrl: item.imageUrl, timeText: timeText(item.date),
    ingredientText: item.totalCount ? item.ingredientText : '未识别出食材',
    summaryText: [item.textureSummary, item.totalG ? `约 ${item.totalG} g` : ''].filter(Boolean).join(' · '),
    evaluated: item.evaluationStatus === 'completed', consumedG: item.totalConsumedG || 0,
    mealSessionId: item.mealSessionId || '', sessionFinished: !item.mealSessionId || Boolean(item.mealSessionFinishedAt),
    createdAt: item.date,
  };
}

Page({
  data: {
    participantCode: '',
    dateKey: '',
    mealType: '',
    title: '',
    dateText: '',
    dishes: [] as DishView[],
    loaded: false,
    loading: false,
    error: '',
    busy: false,
    pendingCount: 0,
    evaluatedCount: 0,
    /** 还没点「拍完了」的菜数：这些菜要先结束拍摄才能评估 */
    unfinishedCount: 0,
  },

  onLoad(query: Record<string, string | undefined>) {
    let code = '';
    try { code = query.participantCode ? normalizeParticipantCode(decodeURIComponent(query.participantCode)) : ''; } catch (err) { code = ''; }
    const dateKey = query.date || '';
    const mealType = query.mealType && query.mealType !== 'none' ? query.mealType : '';
    if (!chinaDayRange(dateKey)) {
      this.setData({ loaded: true, error: '这一餐的日期无效，请返回饮食记录重新打开。' });
      return;
    }
    this.setData({ participantCode: code, dateKey, mealType, title: mealGroupTitle(mealType), dateText: dayText(dateKey) });
  },

  onShow() {
    // 从评估页回来时状态变了，每次显示都重新读。
    if (this.data.dateKey && !this.data.error) void this.load();
  },

  async load() {
    if (this.data.loading) return;
    const range = chinaDayRange(this.data.dateKey);
    if (!range) return;
    this.setData({ loading: true, error: '' });
    try {
      const { participantCode: code, dateKey, mealType } = this.data;
      let dishes: DishView[];
      if (code) {
        // 按编号和当天时间查，不受饮食记录列表条数限制，这一餐的菜一道不漏。
        const meals = await getMealsInRange(code, range.start, range.end);
        dishes = meals.filter((m) => (m.mealType || '') === mealType).map(fromAnalysis);
      } else {
        // 旧记录没有编号，只能在最近的饮食记录里找。
        const items = await getMealHistory();
        dishes = items.filter((it) => !it.participantCode && chinaDateKey(it.date) === dateKey && (it.mealType || '') === mealType).map(fromHistory);
      }
      dishes.sort((a, b) => a.createdAt - b.createdAt);
      this.setData({
        dishes, loaded: true,
        pendingCount: dishes.filter((d) => !d.evaluated).length,
        evaluatedCount: dishes.filter((d) => d.evaluated).length,
        unfinishedCount: dishes.filter((d) => !d.sessionFinished).length,
      });
    } catch (err) {
      console.error('[meal] load failed', err);
      this.setData({ loaded: true, error: '请检查网络后重试，记录不会丢失。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onPullDownRefresh() {
    try { await this.load(); } finally { wx.stopPullDownRefresh(); }
  },

  goDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/detail?analysisId=${encodeURIComponent(id)}&from=meal` });
  },

  goEvaluate(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const dish = this.data.dishes.find((d) => d.analysisId === id);
    if (!dish || this.data.busy) return;
    if (!dish.sessionFinished) {
      wx.showToast({ title: '请先点「拍完了」结束这顿饭的拍照', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/evaluation/evaluation?analysisId=${encodeURIComponent(id)}&from=meal` });
  },

  /** 按顺序评估下一道还没评的菜 */
  evaluateNext() {
    const next = this.data.dishes.find((d) => !d.evaluated && d.sessionFinished);
    if (next) this.goEvaluate({ currentTarget: { dataset: { id: next.analysisId } } } as unknown as WechatMiniprogram.TouchEvent);
  },

  /** 这一餐还有菜没点「拍完了」：在这里一次结束，之后就能评估 */
  async finishMeal() {
    if (this.data.busy) return;
    const sessions = Array.from(new Set(this.data.dishes.filter((d) => !d.sessionFinished && d.mealSessionId).map((d) => d.mealSessionId)));
    if (!sessions.length) return;
    this.setData({ busy: true });
    try {
      const answer = await wx.showModal({
        title: '这顿饭拍完了吗？',
        content: '确认后就不能再往这顿饭里加菜了，可以开始逐道填写吃了多少。',
        confirmText: '拍完了', confirmColor: '#2fae76',
      });
      if (!answer.confirm) return;
      for (const id of sessions) {
        await finishMealSession(id);
        clearMealSession(id);
      }
      wx.showToast({ title: '可以开始评估了', icon: 'success' });
      await this.load();
    } catch (err) {
      console.error('[meal] finish failed', err);
      wx.showToast({ title: '没有保存成功，请重试', icon: 'none' });
    } finally { this.setData({ busy: false }); }
  },

  goDaily() {
    if (!this.data.participantCode) return;
    wx.navigateTo({ url: `/pages/daily/daily?participantCode=${encodeURIComponent(this.data.participantCode)}&date=${this.data.dateKey}` });
  },

  confirmDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.showModal({
      title: '删除记录', content: '确定删除这道菜的识别记录吗？', confirmColor: '#d04a3b',
      success: (res) => {
        if (!res.confirm) return;
        deleteMealRecord(id).then(() => this.load()).catch(() => wx.showToast({ title: '删除失败，请重试', icon: 'none' }));
      },
    });
  },
});
