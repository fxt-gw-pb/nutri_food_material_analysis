import { getMealsInRange } from '../../services/mealService';
import { getUserProfile, normalizeParticipantCode } from '../../services/userProfile';
import { SummaryView, toSummaryView } from '../../utils/intakeView';
import {
  buildDailyIntake,
  chinaDateKey,
  chinaDayRange,
  shiftDateKey,
  weekdayOf,
} from '../../utils/intake';

interface DishView {
  analysisId: string;
  dishName: string;
  imageUrl: string;
  timeText: string;
  evaluated: boolean;
  consumedG: number;
  hardnessText: string;
  energyText: string;
  highlight: boolean;
}

interface MealView {
  label: string;
  dishCount: number;
  evaluatedCount: number;
  summary: SummaryView;
  dishes: DishView[];
}

function timeText(ts: number): string {
  const d = new Date(ts + 8 * 3600 * 1000);
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

Page({
  data: {
    participantCode: '',
    codeInput: '',
    dateKey: '',
    todayKey: '',
    dateText: '',
    isToday: true,
    loading: false,
    loaded: false,
    loadError: '',
    hasRecords: false,
    evaluatedCount: 0,
    pendingCount: 0,
    day: null as SummaryView | null,
    meals: [] as MealView[],
    pendingDishes: [] as DishView[],
    textureOpen: false,
    nutrientOpen: false,
  },
  highlight: '',
  requestId: 0,

  onLoad(query: Record<string, string | undefined>) {
    const today = chinaDateKey(Date.now());
    const dateKey = query.date && chinaDayRange(query.date) && query.date <= today ? query.date : today;
    let code = '';
    try { code = query.participantCode ? normalizeParticipantCode(decodeURIComponent(query.participantCode)) : ''; } catch (err) { code = ''; }
    if (!code) code = getUserProfile()?.participantCode || '';
    this.highlight = query.analysisId || '';
    this.setData({ participantCode: code, codeInput: code });
    this.setDate(dateKey);
  },

  onShow() {
    // 从评估页返回时比例可能变了，每次显示都重算。
    if (this.data.dateKey) void this.load();
  },

  setDate(dateKey: string) {
    const today = chinaDateKey(Date.now());
    this.setData({
      dateKey,
      todayKey: today,
      dateText: `${dateKey} ${weekdayOf(dateKey)}`,
      isToday: dateKey >= today,
      textureOpen: false,
      nutrientOpen: false,
    });
  },

  async load() {
    const code = this.data.participantCode;
    const range = chinaDayRange(this.data.dateKey);
    if (!code || !range) {
      this.setData({ loaded: true, loading: false, hasRecords: false, day: null, meals: [], pendingDishes: [] });
      return;
    }
    const requestId = ++this.requestId;
    this.setData({ loading: true, loadError: '' });
    try {
      const meals = await getMealsInRange(code, range.start, range.end);
      if (requestId !== this.requestId) return;
      const daily = buildDailyIntake(this.data.dateKey, meals);
      const dishView = (d: (typeof daily.meals)[number]['dishes'][number]): DishView => ({
        analysisId: d.analysisId,
        dishName: d.dishName,
        imageUrl: d.imageUrl,
        timeText: timeText(d.createdAt),
        evaluated: d.evaluated,
        consumedG: d.summary ? d.summary.consumedG : 0,
        hardnessText: d.summary && d.summary.hardness.value !== null ? `${d.summary.hardness.valueText} gf` : '',
        energyText: d.summary && d.summary.nutritionG > 0 ? `${d.summary.nutrients[0].valueText} kcal` : '',
        highlight: d.analysisId === this.highlight,
      });
      const mealsView: MealView[] = daily.meals.map((m) => ({
        label: m.label,
        dishCount: m.dishes.length,
        evaluatedCount: m.evaluatedCount,
        summary: toSummaryView(m.summary),
        dishes: m.dishes.map(dishView),
      }));
      const pendingDishes: DishView[] = [];
      mealsView.forEach((m) => m.dishes.forEach((d) => { if (!d.evaluated) pendingDishes.push(d); }));
      this.setData({
        loaded: true,
        hasRecords: meals.length > 0,
        evaluatedCount: daily.evaluatedCount,
        pendingCount: daily.pendingCount,
        day: daily.evaluatedCount ? toSummaryView(daily.day) : null,
        meals: mealsView,
        pendingDishes,
      });
    } catch (err) {
      console.error('[daily] load failed', err);
      if (requestId === this.requestId) this.setData({ loaded: true, loadError: '请检查网络后重试。' });
    } finally {
      if (requestId === this.requestId) this.setData({ loading: false });
    }
  },

  prevDay() {
    if (this.data.loading) return;
    this.setDate(shiftDateKey(this.data.dateKey, -1));
    void this.load();
  },

  nextDay() {
    if (this.data.loading || this.data.isToday) return;
    this.setDate(shiftDateKey(this.data.dateKey, 1));
    void this.load();
  },

  onDatePick(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const value = e.detail.value;
    if (!chinaDayRange(value) || value > chinaDateKey(Date.now())) return;
    this.setDate(value);
    void this.load();
  },

  onCodeInput(e: WechatMiniprogram.Input) {
    this.setData({ codeInput: e.detail.value });
  },

  applyCode() {
    try {
      const code = normalizeParticipantCode(this.data.codeInput);
      this.setData({ participantCode: code, codeInput: code });
      void this.load();
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '请填写参与者编号', icon: 'none' });
    }
  },

  toggleTexture() { this.setData({ textureOpen: !this.data.textureOpen }); },
  toggleNutrient() { this.setData({ nutrientOpen: !this.data.nutrientOpen }); },

  openDish(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const evaluated = e.currentTarget.dataset.evaluated as boolean;
    if (!id) return;
    const page = evaluated ? 'detail' : 'evaluation';
    wx.navigateTo({ url: `/pages/${page}/${page}?analysisId=${encodeURIComponent(id)}` });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  async onPullDownRefresh() {
    try { await this.load(); } finally { wx.stopPullDownRefresh(); }
  },
});
