// 小程序入口。
// 当前阶段不初始化任何云资源；接入 CloudBase 后在 onLaunch 中调用 wx.cloud.init。
App<IAppOption>({
  globalData: {
    cloudEnv: undefined,
  },
  onLaunch() {
    // 预留：接入 CloudBase 时取消注释，并从本地 config.ts 读取环境 ID。
    // import { CONFIG } from './services/config';
    // if (wx.cloud) {
    //   wx.cloud.init({ env: CONFIG.cloudEnv, traceUser: true });
    //   this.globalData.cloudEnv = CONFIG.cloudEnv;
    // }
  },
});
