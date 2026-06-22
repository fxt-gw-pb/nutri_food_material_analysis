import { getMealAnalysisStatus } from '../../services/mealService';
import { AnalysisStatus } from '../../types/index';

// 各状态对应的展示文案。
const STATUS_TEXT: Record<AnalysisStatus, string> = {
  pending: '正在准备分析',
  preprocessing: '正在预处理图片',
  stage_1_recognition: '正在识别菜品',
  geometry_analysis: '正在分析餐盘面积',
  stage_2_weight_estimation: '正在估算食材重量',
  completed: '正在生成饮食记录',
  failed: '分析失败',
};

// 进度步骤（用于左侧步骤指示）。
const STEPS: { status: AnalysisStatus; label: string }[] = [
  { status: 'stage_1_recognition', label: '识别菜品' },
  { status: 'geometry_analysis', label: '分析餐盘面积' },
  { status: 'stage_2_weight_estimation', label: '估算食材重量' },
  { status: 'completed', label: '生成饮食记录' },
];

const STEP_ORDER: AnalysisStatus[] = [
  'pending',
  'preprocessing',
  'stage_1_recognition',
  'geometry_analysis',
  'stage_2_weight_estimation',
  'completed',
];

Page({
  data: {
    statusText: STATUS_TEXT.pending,
    progress: 0,
    steps: STEPS.map((s) => ({ ...s, done: false, active: false })),
  },

  analysisId: '',
  timer: null as number | null,

  onLoad(query: Record<string, string | undefined>) {
    this.analysisId = query.analysisId || '';
    if (!this.analysisId) {
      wx.showToast({ title: '缺少分析任务', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
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
            title: '分析失败',
            content: '请返回重新拍摄或选择图片。',
            showCancel: false,
            success: () => wx.navigateBack(),
          });
        }
      })
      .catch((err) => {
        console.error('[analyzing] poll failed', err);
        this.clearTimer();
        wx.showToast({ title: '分析任务不存在', icon: 'none' });
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
