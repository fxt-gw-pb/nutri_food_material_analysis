# CloudBase 接入规划

> 本文档描述本项目用到的腾讯云开发（CloudBase）资源与前端 service 的对应关系。
> 具体的点按操作（部署云函数、配置 Key、上传发版）见 [`deploy-and-apikey.md`](./deploy-and-apikey.md)。

## 1. 总览

```
小程序前端
  │  wx.cloud.uploadFile         上传餐盘照片到云存储
  │  wx.cloud.callFunction       调用云函数 analyzeMeal 发起分析
  │  wx.cloud.database()         读取/写入 meal_records
  ▼
CloudBase
  ├── 云存储   meal-images/      原始菜品照片
  ├── 云函数   analyzeMeal       调用千问视觉模型识别菜名/食材 + 写库
  └── 云数据库 meal_records      识别记录（嵌套 result.dish 与其 ingredients）
                model_logs       模型调用日志（可选）

质构数据的匹配不在云端：数据库内置在小程序包里，全部本地计算（见 ai-pipeline.md）。
```

## 2. 需要创建的资源

### 云存储
- 用途：保存用户菜品照片。
- 目录前缀建议：`meal-images/`（见 `services/config.example.ts` 的 `uploadDir`）。

### 云函数 `analyzeMeal`
- 职责：调用千问视觉模型识别**一道**菜的菜名 / 烹饪方式 / 原食材，保存结构化结果（不涉及重量）。
- 详见 [`ai-pipeline.md`](./ai-pipeline.md)。
- **千问 API Key 只能配置在云函数的环境变量中，前端不得包含。**

### 云数据库
- `meal_records`：按「单次识别记录」存储，结构内嵌 `dish` 与其 `ingredients`，避免拆分过多集合。
- `model_logs`（可选）：记录每次模型调用的输入摘要、耗时、token、版本，便于排查与迭代。

## 3. `meal_records` 文档结构

与前端类型 `MealAnalysis`（见 `miniprogram/types/index.ts`）保持一致。建议字段：

```ts
{
  _id: string,              // 数据库主键，对应前端 analysisId
  _openid: string,          // 用户标识（数据库自动注入）
  imageFileId: string,      // 云存储 fileID
  imageUrl: string,         // 临时可访问地址（按需换取）
  status: AnalysisStatus,   // pending | preprocessing | recognizing
                            // | completed | failed
  modelName: string,        // 千问模型名
  promptVersion: string,    // prompt 版本
  result: {                 // 识别结果，嵌套存储
    dish: Dish | null,      // 一道菜：菜名 / 烹饪方式 / 可信度 / ingredients（无重量）
  },
  selectedDish: string,     // 用户在结果页手动改选的库中菜名，空串=采用自动匹配
  createdAt: number,
  updatedAt: number,
}
```

> 说明：前端 `MealAnalysis` 为了使用方便把 `dish` 放在顶层；落库时收进 `result.dish`。
> 早期版本存的是 `result.dishes` 数组，`mealService.cloud.ts` 读取时会兼容取第一道。
> `toHistoryItem` / 各页面读取处只需相应调整一处映射即可。
> 前端类型中的 `mockStartedAt` 仅用于本地模拟进度，接入后删除。

## 4. service 层替换对照

service 层已拆分为契约 + 两套实现，由 `config.ts` 的 `useCloud` 开关分发，**页面无需改动**：

- `mealService.api.ts`：`MealServiceApi` 契约（两套实现都必须满足，签名漂移会在 type-check 报错）；
- `mealService.mock.ts`：本地 mock 实现；
- `mealService.cloud.ts`：CloudBase 实现（已完成，对照下表）；
- `mealService.ts`：按 `useCloud` 选择其一对外导出。

下表为两套实现的对应关系（函数签名一致）：

| service 函数 | 当前（mock） | 接入 CloudBase 后 |
| --- | --- | --- |
| `uploadMealImage` | 返回本地临时路径 | `wx.cloud.uploadFile({ cloudPath, filePath })` |
| `createMealAnalysis` | 写本地 Storage，立即生成结果 | `wx.cloud.callFunction({ name: 'analyzeMeal', data })`，返回 `analysisId` |
| `getMealAnalysisStatus` | 按时间推进状态机 | 查询 `meal_records.status` 或 `db.collection().watch()` 实时监听 |
| `getMealAnalysisResult` | 读本地 Storage | 查询 `meal_records` 文档 |
| `saveSelectedDish` | 写本地 Storage | `db.collection('meal_records').doc(id).update({ selectedDish })` |
| `getMealHistory` | 读本地 Storage | `db.collection('meal_records').where({ _openid }).orderBy('createdAt','desc').get()` |
| `deleteMealRecord` | 删本地 Storage | 删除文档 + `wx.cloud.deleteFile` 清理云存储图片 |

## 5. 初始化改造

1. `npm i @cloudbase/...` 不需要——小程序直接使用内置 `wx.cloud`。
2. `project.config.json` 已填入真实 `appid`（`wxf338d5243e5cf268`）。✅ 已完成
3. `miniprogram/services/config.ts` 已填入 `cloudEnv`（`cloud1-d8gfgeids7d390dbc`）。✅ 已完成
4. `app.ts` 的 `onLaunch` 已调用 `wx.cloud.init({ env: CONFIG.cloudEnv })`。✅ 已完成
5. `mealService.cloud.ts` 已实现真实 `wx.cloud.*` 调用（`useCloud` 开关分发）。✅ 已完成
6. `analyzeMeal` 云函数已接入千问 Qwen-VL（只识别、不估重）。✅ 已完成

### 控制台开通清单（启用 `useCloud=true` 前需完成）

- [ ] 上传部署云函数 `analyzeMeal`（右键「上传并部署：云端安装依赖」）；
- [ ] 为 `analyzeMeal` 配置环境变量 `DASHSCOPE_API_KEY`、超时时间 60s；
- [ ] 创建云数据库集合 `meal_records`，权限设为「仅创建者可读写」；
- [ ] 开通云存储（图片存于 `meal-images/` 前缀下）；
- [ ] 把 `miniprogram/services/config.ts` 的 `useCloud` 改为 `true`。

逐步操作见 [`deploy-and-apikey.md`](./deploy-and-apikey.md)。

## 6. 安全要求

- 前端绝不包含千问 API Key；Key 仅存在于云函数环境变量（`.env` 已被忽略）。
- CloudBase 环境 ID 会下发到客户端、非密钥，`config.ts` 纳入版本管理；`project.private.config.json` 为工具本地配置，已被忽略。
- 质构数据始终标注为「同类菜肴样本的实验室实测参考值」，不得表现为对用户这一份菜的实测，也不构成医学建议。
