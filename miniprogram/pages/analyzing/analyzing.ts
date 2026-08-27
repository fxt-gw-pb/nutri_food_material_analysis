import { getMealAnalysisStatus } from '../../services/mealService';
import { AnalysisStatus } from '../../types/index';

// 各状态对应的展示文案。
const STATUS_TEXT: Record<AnalysisStatus, string> = {
  pending: '正在准备识别',
  preprocessing: '正在预处理图片',
  recognizing: '正在识别菜品与食材',
  completed: '正在匹配质构数据',
  failed: '识别失败',
};

// 进度步骤（用于步骤指示）。最后一步「匹配质构数据」在本机完成，速度很快。
const STEPS: { status: AnalysisStatus; label: string }[] = [
  { status: 'preprocessing', label: '预处理图片' },
  { status: 'recognizing', label: '识别菜品与食材' },
  { status: 'completed', label: '匹配质构数据' },
];

const STEP_ORDER: AnalysisStatus[] = ['pending', 'preprocessing', 'recognizing', 'completed'];

// 轮询最长等待时间：超过则视为识别超时（防止后台任务异常时一直转圈）。
const MAX_POLL_MS = 90000;

Page({
  data: {
    statusText: STATUS_TEXT.pending,
    progress: 0,
    steps: STEPS.map((s) => ({ ...s, done: false, active: false })),
  },

  analysisId: '',
  timer: null as number | null,
  pollStartedAt: 0,

  onLoad(query: Record<string, string | undefined>) {
    this.analysisId = query.analysisId || '';
    if (!this.analysisId) {
      wx.showToast({ title: '缺少识别任务', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.pollStartedAt = Date.now();
    this.poll();
    this.timer = setInterval(() => this.poll(), 400);
  },

  onUnload() {
    this.clearTimer();
  },

  clearTimer() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  poll() {
    if (Date.now() - this.pollStartedAt > MAX_POLL_MS) {
      this.clearTimer();
      wx.showModal({
        title: '识别超时',
        content: '请返回重新拍摄或选择图片。',
        showCancel: false,
        success: () => wx.navigateBack(),
      });
      return;
    }
    getMealAnalysisStatus(this.analysisId)
      .then(({ status, progress }) => {
        this.setData({
          statusText: STATUS_TEXT[status],
          progress: Math.round(progress * 100),
          steps: this.computeSteps(status),
        });
        if (status === 'completed') {
          this.clearTimer();
          wx.redirectTo({ url: `/pages/result/result?analysisId=${this.analysisId}` });
        } else if (status === 'failed') {
          this.clearTimer();
          wx.showModal({
            title: '识别失败',
            content: '请返回重新拍摄或选择图片。',
            showCancel: false,
            success: () => wx.navigateBack(),
          });
        }
      })
      .catch((err) => {
        console.error('[analyzing] poll failed', err);
        this.clearTimer();
        wx.showToast({ title: '识别任务不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1200);
      });
  },

  computeSteps(current: AnalysisStatus) {
    const currentIdx = STEP_ORDER.indexOf(current);
    return STEPS.map((s) => {
      const idx = STEP_ORDER.indexOf(s.status);
      return {
        ...s,
        done: currentIdx > idx,
        active: currentIdx === idx,
      };
    });
  },
});
