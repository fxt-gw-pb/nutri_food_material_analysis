/// <reference types="miniprogram-api-typings" />

// getApp() 的全局类型，供各页面引用。
// 运行时的敏感配置（如 CloudBase 环境 ID）由本地 config.ts 注入，不写入仓库。
interface IGlobalData {
  /** CloudBase 环境 ID（预留，运行时注入） */
  cloudEnv?: string;
}

interface IAppOption {
  globalData: IGlobalData;
}
