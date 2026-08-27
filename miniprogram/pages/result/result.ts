import {
  getMealAnalysisResult,
  saveTextureSelections,
  saveMealType,
} from '../../services/mealService';
import { Dish, MealType, TextureSelection } from '../../types/index';
import { confidenceLabel } from '../../utils/confidence';
import { formatDateTime, MEAL_TYPE_OPTIONS, suggestMealType } from '../../utils/format';
import { resolveMeal, matchTypeLabel, ResolvedDish } from '../../utils/texture';
import { candidateCookingText, searchCandidates, MatchCandidate } from '../../services/textureMatch';
import {
  findRecordById,
  hardnessLabel,
  hardnessPercent,
  chewinessLabel,
  adhesivenessLabel,
} from '../../data/textureDb';

/** 备选行（结果页下方「相似的备选」列表的一行） */
interface CandidateView {
  recordId: string;
  title: string;
  cookingText: string;
  categoryText: string;
  reason: string;
  scorePercent: number;
  selected: boolean;
}

/** 一个食材项的展示模型 */
interface ItemView {
  queryName: string;
  matched: boolean;
  /** 选中记录的展示标题，如「大煮干丝 · 豆腐丝」 */
  title: string;
  cookingText: string;
  source: string;
  hardnessText: string;
  hardnessPercent: number;
  chewinessText: string;
  adhesivenessText: string;
  edited: boolean;
  /** 备选列表是否展开 */
  expanded: boolean;
  /** 手动搜索关键词 */
  keyword: string;
  candidates: CandidateView[];
}

interface DishView {
  dishId: string;
  dishName: string;
  cookingMethod: string;
  matchTypeText: string;
  matchNote: string;
  confidenceText: string;
  items: ItemView[];
}

