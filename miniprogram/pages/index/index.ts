import { checkPendingEvaluation } from '../../utils/evaluationNavigation';

Page({
  onShow() { void checkPendingEvaluation(); },
  async goUpload() {
    if (!await checkPendingEvaluation()) return;
    wx.navigateTo({ url: '/pages/upload/upload' });
  },
  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },
});
