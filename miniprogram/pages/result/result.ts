import {
  getMealAnalysisResult,
  saveRecordSelections,
  saveMealType,
  saveExcludedIngredients,
  saveAuditSnapshot,
  saveConsumptionEvaluation,
} from '../../services/mealService';
import { Dish, MealType } from '../../types/index';
import { confidenceLabel } from '../../utils/confidence';
import { formatDateTime, MEAL_TYPE_OPTIONS, suggestMealType } from '../../utils/format';
import { resolveMeal, IngredientRow, RecordSelections } from '../../utils/texture';
import { RecordCandidate, searchRecords } from '../../services/textureMatch';

/** 备选记录的展示模型（多一个「是否当前选中」） */
interface CandidateView extends RecordCandidate {
  selected: boolean;
}

/** 页面上的食材行 = 匹配结果 + 两个折叠开关 + 备选列表 */
interface IngredientView extends IngredientRow {
  /** 九项完整指标是否展开 */
  detailOpen: boolean;
  /** 备选记录面板是否展开 */
  pickerOpen: boolean;
  candidateViews: CandidateView[];
}

Page({
  data: {
    imageUrl: '',
    dateText: '',
    mealType: '' as MealType | '',
    mealTypeOptions: MEAL_TYPE_OPTIONS,

    /** 识别出的菜 */
    recognizedName: '',
    cookingMethod: '',
    confidenceText: '',
    /** 库中的同名菜（有则说明整道菜都对得上） */
    matchedDish: '',
    summary: '',
    matchedCount: 0,
    totalCount: 0,
    /** 估重 */
    totalWeightText: '',
    plateDiameterCm: 0,
    /** 「已匹配 3/4 种食材」这样的一行 */
    matchNote: '',

    /** 逐食材结果 */
    ingredients: [] as IngredientView[],

    /** 当前展开备选面板的食材下标，-1 表示都收起 */
    pickerIndex: -1,
    keyword: '',
    busy: false,
    loaded: false,
    evaluationCompleted: false,
  },

  analysisId: '',
  excludedIngredients: [] as string[],
  dish: null as Dish | null,
  /** 拍照时选的餐盘直径，估重的尺度基准 */
  plateDiameterCm: 0,
  /** 用户逐食材的手动改选：识别食材名 → 质构记录 id */
  selections: {} as RecordSelections,
  /** 搜索防抖：连续输入时不必每敲一个字就全库搜一遍 */
  searchTimer: null as number | null,

  onLoad(query: Record<string, string | undefined>) {
    this.analysisId = query.analysisId || '';
    if (!this.analysisId) {
      wx.showToast({ title: '缺少识别记录', icon: 'none' });
      return;
    }
  },

  onShow() {
    if (!this.analysisId) return;
    this.setData({ loaded: false });
    getMealAnalysisResult(this.analysisId)
      .then(async (meal) => {
        this.dish = meal.dish;
        this.excludedIngredients = meal.excludedIngredients || [];
        this.selections = meal.selectedRecords || {};
        this.plateDiameterCm = meal.plateDiameterCm || 0;
        const mealType = meal.mealType || suggestMealType();
        this.setData({
          imageUrl: meal.imageUrl,
          dateText: formatDateTime(meal.createdAt),
          mealType,
          evaluationCompleted: meal.evaluationStatus === 'completed',
        });
        this.refresh();
        await saveAuditSnapshot(this.analysisId);
        if (this.data.totalCount === 0 && meal.evaluationStatus === 'pending') {
          await saveConsumptionEvaluation(this.analysisId, {}, true);
        }
        this.setData({ loaded: true });
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
    const r = resolveMeal(this.dish, this.selections, this.plateDiameterCm, this.excludedIngredients);
    const pickerIndex = this.data.pickerIndex;
    const keyword = this.data.keyword.trim();
    // 展开的那一行如果在搜索，用搜索结果替掉它的备选列表。
    const searched = keyword && pickerIndex >= 0 ? searchRecords(keyword) : null;

    const ingredients: IngredientView[] = r.ingredients.map((row, i) => {
      const prev = this.data.ingredients.find((ing) => ing.name === row.name);
      const list = searched && i === pickerIndex ? searched : row.candidates;
      return {
        ...row,
        // 没匹配上的食材默认把指标区展开也没意义，保持用户此前的展开状态。
        detailOpen: prev ? prev.detailOpen : false,
        pickerOpen: i === pickerIndex,
        candidateViews: list.map((c) => ({ ...c, selected: c.id === row.recordId })),
      };
    });

    this.setData({
      recognizedName: r.recognizedName,
      cookingMethod: r.cookingMethod,
      confidenceText: confidenceLabel(this.dish ? this.dish.recognitionConfidence : 'medium'),
      matchedDish: r.matchedDish,
      summary: r.summary,
      matchedCount: r.matchedCount,
      totalCount: r.totalCount,
      matchNote: this.buildMatchNote(r.matchedDish, r.matchedCount, r.totalCount),
      totalWeightText: r.totalWeightText,
      plateDiameterCm: r.plateDiameterCm,
      ingredients,
    });
  },

  buildMatchNote(matchedDish: string, matched: number, total: number): string {
    if (total === 0) return '没有识别出食材';
    const head = matchedDish
      ? `库中有同名菜「${matchedDish}」，食材数据优先取自这道菜`
      : '库中没有同名菜，已为每种食材单独找最接近的实测数据';
    return `${head}；${total} 种食材中匹配到 ${matched} 种`;
  },

  /** 展开 / 收起某种食材的九项完整指标 */
  toggleDetail(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.index);
    const key = `ingredients[${i}].detailOpen`;
    this.setData({ [key]: !this.data.ingredients[i].detailOpen });
  },

  /** 展开 / 收起某种食材的备选面板（同时只开一个，省得页面太长） */
  togglePicker(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.index);
    const next = this.data.pickerIndex === i ? -1 : i;
    this.setData({ pickerIndex: next, keyword: '' }, () => this.refresh());
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.refresh();
    }, 250);
  },

  onUnload() {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  },

  /** 用户为某种食材换了一条实测数据 */
  selectRecord(e: WechatMiniprogram.TouchEvent) {
    const { index, id } = e.currentTarget.dataset as { index: number; id: string };
    const row = this.data.ingredients[Number(index)];
    if (!row || !id) return;
    this.selections = { ...this.selections, [row.name]: id };
    this.persistSelections();
    this.refresh();
    wx.showToast({ title: `已为「${row.name}」换数据`, icon: 'none' });
  },

  /** 撤销某种食材的手动改选，回到自动匹配 */
  resetOne(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.index);
    const row = this.data.ingredients[i];
    if (!row) return;
    const next = { ...this.selections };
    delete next[row.name];
    this.selections = next;
    this.persistSelections();
    this.refresh();
  },

  persistSelections() {
    saveRecordSelections(this.analysisId, this.selections).then(() => saveAuditSnapshot(this.analysisId)).catch((err) =>
      console.error('[result] save selections failed', err),
    );
  },

  selectMealType(e: WechatMiniprogram.TouchEvent) {
    const mealType = e.currentTarget.dataset.type as MealType;
    this.setData({ mealType });
    saveMealType(this.analysisId, mealType).catch((err) =>
      console.error('[result] save mealType failed', err),
    );
  },

  async removeIngredient(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || !this.data.loaded) return;
    const name = e.currentTarget.dataset.name as string;
    if (!this.data.ingredients.some((i) => i.name === name)) return;
    this.setData({ busy: true });
    try {
      const answer = await wx.showModal({ title: '删除食材', content: `确定删除「${name}」吗？删除后不再计入这餐的重量和饭后评估。`, confirmColor: '#c44b3e' });
      if (!answer.confirm) return;
      const next = [...this.excludedIngredients, name];
      await saveExcludedIngredients(this.analysisId, next);
      this.excludedIngredients = next;
      this.setData({ pickerIndex: -1, keyword: '' });
      this.refresh();
      wx.showToast({ title: '食材已删除', icon: 'success' });
    } catch (err) {
      console.error('[result] delete ingredient failed', err);
      wx.showToast({ title: '删除未保存，请重试', icon: 'none' });
    } finally { this.setData({ busy: false }); }
  },

  goEvaluation() {
    if (!this.data.loaded || this.data.busy) return;
    wx.navigateTo({ url: `/pages/evaluation/evaluation?analysisId=${encodeURIComponent(this.analysisId)}` });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
});
