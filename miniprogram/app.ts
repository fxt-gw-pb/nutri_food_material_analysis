import { CONFIG } from './services/config';
import { checkPendingEvaluation } from './utils/evaluationNavigation';

// 小程序入口。
// 已初始化 CloudBase 云能力（环境 ID 见 services/config.ts）。
// 当前数据流仍走 mock service 层；待云函数 analyzeMeal 与云数据库就绪后，
// 只需替换 services/mealService.ts 内部实现即可（签名不变）。
App<IAppOption>({
  globalData: {
    cloudEnv: CONFIG.cloudEnv,
  },
  onShow() {
    // 冷启动由首页检查；从后台回到结果/历史等页面时主动提醒。
    const pages = getCurrentPages();
    const current = pages[pages.length - 1];
    if (current && ['pages/index/index', 'pages/upload/upload', 'pages/analyzing/analyzing', 'pages/evaluation/evaluation'].indexOf(current.route) < 0) {
      void checkPendingEvaluation();
    }
  },
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: CONFIG.cloudEnv, traceUser: true });
    } else {
      console.warn('当前基础库不支持云能力，请在微信开发者工具中使用较新基础库版本');
    }
  },
});