Page({
  data: {
    imageUrl: '',
    dateText: '',
    mealType: '' as MealType | '',
    mealTypeOptions: MEAL_TYPE_OPTIONS,
    dishViews: [] as DishView[],
  },

  analysisId: '',
  dishes: [] as Dish[],
  resolved: [] as ResolvedDish[],

  onLoad(query: Record<string, string | undefined>) {
    this.analysisId = query.analysisId || '';
    if (!this.analysisId) {
      wx.showToast({ title: '缺少识别记录', icon: 'none' });
      return;
    }
    getMealAnalysisResult(this.analysisId)
      .then((meal) => {
        this.dishes = meal.dishes;
        this.resolved = resolveMeal(meal.dishes, meal.selections);
        const mealType = meal.mealType || suggestMealType();
        this.setData({
          imageUrl: meal.imageUrl,
          dateText: formatDateTime(meal.createdAt),
          mealType,
          dishViews: this.buildDishViews(),
        });
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

  // --------------------------------------------------------------------------
  // 视图构建
  // --------------------------------------------------------------------------

  buildDishViews(): DishView[] {
    // 保留已展开 / 已输入的交互状态，避免改选后备选列表被收起。
    const prev = this.data.dishViews;
    return this.resolved.map((rd, di) => {
      const dish = this.dishes[di];
      return {
        dishId: rd.dishId,
        dishName: rd.dishName,
        cookingMethod: rd.cookingMethod,
        matchTypeText: matchTypeLabel(rd.matchType),
        matchNote:
          rd.matchType === 'dish'
            ? `与库中「${rd.matchedDishName}」同名，直接取该菜数据`
            : rd.matchType === 'ingredient'
              ? '库中没有同名菜，按原食材与烹饪方式找了最接近的'
              : '库中没有足够接近的数据，可在下方自己选一个',
        confidenceText: confidenceLabel(dish ? dish.recognitionConfidence : 'medium'),
        items: rd.items.map((item, ii) => {
          const prevItem = prev[di] && prev[di].items[ii];
          const rec = item.record;
          const keyword = prevItem ? prevItem.keyword : '';
          return {
            queryName: item.queryName,
            matched: !!rec,
            title: rec ? (rec.dish === rec.ingredient ? rec.dish : `${rec.dish} · ${rec.ingredient}`) : '未匹配',
            cookingText: rec ? candidateCookingText(rec.method, rec.minutes) : '',
            source: rec ? rec.source : '',
            hardnessText: rec ? hardnessLabel(rec.metrics.hardness) : '—',
            hardnessPercent: rec ? hardnessPercent(rec.metrics.hardness) : 0,
            chewinessText: rec ? chewinessLabel(rec.metrics.chewiness) : '—',
            adhesivenessText: rec ? adhesivenessLabel(rec.metrics.adhesiveness) : '—',
            edited: item.edited,
            expanded: prevItem ? prevItem.expanded : !rec,
            keyword,
            candidates: this.buildCandidates(
              keyword ? searchCandidates(keyword) : item.candidates,
              rec ? rec.id : '',
            ),
          };
        }),
      };
    });
  },

  buildCandidates(candidates: MatchCandidate[], selectedId: string): CandidateView[] {
    return candidates.map((c) => ({
      recordId: c.recordId,
      title: c.title,
      cookingText: candidateCookingText(c.method, c.minutes),
      categoryText: c.category,
      reason: c.reason,
      scorePercent: c.scorePercent,
      selected: c.recordId === selectedId,
    }));
  },

  // --------------------------------------------------------------------------
  // 交互
  // --------------------------------------------------------------------------

  toggleCandidates(e: WechatMiniprogram.TouchEvent) {
    const { dish, item } = e.currentTarget.dataset as { dish: number; item: number };
    const key = `dishViews[${dish}].items[${item}].expanded`;
    this.setData({ [key]: !this.data.dishViews[dish].items[item].expanded });
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    const { dish, item } = e.currentTarget.dataset as { dish: number; item: number };
    const keyword = e.detail.value;
    const current = this.data.dishViews[dish].items[item];
    const list = keyword.trim()
      ? searchCandidates(keyword)
      : this.resolved[dish].items[item].candidates;
    const selectedId = (current.candidates.find((c) => c.selected) || { recordId: '' }).recordId;
    this.setData({
      [`dishViews[${dish}].items[${item}].keyword`]: keyword,
      [`dishViews[${dish}].items[${item}].candidates`]: this.buildCandidates(list, selectedId),
    });
  },

  /** 用户从备选里选了另一条数据 */
  selectCandidate(e: WechatMiniprogram.TouchEvent) {
    const { dish, item, id } = e.currentTarget.dataset as {
      dish: number;
      item: number;
      id: string;
    };
    const resolvedItem = this.resolved[dish].items[item];
    // 备选可能来自搜索结果（不在原候选列表里），所以直接按 id 取库中记录。
    const record = findRecordById(id);
    if (!record) return;
    resolvedItem.record = record;
    resolvedItem.edited = id !== resolvedItem.autoRecordId;
    this.setData({ dishViews: this.buildDishViews() });
    this.persist();
    wx.showToast({ title: '已换成所选数据', icon: 'none' });
  },

  selectMealType(e: WechatMiniprogram.TouchEvent) {
    const mealType = e.currentTarget.dataset.type as MealType;
    this.setData({ mealType });
    saveMealType(this.analysisId, mealType).catch((err) =>
      console.error('[result] save mealType failed', err),
    );
  },

  /** 把当前选择落库（只存 recordId，匹配逻辑每次打开重算） */
  persist() {
    const selections: TextureSelection[] = this.resolved.map((rd) => ({
      dishId: rd.dishId,
      picks: rd.items
        .filter((it) => it.record)
        .map((it) => ({ queryName: it.queryName, recordId: it.record!.id })),
    }));
    saveTextureSelections(this.analysisId, selections).catch((err) =>
      console.error('[result] save selections failed', err),
    );
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
});
