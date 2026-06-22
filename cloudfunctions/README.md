# cloudfunctions/

CloudBase 云函数目录（`project.config.json` 的 `cloudfunctionRoot`）。

当前阶段为 MVP 骨架，**尚未实现任何云函数**，前端数据走 mock service 层
（`miniprogram/services/mealService.ts`）。

## 计划中的云函数

### `analyzeMeal`
- 职责：调用千问视觉模型识别菜品/食材/烹饪方式 → 几何分析估算面积 → 二次估算重量 → 写入云数据库 `meal_records`。
- **千问 API Key 必须配置在该云函数的环境变量中，不写入前端或仓库。**
- 详见 [`../docs/ai-pipeline.md`](../docs/ai-pipeline.md) 与 [`../docs/cloudbase-integration.md`](../docs/cloudbase-integration.md)。

> 在微信开发者工具中，右键本目录可「新建 Node.js 云函数」并上传部署。
