// 配置示例文件（模板）。实际生效的是同目录下的 config.ts。
// 新环境部署时：复制本文件为 config.ts，并填入自己的值。
//
// 安全提示：
//   - 这里只放“前端可见也无所谓”的非密配置（CloudBase 环境 ID、云函数名、上传目录）。
//     环境 ID 会随小程序代码下发到客户端，本身不是密钥，因此 config.ts 可提交仓库。
//   - 千问 API Key 等真正的密钥绝对不能出现在小程序前端，只能放在云函数 / 后端环境变量中。
//     详见 docs/ai-pipeline.md。

export const CONFIG = {
  /** CloudBase 环境 ID（在微信开发者工具 / 腾讯云控制台获取） */
  cloudEnv: 'YOUR_CLOUDBASE_ENV_ID',
  /**
   * 数据源开关：
   *   false → 本地 mock（默认，无需任何云资源即可跑通流程）；
   *   true  → 真实 CloudBase（需先部署云函数 analyzeMeal、创建集合 meal_records、开通云存储）。
   */
  useCloud: false,
  /** 负责分析的云函数名 */
  analyzeFunctionName: 'analyzeMeal',
  /** 云存储中菜品照片的目录前缀 */
  uploadDir: 'meal-images/',
};

export type AppConfig = typeof CONFIG;
