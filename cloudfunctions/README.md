# cloudfunctions/

CloudBase 云函数目录（`project.config.json` 的 `cloudfunctionRoot`）。

前端数据源由 `miniprogram/services/config.ts` 的 `useCloud` 开关控制：
`false` 走本地 mock，`true` 走下述云函数 + 云数据库。

## `analyzeMeal`

- **职责**：只做菜品识别（菜名 / 烹饪方式 / 原食材），**不估算重量**；质构匹配在小程序本地完成。
- **单段异步，两个 action**——
  - `action='create'`：写入 `pending` 记录、秒回 `analysisId`；
  - `action='process'`：取图片临时地址 → 调千问识别 → 写回 `result.dishes` 与 `completed`。
  前端分两次调用（`process` 不等待），靠 analyzing 页轮询 status 感知进度。
- **千问 API Key 必须配置在本函数的环境变量 `DASHSCOPE_API_KEY` 中，不写入前端或仓库。**
- **换 Key** 只需改这个环境变量，代码不动、小程序不用重新发版（见 [`../docs/deploy-and-apikey.md`](../docs/deploy-and-apikey.md)）。

### 部署 / 配置

1. 右键 `cloudfunctions/analyzeMeal` →「上传并部署：云端安装依赖」（云端 `npm install` `wx-server-sdk`、`axios`）；
2. 云开发控制台 → 云函数 → `analyzeMeal` → 配置：
   - **环境变量** `DASHSCOPE_API_KEY` = 你的千问 Key；
   - **超时时间**改为 **60s**（千问视觉调用较慢，默认 3s 会被掐断）；
3. 确保集合 `meal_records`（权限「仅创建者可读写」）与云存储已就绪；
4. 前端 `miniprogram/services/config.ts` 的 `useCloud` 设为 `true`。

详见 [`../docs/ai-pipeline.md`](../docs/ai-pipeline.md)、[`../docs/cloudbase-integration.md`](../docs/cloudbase-integration.md) 与 [`../docs/deploy-and-apikey.md`](../docs/deploy-and-apikey.md)。
