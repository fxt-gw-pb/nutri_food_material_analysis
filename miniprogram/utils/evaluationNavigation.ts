import { getPendingMealEvaluation } from '../services/mealService';

let checking = false;
/** 返回 true 才能开始下一餐；取消提示不会跳过评估。 */
export async function checkPendingEvaluation(): Promise<boolean> {
  if (checking) return false;
  checking = true;
  try {
    const meal = await getPendingMealEvaluation();
    if (!meal) return true;
    const result = await wx.showModal({
      title: '上一餐还没有评估',
      content: '饭后请填写每种食材吃了多少。完成上一餐的饭后评估后，才能识别下一餐。',
      confirmText: '去评估', cancelText: '饭后再评', confirmColor: '#2fae76',
    });
    if (result.confirm) wx.navigateTo({ url: `/pages/evaluation/evaluation?analysisId=${encodeURIComponent(meal.analysisId)}` });
    return false;
  } catch (err) {
    console.error('[evaluation] pending check failed', err);
    wx.showToast({ title: '未能检查上一餐，请联网重试', icon: 'none' });
    return false;
  } finally { checking = false; }
}
