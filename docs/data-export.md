# 识别数据导出

导出工具在电脑上运行，用于汇总所有参与者的数据。无需修改数据库权限、部署新云函数或重新发布小程序。

首次在项目根目录运行 `npm install`。本地转换需要 Node.js 18+，使用项目已有的 TypeScript 依赖读取实测库。

## 推荐：后台下载 JSON，再一条命令转 CSV

1. 登录 [CloudBase 控制台](https://tcb.cloud.tencent.com/)，选择小程序正在使用的环境（见 `miniprogram/services/config.ts` 中的 `cloudEnv`）。
2. 进入「文档型数据库 → 集合管理 → meal_records → 导出」。选择 **JSON**，不限定字段，导出全部字段。不要先导出 CSV，嵌套食材和评估数据可能不完整。
3. 将文件保存到项目的 `exports/input/meal_records.json`（目录不存在时自行创建），执行：

```bash
npm run export:data
```

也可以直接指定下载文件，无须移动：

```bash
npm run export:data -- --input "/完整路径/下载的文件.json"
```

支持 JSON 数组、每行一条 JSON（JSONL/NDJSON）、单条文档及 `{ "data": [...] }`。原始文件只读；每次结果放在新的时间戳目录中，避免覆盖上次数据。每次导出使用完整备份，**不要把多次完整备份拼在一起**；重复记录 ID 会报错。

## 可选：从云端直接下载并转换

在有该云环境管理权限的电脑上，首次安装项目依赖并登录官方命令行工具。本项目已固定包含 CloudBase CLI **3.8.4**：

```bash
npm install
TCB_NO_BROWSER=1 npx tcb login --flow web
```

上面的 macOS/Linux 登录命令只显示官方授权链接，不自动打开默认浏览器；将链接复制到自己选择的浏览器完成登录和授权。CLI 页面会说明完整的权限范围，请由管理员确认。此后在项目根目录运行：

```bash
npm run export:cloud
```

默认从 `miniprogram/services/config.ts` 读取环境 ID，也可覆盖：

```bash
npm run export:cloud -- --env-id 你的云环境ID
```

脚本调用官方 `tcb db nosql dump meal_records` 导出整个集合并下载，不受小程序历史列表的分页条数限制。只有云端任务成功、失败条数为 0、下载条数与云端成功条数一致时才转换。原始文件保留在本次输出的 `raw/`；任务 ID、环境 ID 和条数保存在 `cloud-export.json`。它是一次数据导出，不保证跨正在变化的记录获得业务上的同一时刻快照，正式统计宜在当批评估结束后执行。

该命令使用管理员登录态，读取全体参与者。普通参与者在小程序里的“仅创建者可读写”权限保持原样。不要在代码或小程序里填写管理员密钥。官方导出任务会在云存储产生一个导出文件，仍按现有云服务规则计算用量；下载后可按数据保留要求在控制台管理这些文件。

未安装 CLI、登录过期或缺少权限时会报错，此时仍可用第一种离线方式。云端入口按 macOS/Linux 的 `tcb` 可执行程序调用；Windows 可使用后台 JSON 加本地转换。

如果控制台显示「当前访问资源已临时隔离」，需先由管理员核对环境套餐及恢复条件；不能把隔离状态下无法读取数据误认为集合为空，也不要反复运行导出来尝试解除隔离。

## 常用筛选

**只需要一个CSV时，优先用单表入口：**

```bash
npm run export:single -- --input "/完整路径/meal_records.json" --output "exports/全部数据.csv"
```

每种食材一行，原始记录字段、菜品评估、食材重量、切割/下压九项指标横向合并；无菜品或无食材的记录也保留一行。额外测试来源和匹配备选（含其参考指标）分别保存在 `texture_matches_json`、`match_candidates_json` 列，不需要连接其他表。`row_type` 区分食材行与空结果记录。统计记录数只数 `record_first_row=1`，统计菜品数/累加菜品合计只取 `dish_first_row=1`，逐食材摄入量只在 `row_type=ingredient` 上求和。该文件包含所有识别相关数据，不把未参与任何匹配的参考库条目混作识别结果。输出文件已存在时不会覆盖。

如果需要**最全数据并补充质构匹配**，使用完整导出入口：

```bash
npm run export:full -- --input "/完整路径/meal_records.json"
```

此入口保留所有状态、所有食材和旧版一次识别中的多道菜，不应用上述默认排除规则。主要文件为 `ingredients_full.csv`，每种食材一行，含切割/下压九项指标。已保存快照与选择优先保留，缺失匹配用当前项目算法补充并注明 `recomputed_at_export`；原始模型重量、历史快照重量、本次重算重量和摄入量分别保存。另附全部原始字段、菜品表、质构长表、匹配备选、完整实测库、中文字段字典、使用说明和原始JSON备份。相似/未匹配及与当前算法不一致的历史匹配标记 `needs_review=1`，自动匹配不等于人工核验。照片保留云存储引用，不下载图片文件。

以下筛选选项适用于基础入口 `export:data` / `export:cloud`；`export:full` 始终完整导出。

```bash
# 2026年9月创建的记录，包含起止日，统一按UTC+08:00
npm run export:data -- --from 2026-09-01 --to 2026-09-30

# 某位参与者已经完成饭后评估的记录
npm run export:data -- --participant 001207 --completed-only

# 从云端取全量后，在本地筛出同样的范围
npm run export:cloud -- --from 2026-09-01 --to 2026-09-30 --completed-only

# 追溯用途：包含作废、失败、处理中记录以及被删除的食材
npm run export:data -- --all-records --include-excluded

# 指定结果存放的父目录，仍会新建时间戳子目录
npm run export:data -- --out "/完整路径/本次数据汇总"

npm run export:data -- --help
```

筛选根据识别创建时间 `createdAt`，不是饭后评估完成时间。日期筛选时，缺少有效创建时间的记录会跳过，并在摘要中单独计数。参与者编码精确匹配，不自动删除前导零。

## 输出文件及统计口径

| 文件 | 一行代表什么 | 用途 |
| --- | --- | --- |
| `meals.csv` | 一次识别、一道菜 | 菜品、参与者、同餐ID、状态、本道菜估重/摄入合计 |
| `ingredients.csv` | 某次识别中的一种食材 | 估重、食用比例、摄入克数、匹配结果、排除标记 |
| `textures.csv` | 一种食材的一条质构测试来源 | 切割/下压模式及九项实测指标 |
| `fields.csv` | 一个导出字段 | 对应表名、英文列名、中文含义、单位 |
| `manifest.json` | 本次导出摘要 | 筛选条件、输入/输出/排除条数、问题数、输入及实测库SHA-256 |

`record_id` 连接识别表和食材表；`record_id + ingredient_index` 连接食材表和质构表。`meal_session_id` 关联同一顿饭中的多道菜，旧记录可能没有该值，不能把所有空值视为同一顿饭。

**摄入量在 `ingredients.csv` 中求和，或直接使用 `meals.csv` 的本道菜合计，二者不可叠加。** 一种食材有切割和下压两份数据时，质构表会有多行。将质构表连接到食材表后再次求摄入量总和，会重复计数。

- 默认仅导出 `status=completed` 且未作废的记录，跳过失败、处理中以及重拍作废记录；被用户删除的食材默认不进入食材和质构表。
- 默认保留未完成评估及旧记录，方便检查遗漏。正式分析食用量可用 `--completed-only`，并检查 `issues`。已完成但数据缺项的记录仍会标记异常。
- `consumed_percent=0` 表示明确没有吃；空单元格表示未填、缺失或无效。比例范围 0–500，100 表示吃完拍照份量。`consumed_g` 来自已保存的评估，不根据默认比例补算。
- 估重取已保存的 `auditSnapshot`，不使用当前算法重算历史。旧记录缺少快照时，`estimated_g` 留空；模型原始输出另存 `model_estimated_g`，不能作为校正后的估重替代值。
- 2026-09-28 起，新模型会在云端进行份量代理校准。`area_ratio`、`height_cm`、`model_estimated_g` 仍导出校准前的原始模型预测；`effective_area_ratio`、`effective_height_cm`、`effective_estimated_g` 是供前端估重的校准后参数。`quantity_calibration_version`、`quantity_calibration_factor`、`calibration_reference_type` 说明校准口径。参照是用户认可的旧版减半后估重，不是实称。完整原始预测及校准信息还保留在数据库 `modelAudit` 与完整导出的 `raw_modelAudit` 中。
- 摄入量与快照估重不一致、用户改选与快照不一致时保留已保存值并给出 `issues`，不自动修正数据库。
- 质构指标并未随历史快照保存数值，工具按快照的“来源文件、测试模式、匹配菜名、匹配食材名”四项精确查找项目内的实测库，`value_source=bundled_library`。找不到唯一条目时留空并报问题，绝不重新进行模糊匹配。实测库哈希写入摘要，用于追溯本次所用库版本。
- 质构是同类样本的实验室参考值，不是对用户拍摄食物的测量；原表缺测保持空白，黏着性的负值正常保留。
- CSV 不含微信 `_openid`、临时图片访问链接；`image_file_id` 可用于管理员追溯。原始 JSON 仍保留后台导出的完整字段。

所有时间列使用带 `+08:00` 的 ISO 日期时间；数值不加千位分隔。CSV 使用 UTF-8 BOM，支持中文、逗号、双引号和多行文本。

**Excel 请用「数据 → 从文本/CSV」导入，并将 `participant_code`、`record_id`、`meal_session_id` 设为文本。** CSV 文件会保留 `001207`，但双击用 Excel 打开仍可能自动转成 `1207`。R/Python 读取时也应将这些列指定为字符串。可能被表格软件当成公式的文本会加前导单引号，原始值可在 JSON 中追溯；真实负数不会加单引号。

## 数据问题代码

`issues` 用英文分号分隔；`manifest.json` 的 `issueCounts` 按有该问题的识别记录数统计，同一记录同类问题只记一次。

| 代码 | 处理含义 |
| --- | --- |
| `missing_participant_code` | 缺少参与者编码，不能按参与者可靠归组 |
| `missing_or_invalid_created_at` | 缺少有效创建时间 |
| `legacy_evaluation_unknown` | 旧记录没有饭后评估状态 |
| `legacy_multiple_dishes_first_only` | 旧格式含多道菜，按现有小程序兼容规则取第一道；原始JSON保留全部 |
| `missing_dish` | 已完成记录缺少菜品结果 |
| `missing_snapshot` / `missing_ingredient_snapshot` | 缺少整条记录/某食材的估重快照 |
| `orphan_consumption` | 评估中有该食材，但识别结果和快照均无该食材 |
| `invalid_estimated_g` / `invalid_consumed_percent` / `invalid_consumed_g` | 无效数值，CSV留空 |
| `completed_evaluation_missing_values` | 评估标为完成但食用比例或克数缺失 |
| `consumption_weight_mismatch` | 摄入克数与快照估重×比例不一致 |
| `consumption_total_mismatch` | 逐食材摄入量合计与保存的本道菜合计不一致 |
| `selection_snapshot_mismatch` | 手动改选ID与快照主匹配ID不一致 |
| `missing_texture_sources` / `invalid_texture_source` | 质构来源缺失或格式异常 |
| `texture_source_not_unique_or_missing` | 快照来源无法唯一关联到当前实测库 |

## 先用示例检查流程

```bash
npm run export:demo
```

示例全部为合成数据，输入 5 条识别：默认输出 4 条识别、4 条食材、2 条质构测试；跳过 1 条作废记录及 1 种被删除食材。示例覆盖 `001207` 编码、双测试模式、明确零摄入、缺少快照的旧记录和待评估记录。

结果在 `exports/demo/` 的新子目录。真实输入建议放在 `exports/input/`，真实输出默认位于 `exports/runs/`，整个 `exports/` 已加入 `.gitignore`。原始文件应与导出结果一并备份；输出目录里存在 `manifest.json` 才表示本地转换已全部完成。

工程文件：`scripts/export-meals.cjs` 是离线入口，`scripts/export-cloud.cjs` 是云端入口，`scripts/export/core.cjs` 负责转换，`scripts/export/fields.cjs` 维护列定义，`tests/export.test.cjs` 覆盖导出逻辑和云端响应校验。运行 `npm test` 和 `npm run type-check` 检查。

官方参考（2026-09-27核对）：[控制台导出](https://docs.cloudbase.net/database/manage)、[CLI整集合导出](https://docs.cloudbase.net/cli-v1/db/nosql/management)、[CLI安装与登录](https://docs.cloudbase.net/cli-v1/functions/quick-start)。
