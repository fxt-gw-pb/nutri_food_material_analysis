import { discardMealAnalysis } from '../services/mealService';
import { clearEvaluationDraft } from '../services/evaluationDraft';

/**
 * Ask whether the current recognition should be discarded and start a fresh upload.
 * `waitForQueue` is used by the evaluation page to let pending percentage writes settle.
 * Returns true only when the discard and navigation both complete.
 */
export async function confirmRetake(
  analysisId: string,
  waitForQueue?: Promise<unknown>,
  mealSessionId?: string,
): Promise<boolean> {
  if (!analysisId) return false;
  let answer: WechatMiniprogram.ShowModalSuccessCallbackResult;
  try {
    answer = await wx.showModal({
      title: '重新拍照',
      content: '当前结果不会计入饮食记录，也无需饭后评估。确定要重新拍照吗？',
      confirmText: '重新拍照',
      cancelText: '取消',
      confirmColor: '#2fae76',
    });
  } catch (err) {
    console.error('[retake] confirmation failed', err);
    wx.showToast({ title: '未能打开确认提示，请重试', icon: 'none' });
    return false;
  }
  if (!answer || answer.confirm !== true) return false;
  try {
    if (waitForQueue) await waitForQueue;
    await discardMealAnalysis(analysisId);
    try { clearEvaluationDraft(analysisId); } catch (err) { console.warn('[retake] draft cleanup failed', err); }
  } catch (err) {
    console.error('[retake] discard failed', err);
    wx.showToast({ title: '重新拍照失败，请重试', icon: 'none' });
    return false;
  }
  try {
    const suffix = mealSessionId ? `?mealSessionId=${encodeURIComponent(mealSessionId)}` : '';
    await wx.reLaunch({ url: `/pages/upload/upload${suffix}` });
    return true;
  } catch (err) {
    console.error('[retake] navigation failed after discard', err);
    wx.showToast({ title: '结果已作废，请返回首页重新拍照', icon: 'none' });
    return false;
  }
}
