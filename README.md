# 餐盘识别小程序（MVP 骨架）

一个简约的「餐盘拍照识别与食材重量估算」微信小程序。当前为**第一阶段 MVP 骨架**：

- 原生微信小程序 + TypeScript；
- 完整的 5 个核心页面与用户流程；
- 所有数据来自 **mock**，通过可替换的 `service` 层提供，便于后续接入 CloudBase；
- **不调用真实千问 API、不部署任何云资源、不包含任何密钥 / AppID / 环境 ID**。

> 识别结果基于图像估算，仅供饮食记录与健康管理参考，不等同于真实称重或医学建议。

## 功能与页面

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| 首页 | `pages/index` | 产品介绍、「开始拍照识别」主入口、历史记录入口、免责声明 |
| 拍照上传页 | `pages/upload` | 拍照/相册选图、预览、删除重选、餐盘直径选择（22/24/26/28/自定义，默认 26）、拍摄提示、开始分析 |
| 分析加载页 | `pages/analyzing` | 展示分阶段加载文案与进度，模拟 ~3 秒后跳转结果页（已对接真实异步状态机字段） |
| 识别结果页 | `pages/result` | 菜品卡片：菜名、烹饪方式、食材、预估重量与区间、可信度、限制说明；选择食用比例（1/4·1/2·3/4·全吃完）后自动计算实际摄入 |
| 历史记录页 | `pages/history` | 本地 mock 历史列表：日期、缩略图、菜品摘要、总预估重量、食用比例、实际摄入；点击进入详情，长按删除 |
| 记录详情页 | `pages/detail` | 只读展示某条历史记录的完整结果 |

### 用户流程

```
首页 → 拍照上传 → 分析加载 → 识别结果 →（选择食用比例，自动算摄入）
                                   └→ 历史记录 → 记录详情
```

## 目录结构

```
食材识别小程序/
├── miniprogram/                小程序根目录
│   ├── app.ts / app.json / app.wxss   入口、全局配置、全局样式
│   ├── sitemap.json
│   ├── pages/                  五个页面 + 详情页（各含 .ts/.wxml/.wxss/.json）
│   │   ├── index/              首页
│   │   ├── upload/             拍照上传页
│   │   ├── analyzing/          分析加载页
│   │   ├── result/             识别结果页
│   │   ├── history/            历史记录页
│   │   └── detail/             记录详情页
│   ├── types/index.ts          核心类型：MealAnalysis / Dish / Ingredient
│   │                           / ConsumptionRecord / AnalysisStatus 等
│   ├── services/
│   │   ├── mealService.ts       可替换 service 层（当前为 mock）
│   │   └── config.example.ts    配置示例（复制为 config.ts，已 gitignore）
│   ├── utils/                  format / confidence / weight / storage
│   └── mock/                   dishes / history 模拟数据
├── docs/
│   ├── cloudbase-integration.md  CloudBase 接入规划（资源、库结构、替换对照）
│   └── ai-pipeline.md            千问两段式分析流程与安全约束
├── typings/index.d.ts          全局类型（引用 miniprogram-api-typings）
├── project.config.json         项目配置（appid 为占位 touristappid）
├── tsconfig.json
├── package.json                仅含类型检查用 devDependencies
├── .env.example                后端/云函数环境变量示例（含密信息仅在此类文件占位）
└── .gitignore
```

## 本地启动

### 1. 安装类型依赖（用于 TS 类型检查与编辑器提示）

```bash
npm install
npm run type-check   # 等价于 tsc --noEmit，应无报错
```

> 微信开发者工具内置 TypeScript 编译插件，会在导入后自动把 `.ts` 编译为 `.js`，
> 无需手动构建。`npm install` 主要为 `miniprogram-api-typings` 提供类型。

### 2. 在微信开发者工具中导入

1. 打开「微信开发者工具」→ 导入项目；
2. 目录选择本仓库根目录 `食材识别小程序/`；
3. AppID：当前 `project.config.json` 使用占位 `touristappid`，可先选择「测试号」直接预览；
   正式使用时替换为你自己的 AppID（建议在工具内填写，会写入已被忽略的 `project.private.config.json`）；
4. 编译运行，即可走通完整流程。首次进入历史页会自动注入两条示例记录。

### 3.（可选）填写本地配置

接入 CloudBase 前不需要任何配置。需要时：

```bash
cp miniprogram/services/config.example.ts miniprogram/services/config.ts
# 编辑 config.ts 填入 CloudBase 环境 ID（config.ts 已被 .gitignore 忽略）
```

## mock 如何替换为 CloudBase

所有数据访问都收敛在 `miniprogram/services/mealService.ts`，**函数签名稳定**，接入时只替换函数内部实现：

| service 函数 | 当前（mock） | 接入后（CloudBase） |
| --- | --- | --- |
| `uploadMealImage` | 返回本地临时路径 | `wx.cloud.uploadFile` |
| `createMealAnalysis` | 写 Storage + 生成 mock | `wx.cloud.callFunction({ name: 'analyzeMeal' })` |
| `getMealAnalysisStatus` | 按时间推进状态机 | 查询/监听 `meal_records.status` |
| `getMealAnalysisResult` | 读 Storage | 查询 `meal_records` 文档 |
| `saveDishConsumption` | 写 Storage | 更新文档 `consumptions` |
| `getMealHistory` | 读 Storage | 按用户查询 `meal_records` |
| `deleteMealRecord` | 删 Storage | 删文档 + 删云存储图片 |

详见 [`docs/cloudbase-integration.md`](docs/cloudbase-integration.md) 与 [`docs/ai-pipeline.md`](docs/ai-pipeline.md)。

## 安全约定

- 千问 API Key 只能放在**云函数 / 后端环境变量**，前端代码与仓库不得包含；
- 真实 AppID、CloudBase 环境 ID、密钥等均通过 `project.private.config.json` / `config.ts` / `.env` 提供，且已在 `.gitignore` 中忽略；
- 重量始终以「预估值 + 区间 + 可信度」展示，并标注「预估结果，仅供记录参考」。

## 状态

- [x] 五页面 + 详情页与完整流程（mock）
- [x] 类型与 service 层、CloudBase / 千问预留文档
- [x] `tsc --noEmit` 通过
- [ ] 接入 CloudBase 云存储 / 云函数 / 云数据库
- [ ] 接入千问视觉模型两段式分析
