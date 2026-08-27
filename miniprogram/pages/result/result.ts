import {
  getMealAnalysisResult,
  saveSelectedDish,
  saveMealType,
} from '../../services/mealService';
import { Dish, MealType } from '../../types/index';
import { confidenceLabel } from '../../utils/confidence';
import { formatDateTime, MEAL_TYPE_OPTIONS, suggestMealType } from '../../utils/format';
import { resolveMeal, matchTypeLabel, TextureRow } from '../../utils/texture';
import { DishCandidate, searchDishes } from '../../services/textureMatch';

/** 备选菜的展示模型（多一个「是否当前选中」） */
interface CandidateView extends DishCandidate {
  selected: boolean;
}

Page({
  data: {
    imageUrl: '',
    dateText: '',
    mealType: '' as MealType | '',
    mealTypeOptions: MEAL_TYPE_OPTIONS,

    /** 识别与匹配 */
    recognizedName: '',
    cookingMethod: '',
    confidenceText: '',
    matchTypeText: '',
    matchNote: '',
    matchedDish: '',
    matched: false,
    edited: false,
    summary: '',
    /** 这道菜的源数据：每种原食材一行 */
    rows: [] as TextureRow[],

    /** 备选菜面板 */
    pickerOpen: false,
    keyword: '',
    candidates: [] as CandidateView[],
  },

  analysisId: '',
  dish: null as Dish | null,
  selectedDish: '' as string,

  onLoad(query: Record<string, string | undefined>) {
    this.analysisId = query.analysisId || '';
    if (!this.analysisId) {
      wx.showToast({ title: '缺少识别记录', icon: 'none' });
      return;
    }
    getMealAnalysisResult(this.analysisId)
      .then((meal) => {
        this.dish = meal.dish;
        this.selectedDish = meal.selectedDish || '';
        const mealType = meal.mealType || suggestMealType();
        this.setData({
          imageUrl: meal.imageUrl,
          dateText: formatDateTime(meal.createdAt),
          mealType,
        });
        this.refresh();
        // 新记录：把默认餐次落库，保证历史一致。
        if (!meal.mealType) {
          saveMealType(this.analysisId, mealType).catch((err) =>
            console.error('[result] save mealType failed', err),
          );
        }
      })
      .catch((err) => {
        console.error('[result] load failed', err);
        wx.showToast({ title: '加载结果失败', icon: 'none' });
      });
  },

  /** 重新算一遍匹配并刷新页面（改选后也走这里） */
  refresh() {
    const r = resolveMeal(this.dish, this.selectedDish);
    this.setData({
      recognizedName: r.recognizedName,
      cookingMethod: r.cookingMethod,
      confidenceText: confidenceLabel(this.dish ? this.dish.recognitionConfidence : 'medium'),
      matchTypeText: matchTypeLabel(r.matchType),
      matchNote:
        r.matchType === 'dish'
          ? `与库中「${r.matchedDish}」同名，直接取该菜的实测数据`
          : r.matchType === 'ingredient'
            ? '库中没有同名菜，已按原食材与烹饪方式找了最接近的一道'
            : '库中没有足够接近的菜，请在下方自己选一道',
      matchedDish: r.matchedDish,
      matched: r.rows.length > 0,
      edited: r.edited,
      summary: r.summary,
      rows: r.rows,
      candidates: this.buildCandidates(
        this.data.keyword.trim() ? searchDishes(this.data.keyword) : r.candidates,
        r.matchedDish,
      ),
      // 没匹配上时默认把备选面板展开，省得老人还要找入口
      pickerOpen: this.data.pickerOpen || r.rows.length === 0,
    });
  },

  buildCandidates(list: DishCandidate[], selected: string): CandidateView[] {
    return list.map((c) => ({ ...c, selected: c.dish === selected }));
  },

  togglePicker() {
    this.setData({ pickerOpen: !this.data.pickerOpen });
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    this.refresh();
  },

  /** 用户从备选里换了一道菜 */
  selectDish(e: WechatMiniprogram.TouchEvent) {
    const dish = e.currentTarget.dataset.dish as string;
    if (!dish) return;
    this.selectedDish = dish;
    this.refresh();
    saveSelectedDish(this.analysisId, dish).catch((err) =>
      console.error('[result] save selectedDish failed', err),
    );
    wx.showToast({ title: `已换成「${dish}」`, icon: 'none' });
  },

  /** 撤销手动改选，回到自动匹配结果 */
  resetSelection() {
    this.selectedDish = '';
    this.refresh();
    saveSelectedDish(this.analysisId, '').catch((err) =>
      console.error('[result] reset selectedDish failed', err),
    );
  },

  selectMealType(e: WechatMiniprogram.TouchEvent) {
    const mealType = e.currentTarget.dataset.type as MealType;
    this.setData({ mealType });
    saveMealType(this.analysisId, mealType).catch((err) =>
      console.error('[result] save mealType failed', err),
    );
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
});
