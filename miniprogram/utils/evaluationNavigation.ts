import { getPendingMealEvaluation } from '../services/mealService';
import { confirmRetake } from './retakeNavigation';

let checking = false;
/** 兼容旧版无饭局标识的记录；新版 mealSessionId 记录不会进入此门槛。 */
export async function checkPendingEvaluation(): Promise<boolean> {
  if (checking) return false;
  checking = true;
  try {
    const meal = await getPendingMealEvaluation();
    if (!meal) return true;
    const result = await wx.showModal({
      title: '上一餐还没有评估',
      content: '保留这餐请先完成饭后评估，再识别下一餐。若当前识别不合适，可重新拍照，无需先评估。',
      confirmText: '去评估', cancelText: '重新拍照', confirmColor: '#2fae76',
    });
    if (result?.confirm === true) {
      wx.navigateTo({ url: `/pages/evaluation/evaluation?analysisId=${encodeURIComponent(meal.analysisId)}` });
    } else if (result?.cancel === true) {
      await confirmRetake(meal.analysisId);
    }
    return false;
  } catch (err) {
    console.error('[evaluation] pending check failed', err);
    wx.showToast({ title: '未能检查上一餐，请联网重试', icon: 'none' });
    return false;
  } finally { checking = false; }
}
