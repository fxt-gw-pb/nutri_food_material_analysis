# 2026-11-27 迁移规划：脱离微信小程序，自建封闭网页（方案 A）

## 1. 背景与决策

- **触发原因**：`2026.11.24` 开发版本（Git 提交 `cede073`）提交微信小程序正式版审核时被驳回，驳回原因为**涉及深度合成，个人主体不可申请，需要企业/非个人主体**。
- **路线决定（2026-11-27 用户确认方案 A）**：不办理个体工商户/企业主体升级，改为**脱离微信小程序平台，自建封闭科研网页（移动优先 H5 / PWA）**，使用**个人国内轻量应用服务器 + 个人备案域名 + HTTPS**。
- **既有资产保留**：原个人小程序（`wxf338d5243e5cf268`）及生产云开发环境（`cloud1-d8gfgeids7d390dbc`）保持原样不动；过渡期内 ≤15 个体验成员仍可使用体验版，历史数据继续按原流程导出。

---

## 2. 基础设施准备清单（用户侧，方案 A）

1. **国内轻量应用服务器**（阿里云或腾讯云，2 核 2G 即可）
   - 首次购买时长须 **≥ 3 个月（90 天）**，用于领取免费 ICP 备案服务号；
   - 自带 40–60 GB 系统盘足够存放上万张压缩后的菜品照片（前端压缩至 300–500 KB/张）。
2. **个人实名域名 + 个人非经营性 ICP 备案**（无需营业执照，备案免费，约 1–2 周）
   - 域名所有者须与备案人身份证一致；
   - 备案审核期间网站名称与备注避开「平台、系统、AI、医疗、调研、工作室」等敏感词，且审核期间不在域名根路径提前开放交互登录页。
3. **HTTPS 证书**（免费单域名 SSL 证书或 Let's Encrypt 自动续签；微信内置浏览器打开网页及调用拍照均依赖 HTTPS）。
4. **模型 API Key**：直接沿用现有阿里云千问 `DASHSCOPE_API_KEY`，无需升级企业实名或申请合作协议。

> 开发与备案可并行：在域名 ICP 备案期间，可先在本地完成网页版开发并通过手机局域网联调，备案通过后一键部署上线。

---

## 3. 现有代码盘点（可直接复用 vs 需新建/替换）

本项目核心算法与数据层和微信 API 解耦良好，已核查全仓 `wx.*` 调用边界：

### 可直接复用（0 处 `wx.*` / `wx-server-sdk` 依赖）
- **本地数据与字典**：
  - `miniprogram/data/textureDb.ts`、`miniprogram/data/textureDb.data.ts`（712 条质构实测库）
  - `miniprogram/data/nutritionDb.ts`、`miniprogram/data/nutritionDb.data.ts`（1,642 条《中国食物成分表第 6 版》数据；**注意：已在 `.gitignore` 中，只留本机，严禁提交到公开仓库**）
  - `miniprogram/data/questionnaire.ts`（6 题随访问卷定义）
- **核心算法与领域工具**：
  - `miniprogram/services/textureMatch.ts`（逐食材质构匹配引擎）
  - `miniprogram/services/nutritionMatch.ts`（食材→食物成分表匹配与带骨/干重折算）
  - `miniprogram/utils/weight.ts`（餐盘直径几何估重与交叉校验）
  - `miniprogram/utils/intake.ts`、`miniprogram/utils/intakeView.ts`（质量加权切割质构系数与营养素摄入）
  - `miniprogram/utils/texture.ts`、`evaluation.ts`、`questionnaire.ts`、`similarity.ts`、`confidence.ts`、`format.ts`
  - `miniprogram/types/index.ts`、`miniprogram/types/questionnaire.ts`
- **后端识别与问卷核心**：
  - `cloudfunctions/analyzeMeal/vision.js`（纯 Node 内置 `https` 调用千问）
  - `cloudfunctions/analyzeMeal/quantityCalibration.js`（份量代理校准，**务必保持固定快照 `qwen3.8-max-0902` 与校准参数不变，确保科研数据口径连续**）
  - `cloudfunctions/questionnaire/handler.js`（已依赖注入 `createHandler({ db, getOpenId, now })`）与 `schema.json`

