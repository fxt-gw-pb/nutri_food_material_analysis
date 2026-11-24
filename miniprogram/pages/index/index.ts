import { getUserProfile, saveUserProfile, UserProfile } from '../../services/userProfile';
import { getActiveMealSession, startMealSession } from '../../utils/mealSession';

Page({
  data: {
    participantCode: '',
    guideOpen: false,
  },

  toggleGuide() {
    this.setData({ guideOpen: !this.data.guideOpen });
  },

  onShow() {
    const profile = getUserProfile();
    this.setData({ participantCode: profile?.participantCode || '' });
  },

  onParticipantCodeInput(e: WechatMiniprogram.Input) {
    this.setData({ participantCode: e.detail.value });
  },

  saveProfile(): UserProfile | null {
    try {
      const profile = saveUserProfile({ participantCode: this.data.participantCode });
      this.setData({ participantCode: profile.participantCode });
      return profile;
    } catch (err) {
      console.error('[index] save participant code failed', err);
      const message = err instanceof Error ? err.message : '请填写参与者编码';
      wx.showToast({ title: message, icon: 'none' });
      return null;
    }
  },

  async goUpload() {
    if (!this.saveProfile()) return;
    // 如果用户中途离开，回到首页时继续原饭局，避免遗留一顿无法结束的记录。
    const mealSessionId = getActiveMealSession() || startMealSession();
    wx.navigateTo({ url: `/pages/upload/upload?mealSessionId=${encodeURIComponent(mealSessionId)}` });
  },

  async saveAndContinue() {
    await this.goUpload();
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goQuestionnaire() {
    if (!this.saveProfile()) return;
    wx.navigateTo({ url: '/pages/questionnaire/questionnaire' });
  },

  goQuestionnaireHistory() {
    if (!this.saveProfile()) return;
    wx.navigateTo({ url: '/pages/questionnaire-history/questionnaire-history' });
  },
});
