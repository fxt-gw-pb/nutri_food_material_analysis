// 网页版运行时配置：替换 miniprogram/services/config.ts（见 web/plugins/miniprogram.mjs 的 OVERRIDES）。
// 网页版始终走自建后端；cloudEnv 只用来给本机草稿的存储键分区，与小程序的草稿互不干扰。
export const CONFIG = {
  cloudEnv: 'web',
  useCloud: true,
  analyzeFunctionName: 'analyzeMeal',
  questionnaireFunctionName: 'questionnaire',
  uploadDir: 'meal-images/',
};

export type AppConfig = typeof CONFIG;
