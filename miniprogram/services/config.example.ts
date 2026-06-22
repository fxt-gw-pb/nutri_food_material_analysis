// 配置示例文件。
// 使用方法：复制本文件为同目录下的 config.ts，并填入你自己的值。
// config.ts 已在 .gitignore 中忽略，不会被提交。
//
// 安全提示：
//   - 这里只放“前端可见也无所谓”的配置（如云函数名、上传目录、CloudBase 环境 ID）。
//   - 千问 API Key 绝对不能出现在小程序前端，只能放在云函数 / 后端环境变量中。
//     详见 docs/ai-pipeline.md。

export const CONFIG = {
  /** CloudBase 环境 ID（在微信开发者工具 / 腾讯云控制台获取） */
  cloudEnv: 'YOUR_CLOUDBASE_ENV_ID',
  /** 负责分析的云函数名 */
  analyzeFunctionName: 'analyzeMeal',
  /** 云存储中餐盘照片的目录前缀 */
  uploadDir: 'meal-images/',
};

export type AppConfig = typeof CONFIG;
