import { getMealHistory, deleteMealRecord } from '../../services/mealService';
import { MealHistoryItem } from '../../types/index';
import { formatDate, mealTypeLabel } from '../../utils/format';
import { getActiveMealSession, startMealSession } from '../../utils/mealSession';

interface HistoryItemView extends MealHistoryItem {
  dateText: string;
  mealTypeText: string;
  /** 历史卡片上的状态样式与文案。旧记录没有 evaluationStatus 时按未评估展示。 */
  evaluationClass: 'evaluated' | 'pending';
  evaluationText: string;
  evaluationMeta: string;
}

Page({
  data: {
    items: [] as HistoryItemView[],
    visibleItems: [] as HistoryItemView[],
    loaded: false,
    loading: false,
    error: '',
    keyword: '',
    filter: 'all',
    pendingCount: 0,
    evaluatedCount: 0,
  },

  onShow() {
    // 每次进入都刷新，确保新识别的记录及时出现。
    this.loadHistory();
  },

  loadHistory() {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true, error: '' });
    return getMealHistory()
      .then((items) => {
        const views: HistoryItemView[] = items.map((it) => {
          const evaluated = it.evaluationStatus === 'completed';
          return {
            ...it,
            dateText: formatDate(it.date),
            mealTypeText: mealTypeLabel(it.mealType),
            evaluationClass: evaluated ? 'evaluated' : 'pending',
            evaluationText: evaluated ? '已评估' : '未评估',
            evaluationMeta: evaluated
              ? `已评估 · 估算摄入 ${it.totalConsumedG || 0} g`
              : '未评估 · 饭后可补充评估',
          };
        });
        this.setData({ items: views, loaded: true,
          pendingCount: views.filter((item) => item.evaluationClass === 'pending').length,
          evaluatedCount: views.filter((item) => item.evaluationClass === 'evaluated').length,
        });
        this.applyFilters();
      })
      .catch((err) => {
        console.error('[history] load failed', err);
        this.setData({ loaded: true, error: '请检查网络后重试，已有记录不会丢失。' });
      })
      .finally(() => this.setData({ loading: false }));
  },

  applyFilters() {
    const keyword = this.data.keyword.trim().toLowerCase();
    const visibleItems = this.data.items.filter((item) =>
      (this.data.filter === 'all' || item.evaluationClass === this.data.filter) &&
      (!keyword || [item.participantCode || '', item.dishName, item.ingredientText].join(' ').toLowerCase().includes(keyword)),
    );
    this.setData({ visibleItems });
  },
  onSearchInput(e: WechatMiniprogram.Input) {
    this.setData({ keyword: e.detail.value });
    this.applyFilters();
  },
  setFilter(e: WechatMiniprogram.TouchEvent) {
    const filter = e.currentTarget.dataset.filter as string;
    if (!['all', 'pending', 'evaluated'].includes(filter)) return;
    this.setData({ filter });
    this.applyFilters();
  },
  clearSearch() { this.setData({ keyword: '' }); this.applyFilters(); },
  resetFilters() { this.setData({ keyword: '', filter: 'all' }); this.applyFilters(); },
  async onPullDownRefresh() {
    try { await this.loadHistory(); } finally { wx.stopPullDownRefresh(); }
  },

  goDetail(e: WechatMiniprogram.TouchEvent) {
    const analysisId = e.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/detail/detail?analysisId=${analysisId}` });
  },

  confirmDelete(e: WechatMiniprogram.TouchEvent) {
    const analysisId = e.currentTarget.dataset.id as string;
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条识别记录吗？',
      confirmColor: '#d04a3b',
      success: (res) => {
        if (res.confirm) {
          deleteMealRecord(analysisId).then(() => this.loadHistory()).catch(() =>
            wx.showToast({ title: '删除失败，请重试', icon: 'none' }),
          );
        }
      },
    });
  },

  goUpload() {
    const mealSessionId = getActiveMealSession() || startMealSession();
    wx.navigateTo({ url: `/pages/upload/upload?mealSessionId=${encodeURIComponent(mealSessionId)}` });
  },
});
