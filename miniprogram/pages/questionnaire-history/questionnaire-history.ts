import { getQuestionnaireHistory } from '../../services/questionnaireService';
import { getUserProfile, normalizeParticipantCode } from '../../services/userProfile';
import { QuestionnaireRecord } from '../../types/questionnaire';
import { formatQuestionnaireTime } from '../../utils/questionnaire';
import { CONFIG } from '../../services/config';

interface HistoryView extends QuestionnaireRecord { dateText: string }

Page({
  data: {
    participantCode: '', items: [] as HistoryView[], loading: false, loaded: false,
    error: '', hasMore: false, mockMode: !CONFIG.useCloud,
  },
  offset: 0,

  onLoad(query: Record<string, string | undefined>) {
    try {
      const code = query.participantCode ? decodeURIComponent(query.participantCode) : getUserProfile()?.participantCode || '';
      this.setData({ participantCode: normalizeParticipantCode(code) });
    } catch (err) {
      this.setData({ loaded: true, error: '请先返回首页填写参与者编号' });
    }
  },

  onShow() { if (this.data.participantCode) void this.loadHistory(true); },

  async loadHistory(reset: boolean) {
    if (this.data.loading || !this.data.participantCode) return;
    this.setData({ loading: true, error: '' });
    try {
      const result = await getQuestionnaireHistory(this.data.participantCode, reset ? 0 : this.offset);
      const views = result.items.map((item) => ({ ...item, dateText: formatQuestionnaireTime(item.createdAt) }));
      const items = reset ? views : [...this.data.items, ...views.filter((item) => !this.data.items.some((old) => old.responseId === item.responseId))];
      this.offset = result.nextOffset;
      this.setData({ items, hasMore: result.hasMore });
    } catch (err) {
      console.error('[questionnaire-history] load failed', err);
      this.setData({ error: '问卷记录加载失败，请联网后重试' });
    } finally {
      this.setData({ loading: false, loaded: true });
    }
  },

  retry() { void this.loadHistory(this.data.items.length === 0); },
  loadMore() { if (this.data.hasMore) void this.loadHistory(false); },
  onReachBottom() { this.loadMore(); },
  async onPullDownRefresh() {
    try { await this.loadHistory(true); } finally { wx.stopPullDownRefresh(); }
  },
  goDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (this.data.items.some((item) => item.responseId === id)) {
      wx.navigateTo({ url: `/pages/questionnaire/questionnaire?responseId=${encodeURIComponent(id)}` });
    }
  },
  goQuestionnaire() {
    if (this.data.participantCode) wx.redirectTo({ url: `/pages/questionnaire/questionnaire?participantCode=${encodeURIComponent(this.data.participantCode)}` });
  },
  goHome() { wx.reLaunch({ url: '/pages/index/index' }); },
});
