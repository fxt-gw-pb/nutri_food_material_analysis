# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

菜品拍照识别 + 质构（TPA）数据匹配的微信小程序。原生小程序 + TypeScript。
面向老年用户回答「这道菜软不软、好不好嚼」。**本版本不做任何重量估算**（实测误差过大，已整条移除）。

**一次识别只出一道菜。** 匹配的单位始终是「菜」——识别出的原食材不单独展示，只用来在库里找最像的那道菜；
定位到菜之后，把这道菜测过的每种原食材作为该菜的源数据行全部列出。改选也是整道菜换。

## 命令

```bash
npm install                        # 仅安装类型依赖（miniprogram-api-typings、typescript）
npm run type-check                 # tsc --noEmit，提交/改动后应保持无报错
python3 scripts/build-texture-db.py  # 改了质构 xlsx 后重新生成内置数据库
```

- **无构建步骤、无测试框架。** 微信开发者工具内置 TS 编译插件会就地把 `.ts` 编译为 `.js`（这些 `.js` 已被 `.gitignore`，不要提交，也不要手动编辑）。
- **运行与调试只能在微信开发者工具内进行**：导入项目时目录选仓库根目录（含 `project.config.json`）。CLI 无法启动或预览小程序。
- 改动 TS 后用 `npm run type-check` 校验类型；`tsconfig` 为 `strict` + `noUnusedLocals`。

## 架构要点

**识别在云端，匹配在本地**——这是理解全局的第一句话。云函数只回答「这是什么菜、有哪些食材」，
质构数据库随小程序包下发，匹配、改选、搜索全在手机上算，不需要二次联网。
**匹配的单位是「食材」不是「菜」**：模型拆出几种食材，页面就出几张卡、几条实测数据。

1. **`miniprogram/data/textureDb*.ts` —— 内置质构数据库（只读）。**
   `textureDb.data.ts` 由 `scripts/build-texture-db.py` 从 `scripts/source/*.xlsx` 生成的紧凑元组数组，
   **机器生成，禁止手改**；要改数据就改 xlsx 再跑脚本。`textureDb.ts` 负责解码成 `TextureRecord`、
   建**菜名索引与食材索引**两套，并提供面向老人的通俗解读（`hardnessLabel` / `chewinessLabel` /
   `adhesivenessLabel`，阈值取自本库分位数，非医学标准）。数据源是 0828 版
   `500道菜肴质构数据_切割测试_下压测试分类.xlsx`，已有独立的「食材 / 烹饪方式 / 时间」列，
   直接读列即可（旧版解析「源文件名」的逻辑已删除）。表分 `切割测试` / `下压测试` 两个 sheet，
   编译进同一张表用 `testMode` 区分（653 / 59 行），下压覆盖的 59 道菜是切割的子集。

2. **`miniprogram/services/textureMatch.ts` —— 匹配引擎（需求的核心），以「食材」为单位。**
   模型拆出 N 种食材就做 N 次独立匹配。两步走：菜名相似度 ≥0.82 时**优先在这道菜内部**
   为每种食材找记录（食材相似度 ≥0.5 即采纳）；对不上再放开到全库给**每条记录**打分
   `0.72×食材相似度 + 0.16×烹饪方式接近度 + 0.12×菜名相似度`——权重就是需求里的
   「食材优先、烹饪方式其次」。三条硬规则：
   **①多个烹饪时间取最长**（`betterThan` 同分优先长时间，`dedupe` 生成备选时只留最长的那条，
   编译期也已按时长降序排）；**②切割与下压都测过就都返回**（`alternateTestModes`，页面并列展示）；
   **③每种食材各自带一组备选**，改选只影响这一种食材。
   中文食材名的相似度在 `utils/similarity.ts`，带刀工后缀剥离、**器具词剥离**
   （「鸭肉」↔「鸭肉高压锅」）与「同品类尾字加成」（基围虾 ↔ 鲜虾）。
   **改权重/阈值前先读 `docs/ai-pipeline.md`。**

3. **`miniprogram/utils/texture.ts` —— 识别结果 + 用户改选 → 页面视图（`ResolvedMeal`）。**
   关键约定：**匹配结果不落库**，每次打开记录都现算一遍，只有用户手动改过的
   `selectedRecords`（识别食材名 → 质构记录 id，只存被改过的那几种）会覆盖自动结果。
   这样质构库升级后老记录会自动用上新匹配。

4. **`miniprogram/services/mealService*.ts` —— 唯一的数据访问入口。**
   页面只从 `mealService.ts` 导入，从不直接读写 Storage 或调用云能力。四个文件：
   `mealService.api.ts`（`MealServiceApi` 契约，两套实现都必须满足，签名漂移会在 type-check 报错）、
   `mealService.mock.ts`（本地 `wx.Storage`，key `meal_records_v3`）、
   `mealService.cloud.ts`（`wx.cloud.uploadFile` / `callFunction({name:'analyzeMeal'})` / 云数据库）、
   `mealService.ts`（按 `CONFIG.useCloud` 分发）。**改数据访问时两侧一起改。**

5. **`miniprogram/types/index.ts` —— 跨层共享的数据契约。**
   `MealAnalysis` / `Dish` / `RecognizedIngredient` / `AnalysisStatus`
   同时约束前端展示、mock service 与云数据库 `meal_records` 文档结构。
   落库时 `dish` 收进 `result.dish`（前端为方便放在顶层，旧文档的 `result.dishes` 数组会兼容取第一道）；
   `mockStartedAt` 仅 mock 用。

6. **`AnalysisStatus` 异步状态机**：`pending → preprocessing → recognizing → completed`（或 `failed`）。
   `pages/analyzing` 每 400ms 轮询 `getMealAnalysisStatus`（带 `MAX_POLL_MS` 超时兜底），`completed` 时 `redirectTo` 结果页。

**页面流转**（`app.json` 注册顺序）：`index → upload → analyzing → result → history → detail`，
靠 query 参数 `analysisId` 串联。首次进入会注入两条 seed 历史（`mock/history.ts`，`SEEDED_KEY` 防重复）。

## 关键约定

- **密钥边界（务必遵守）**：千问 API Key **只能**放在云函数环境变量 `DASHSCOPE_API_KEY`，前端代码与仓库（包括 `config.ts`）绝不包含。`config.ts` 里只放非密信息——CloudBase 环境 ID 会随小程序下发到客户端、本身不是密钥，故 **`config.ts` 纳入版本管理**。`.env*` 与 `project.private.config.json` 已被忽略。**换 Key 只改云端环境变量，不改代码、不重新发版**（步骤见 `docs/deploy-and-apikey.md`）。
- **质构展示口径**：始终标注为「同类菜肴样本的实验室 TPA 实测参考值」，不得表现为对用户这一份菜的实测，也不得写成医学建议。页面上的免责声明不要删。
- **不要重新引入重量**：`Dish` 上没有克数字段，云函数 prompt 明确要求不估重量。
- **不要退回「一次多道菜」或「每个食材各自匹配」**：产品定位就是一次一道菜、整道换。
- 三份文档：`docs/ai-pipeline.md`（识别 + 匹配规则 + 展示阈值）、`docs/cloudbase-integration.md`（云资源与 service 对照）、`docs/deploy-and-apikey.md`（发版与换 Key 的点按手册）。