### 需新建 / 替换的部分
1. **移动优先 Web 前端**（建议放在仓库内独立目录，如 `web/`，不破坏现有 `miniprogram/` 与 126 项回归测试）：
   - 复刻全部 10 个页面及 `2026-10-15` UI 改版风格与 `2026-11-24` 每日汇总功能：`index`、`upload`、`analyzing`、`result`、`history`、`detail`、`evaluation`、`questionnaire`、`questionnaire-history`、`daily`。
   - **拍照与选图**：使用 `<input type="file" accept="image/*">`（不要强加 `capture="environment"`，避免部分安卓微信内置浏览器无法从相册选图），上传前用 Canvas 压缩图片至约 300–500 KB/张，处理 EXIF 方向。
   - **本地存储与导航适配**：将 `storage.ts`、`userProfile.ts`、`evaluationDraft.ts`、`questionnaireDraft.ts`、`mealSession.ts`、`evaluationNavigation.ts`、`retakeNavigation.ts` 中的 `wx.*` 替换为 Web `localStorage` 与路由状态。
2. **自建后端服务**（建议 Node.js，与前端同机部署，如 `server/`）：
   - 替代 `mealService.cloud.ts`、`questionnaireService.ts` 与两个微信云函数壳子；
   - 提供图片上传（异步触发 `vision.js` 识别并轮询状态，保持原 `pending → preprocessing → recognizing → completed / failed / discarded` 状态机）、记录读写、饭后评估写入 `consumption.intake`、随访问卷防重提交与分页查询。
3. **封闭访问鉴权体系**（替代微信 `_openid`）：
   - 网页作为受控科研采集工具，**不向公众开放注册或匿名访问**；
   - 必须由服务端校验登录态/访问令牌，**严禁仅凭前端传入公开的 `participantCode` 就返回他人照片、饮食记录或随访问卷**。

---

## 4. 数据口径与合规红线（迁移不可违背）

1. **科研口径一致**：
   - 模型固定 `qwen3.8-max-0902`，保留 `quantityCalibration.js` 份量代理校准与 `ADAPTER_VERSION`、`modelAudit` 字段；
   - 自然日划分严格按北京时间（UTC+08:00）与 `createdAt` 毫秒时间戳，每个文档一条记录；
   - 饭后评估 `consumption.intake`、切割质构加权公式与营养素折算规则与 `docs/release-2026-11-24.md` 保持完全一致。
2. **导出兼容**：
   - `meal_records` 与 `questionnaire_responses` 字段命名及结构兼容现有 `scripts/export/` 导出链路（保留 `participantCode` 前导零、跳过作废记录与已删除食材等规则），确保新旧数据导出后可直接合并分析。
3. **安全与版权边界**：
   - `DASHSCOPE_API_KEY` 仅保存在服务端环境变量，不得下发到前端或提交进仓库；
   - 《中国食物成分表标准版（第 6 版）》相关 CSV 与 `nutritionDb.data.ts` 仅保留在本地及受控服务器构建，不得提交至公开仓库，也不向未登录公众暴露；
   - 页面保留原有免责声明（质构为同类食材实测参考，估重为图像估算，不构成医学建议）。

---

## 5. 动工前待向用户确认的 2 项细节

后续开始搭建网页版前，请先与用户确认以下两项（其余基建已锁定方案 A）：

1. **封闭访问模式**：
   - 选项 1：调研员口令登录（输入口令后可自由切换不同参与者编号，适合调研员/护工代拍）；
   - 选项 2：每位参与者专属扫码链接/二维码（扫码自动绑定本人编号并持久化登录态，适合老人/家属自用）；
   - 选项 3：两种模式同时支持（推荐，配一个极简管理员发码页/脚本）。
2. **数据存储位置**：
   - 选项 1（推荐）：独立存在新服务器数据库（SQLite / PostgreSQL）+ 本地磁盘存图（配定时备份），字段完全兼容 `scripts/export/`，老数据从 `cloud1-d8gfgeids7d390dbc` 导出后合并；
   - 选项 2：后端通过腾讯云开发 Node SDK 继续写入原微信云 `cloud1-d8gfgeids7d390dbc`。

---

## 6. 2026-11-27 确认结果与实现

- **封闭访问模式**：选项 3（调研员口令 + 参与者专属链接/二维码，附管理命令 `food-web-admin issue / sheet / revoke / list`）。
- **数据存储位置**：选项 1（新服务器 SQLite + 本地磁盘存图，每日自动备份），导出格式与 `scripts/export/` 兼容，可用 `export --merge` 与小程序导出合并。
- **前端实现方式**：没有按第 3 节设想新写 10 个页面，而是让 `miniprogram/pages/` 原样在浏览器里运行（构建期 WXML → Vue 渲染函数，运行期实现 `Page`/`setData`/`wx.*`）；只有 `config.ts`、`mealService.cloud.ts`、`userProfile.ts` 三个模块被网页实现替换。小程序与网页共用一份页面与算法代码，原有回归测试继续有效。
- 基础设施尚未购买；代码已在本地完成并通过浏览器全流程验证，服务器与备案就绪后按 [网页版说明](web-version.md) 的「部署上线」一节操作。
