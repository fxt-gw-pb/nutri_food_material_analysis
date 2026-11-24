import { getMealAnalysisStatus } from '../../services/mealService';
import { AnalysisStatus } from '../../types/index';

// 各状态对应的展示文案。
const STATUS_TEXT: Record<AnalysisStatus, string> = {
  pending: '正在准备识别',
  preprocessing: '正在预处理图片',
  recognizing: '正在识别菜品与食材',
  completed: '正在匹配质构数据',
  discarded: '已取消本次识别',
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
// 两次轮询之间的间隔。注意是「上一次拿到结果之后再等这么久」，而不是定时器硬发：
// 云数据库查询在真机 / 模拟器上可能超过间隔时间，用 setInterval 会让请求越堆越多，
// 直接把 JS 线程和网络桥堵死（模拟器会报「长时间没有响应」）。
const POLL_INTERVAL_MS = 1000;

Page({
  data: {
    statusText: STATUS_TEXT.pending,
    progress: 0,
    steps: STEPS.map((s) => ({ ...s, done: false, active: false })),
  },

  analysisId: '',
  timer: null as number | null,
  pollStartedAt: 0,
  /** 页面已卸载：卸载后到达的响应不再安排下一次轮询 */
  disposed: false,

  onLoad(query: Record<string, string | undefined>) {
    this.analysisId = query.analysisId || '';
    if (!this.analysisId) {
      wx.showToast({ title: '缺少识别任务', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.pollStartedAt = Date.now();
    this.disposed = false;
    this.poll();
  },

  onUnload() {
    this.disposed = true;
    this.clearTimer();
  },

  clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },

  /** 安排下一次轮询（串行：只有上一次有结果了才排下一次） */
  scheduleNext() {
    if (this.disposed) return;
    this.clearTimer();
    this.timer = setTimeout(() => this.poll(), POLL_INTERVAL_MS);
  },

  poll() {
    if (this.disposed) return;
    if (Date.now() - this.pollStartedAt > MAX_POLL_MS) {
      this.disposed = true;
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
      .then(({ status, progress, errorStage, errorMessage }) => {
        this.setData({
          statusText: STATUS_TEXT[status],
          progress: Math.round(progress * 100),
          steps: this.computeSteps(status),
        });
        if (status === 'completed') {
          this.disposed = true;
          this.clearTimer();
          wx.redirectTo({ url: `/pages/result/result?analysisId=${this.analysisId}` });
        } else if (status === 'discarded') {
          this.disposed = true;
          this.clearTimer();
          wx.reLaunch({ url: '/pages/upload/upload' });
        } else if (status === 'failed') {
          this.disposed = true;
          this.clearTimer();
          // 把云函数记下的失败阶段与原因直接显示出来。笼统的「请重新拍摄」会
          // 让用户白白重试——Key 没配、图片取不到这类问题，重拍多少次都一样。
          const detail = errorMessage
            ? `${errorStage ? `【${errorStage}】` : ''}${errorMessage}`
            : '';
          wx.showModal({
            title: '识别失败',
            content: detail || '请返回重新拍摄或选择图片。',
            showCancel: false,
            success: () => wx.navigateBack(),
          });
          console.error('[analyzing] 识别失败', errorStage, errorMessage);
        } else {
          this.scheduleNext();
        }
      })
      .catch((err) => {
        console.error('[analyzing] poll failed', err);
        this.disposed = true;
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
