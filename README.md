# 菜品质构识别小程序

拍一张菜的照片，认出这是什么菜，**拆出它包含的每一种食材**，再从
**500 道菜肴质构（TPA）实测库**里为每一种食材各自取出实测数据，
用「软 / 硬、好不好嚼、黏不黏牙」讲给老年用户听。

**一次识别只出一道菜，但食材要列全**：匹配的单位是**食材**——回锅肉拆出五花肉、蒜苗、青椒，
就有三张卡、三条实测数据，每一种都能单独看指标、单独换数据。

- 原生微信小程序 + TypeScript；
- 云端只做识别（千问 Qwen-VL），**质构匹配全部在手机本地完成**，换匹配项秒回；
- 质构库 712 条记录 / 496 道菜 / 454 种食材，含**切割测试**与**下压测试**两种 TPA 模式，
  同一食材两种都测过时并列展示；
- 同一食材有多个烹饪时长时，**一律取时间最长的那条**；
- **不估算食材重量**（实测误差过大，已整条移除）。

> 质构数据来自实验室对同类食材样本的 TPA 全质构测试，仅供参考软硬与咀嚼难度，
> 不等同于您这一份菜的实测值，也不构成医学建议。

## 功能与页面

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| 首页 | `pages/index` | 产品介绍、「开始拍照识别」主入口、历史记录入口、免责声明 |
| 拍照上传页 | `pages/upload` | 拍照/相册选图、预览、删除重选、拍摄提示、开始识别 |
| 识别加载页 | `pages/analyzing` | 轮询云函数状态，展示「预处理 → 识别菜品与食材 → 匹配质构数据」 |
| 识别结果页 | `pages/result` | 识别出的菜 + **每种食材一张卡**（软硬刻度、咀嚼与黏牙、可展开九项指标、切割/下压双读数）；**每张卡各自带备选，可只换这一种食材的数据，也能搜索全库** |
| 历史记录页 | `pages/history` | 日期、缩略图、识别菜名、食材列表、匹配数与整体质构摘要；点击进详情，长按删除 |
| 记录详情页 | `pages/detail` | 只读展示同样的逐食材内容，九项指标默认展开，另附每条的数据出处文件名 |

### 用户流程

```
首页 → 拍照上传 → 识别加载 → 识别结果 →（某种食材不像就只换那一条）
                                └→ 历史记录 → 记录详情
```

## 匹配规则（对应需求文档）

匹配的单位是**一种食材**：模型拆出几种食材，就做几次独立匹配、返回几条数据。

1. **先按菜名匹配**：识别出的菜名与库中菜名几乎一致时（相似度 ≥0.82），
   **优先在这道菜内部**为每种食材找记录——同一道菜里的「土豆」比别的菜里的「土豆」更贴切；
2. **再按食材匹配**：菜名对不上、或那道菜里没有这种食材时，放开到全库给每条记录打分，
   权重上**食材优先、烹饪方式其次**（0.72 : 0.16，另加 0.12 菜名相似度）；
3. **多个烹饪时间取最长**：同一食材有 6 / 12 分钟两版时一律取 12 分钟那条
   （按食材各自取最久，因为土豆炖牛肉里土豆和牛肉根本没有公共时长）；
4. **切割与下压都测过就都给**：同一食材两种 TPA 测试模式都有数据时，结果页并列展示两组读数；
5. 每种食材各自附一组备选，点一下**只换这一种食材**的数据，不影响其它食材；改选会存进记录。

细节见 [`docs/ai-pipeline.md`](docs/ai-pipeline.md)。

## 目录结构

```
miniprogram-1/
├── miniprogram/                小程序根目录
│   ├── app.ts / app.json / app.wxss
│   ├── pages/                  index / upload / analyzing / result / history / detail
│   ├── data/
│   │   ├── textureDb.data.ts   ⚠️ 机器生成的质构数据（712 条，勿手改）
│   │   └── textureDb.ts        解码、索引与「软硬 / 好嚼」通俗解读
│   ├── services/
│   │   ├── textureMatch.ts     质构匹配引擎（纯本地，按「食材」两步匹配 + 备选 + 搜索）
│   │   ├── mealService*.ts     数据访问层（契约 / mock / cloud / 分发器）
│   │   └── config.ts           非密配置（云环境 ID、useCloud 开关）
│   ├── types/index.ts          MealAnalysis / Dish / RecognizedIngredient / AnalysisStatus
│   ├── utils/                  similarity / texture / format / confidence / storage
│   └── mock/                   无云端时的假识别结果
├── cloudfunctions/analyzeMeal/ 千问 Qwen-VL 识别云函数（一道菜 + 全部食材，Key 在环境变量里）
├── scripts/
│   ├── build-texture-db.py     xlsx → textureDb.data.ts 的编译脚本
│   └── source/*.xlsx           质构原始表（数据来源，可追溯）
├── docs/
│   ├── ai-pipeline.md          识别与质构匹配流程、匹配规则、展示口径
│   ├── cloudbase-integration.md 云资源与 service 对照
│   └── deploy-and-apikey.md    ⭐ 发布上线 与 更换 API Key 的操作手册
└── project.config.json
```

## 本地开发

```bash
npm install          # 仅安装类型依赖
npm run type-check   # tsc --noEmit，应无报错
```

微信开发者工具 → 导入项目 → 目录选仓库根目录（含 `project.config.json`）。
工具内置 TS 编译插件会自动把 `.ts` 编译成 `.js`，无需手动构建。

### 重新生成质构数据库

改了 `scripts/source/500道菜肴质构数据_切割测试_下压测试分类.xlsx` 之后：

```bash
python3 scripts/build-texture-db.py
```

（需要 `pip install openpyxl`；输出会覆盖 `miniprogram/data/textureDb.data.ts`。）

## 发布上线 / 更换 API Key

完整步骤见 [`docs/deploy-and-apikey.md`](docs/deploy-and-apikey.md)。两句话版本：

- **换 Key**：开发者工具 →「云开发」→ 云函数 `analyzeMeal` →「版本与配置」→
  环境变量 `DASHSCOPE_API_KEY` 改成新值 → 保存。**代码不用动，小程序不用重新发版。**
- **发新版**：`npm run type-check` → 开发者工具「上传」（填版本号）→
  [mp.weixin.qq.com](https://mp.weixin.qq.com) →「管理 → 版本管理」→ 选为体验版试用 →
  提交审核 → 通过后点「发布」。改过云函数的话，还要右键 `cloudfunctions/analyzeMeal`
  「上传并部署：云端安装依赖」。

## 安全约定

- 千问 API Key 等**真正的密钥**只能放在云函数环境变量，前端代码与仓库不得包含；
- CloudBase 环境 ID 会下发到客户端、非密钥，故 `config.ts` 纳入版本管理；
- `project.private.config.json`、`.env*` 已被 `.gitignore` 忽略；
- 质构数据一律标注为「同类菜肴实测参考值」，不表述为对用户这一份菜的实测或医学建议。
