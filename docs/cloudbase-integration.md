# CloudBase 接入规划

> 本文档描述后续接入腾讯云开发（CloudBase）所需的资源与改造点。
> **当前阶段不创建任何云资源**，service 层全部返回 mock 数据。AppID、CloudBase 环境、云函数部署、API Key 由开发者自行完成。

## 1. 总览

```
小程序前端
  │  wx.cloud.uploadFile         上传餐盘照片到云存储
  │  wx.cloud.callFunction       调用云函数 analyzeMeal 发起分析
  │  wx.cloud.database()         读取/写入 meal_records
  ▼
CloudBase
  ├── 云存储   meal-images/      原始餐盘照片
  ├── 云函数   analyzeMeal       调用千问视觉模型 + 几何分析 + 写库
  └── 云数据库 meal_records      分析记录（嵌套 dishes / ingredients）
                model_logs       模型调用日志（可选）
```

## 2. 需要创建的资源

### 云存储
- 用途：保存用户餐盘照片。
- 目录前缀建议：`meal-images/`（见 `services/config.example.ts` 的 `uploadDir`）。

### 云函数 `analyzeMeal`
- 职责：调用千问视觉模型、执行图片几何分析、保存结构化结果。
- 详见 [`ai-pipeline.md`](./ai-pipeline.md)。
- **千问 API Key 只能配置在云函数的环境变量中，前端不得包含。**

### 云数据库
- `meal_records`：按「单条餐盘分析记录」存储，结构内嵌 `dishes` 与 `ingredients`，避免 MVP 阶段拆分过多集合。
- `model_logs`（可选）：记录每次模型调用的输入摘要、耗时、token、版本，便于排查与迭代。

## 3. `meal_records` 文档结构

与前端类型 `MealAnalysis`（见 `miniprogram/types/index.ts`）保持一致。建议字段：

```ts
{
  _id: string,              // 数据库主键，对应前端 analysisId
  _openid: string,          // 用户标识（数据库自动注入）
  imageFileId: string,      // 云存储 fileID
  imageUrl: string,         // 临时可访问地址（按需换取）
  plateDiameterCm: number,  // 餐盘直径
  status: AnalysisStatus,   // pending | preprocessing | stage_1_recognition
                            // | geometry_analysis | stage_2_weight_estimation
                            // | completed | failed
  modelName: string,        // 千问模型名
  promptVersion: string,    // prompt 版本
  result: {                 // 分析结果，嵌套存储
    dishes: Dish[],         // 含 ingredients
  },
  consumptions: ConsumptionRecord[], // 用户食用比例选择（前端计算后写回）
  createdAt: number,
  updatedAt: number,
}
```

> 说明：前端 `MealAnalysis` 为了使用方便把 `dishes` 放在顶层；落库时建议收进 `result.dishes`。
> `toHistoryItem` / 各页面读取处只需相应调整一处映射即可。
> 前端类型中的 `mockStartedAt` 仅用于本地模拟进度，接入后删除。

## 4. service 层替换对照

所有改造集中在 `miniprogram/services/mealService.ts`，**函数签名保持不变**，仅替换内部实现：

| service 函数 | 当前（mock） | 接入 CloudBase 后 |
| --- | --- | --- |
| `uploadMealImage` | 返回本地临时路径 | `wx.cloud.uploadFile({ cloudPath, filePath })` |
| `createMealAnalysis` | 写本地 Storage，立即生成结果 | `wx.cloud.callFunction({ name: 'analyzeMeal', data })`，返回 `analysisId` |
| `getMealAnalysisStatus` | 按时间推进状态机 | 查询 `meal_records.status` 或 `db.collection().watch()` 实时监听 |
| `getMealAnalysisResult` | 读本地 Storage | 查询 `meal_records` 文档 |
| `saveDishConsumption` | 写本地 Storage | `db.collection('meal_records').doc(id).update({ consumptions })` |
| `getMealHistory` | 读本地 Storage | `db.collection('meal_records').where({ _openid }).orderBy('createdAt','desc').get()` |
| `deleteMealRecord` | 删本地 Storage | 删除文档 + `wx.cloud.deleteFile` 清理云存储图片 |

## 5. 初始化改造

1. `npm i @cloudbase/...` 不需要——小程序直接使用内置 `wx.cloud`。
2. `project.config.json` 已填入真实 `appid`（`wxf338d5243e5cf268`）。✅ 已完成
3. `miniprogram/services/config.ts` 已填入 `cloudEnv`（`cloud1-d8gfgeids7d390dbc`）。✅ 已完成
4. `app.ts` 的 `onLaunch` 已调用 `wx.cloud.init({ env: CONFIG.cloudEnv })`。✅ 已完成
5. 待办：部署云函数 `analyzeMeal`，并在云函数环境变量中配置千问 API Key；创建云数据库 `meal_records`、云存储。

## 6. 安全要求

- 前端绝不包含千问 API Key；Key 仅存在于云函数环境变量（`.env` 已被忽略）。
- CloudBase 环境 ID 会下发到客户端、非密钥，`config.ts` 纳入版本管理；`project.private.config.json` 为工具本地配置，已被忽略。
- 重量数据始终展示为「预估值 + 区间」，不得表现为真实称重。
