// 运行时配置。
// 注意：这里只放“前端可见也无所谓”的非密配置（CloudBase 环境 ID、云函数名、上传目录）。
//   - CloudBase 环境 ID 会随小程序代码下发到客户端，本身不是密钥，可提交仓库。
//   - 千问 API Key 等真正的密钥只能配置在云函数 / 后端环境变量，绝不出现在此文件。
// 详见 docs/ai-pipeline.md。

export const CONFIG = {
  /** CloudBase 环境 ID */
  cloudEnv: 'cloud1-d8gfgeids7d390dbc',
  /**
   * 数据源开关：
   *   false → 本地 mock（默认，无需任何云资源即可跑通流程）；
   *   true  → 真实 CloudBase（需先部署云函数 analyzeMeal、创建集合 meal_records、开通云存储）。
   * 控制台资源就绪后改为 true 即切到真实后端，页面无需改动。
   */
  useCloud: true,
  /** 负责分析的云函数名 */
  analyzeFunctionName: 'analyzeMeal',
  /** 云存储中菜品照片的目录前缀 */
  uploadDir: 'meal-images/',
};

export type AppConfig = typeof CONFIG;
