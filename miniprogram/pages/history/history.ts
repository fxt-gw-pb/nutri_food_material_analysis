import { getMealHistory, deleteMealRecord } from '../../services/mealService';
import { MealHistoryItem } from '../../types/index';
import { formatDate, ratioLabel } from '../../utils/format';

interface HistoryItemView extends MealHistoryItem {
  dateText: string;
  ratioText: string;
}

Page({
  data: {
    items: [] as HistoryItemView[],
    loaded: false,
  },

  onShow() {
    // 每次进入都刷新，确保新分析后的记录及时出现。
    this.loadHistory();
  },

  loadHistory() {
    getMealHistory()
      .then((items) => {
        const views: HistoryItemView[] = items.map((it) => ({
          ...it,
          dateText: formatDate(it.date),
          ratioText: it.ratio ? ratioLabel(it.ratio) : '未记录',
        }));
        this.setData({ items: views, loaded: true });
      })
      .catch((err) => {
        console.error('[history] load failed', err);
        this.setData({ loaded: true });
      });
  },

  goDetail(e: WechatMiniprogram.TouchEvent) {
    const analysisId = e.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/detail/detail?analysisId=${analysisId}` });
  },

  confirmDelete(e: WechatMiniprogram.TouchEvent) {
    const analysisId = e.currentTarget.dataset.id as string;
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条饮食记录吗？',
      confirmColor: '#d04a3b',
      success: (res) => {
        if (res.confirm) {
          deleteMealRecord(analysisId).then(() => this.loadHistory());
        }
      },
    });
  },

  goUpload() {
    wx.navigateTo({ url: '/pages/upload/upload' });
  },
});
