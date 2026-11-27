# 网页版（2026-11-27 起）：自建封闭科研网页

微信以「涉及深度合成，个人主体不可申请」驳回了 `2026.11.24` 的正式版审核。按[迁移规划](web-migration-plan-2026-11-27.md)的方案 A，项目改为在自己的服务器上运行一个**需要登录才能使用的网页**。原小程序与云开发环境 `cloud1-d8gfgeids7d390dbc` 不动，过渡期体验版照常可用、历史数据照常导出。

用户确认的两项（2026-11-27）：

- **访问方式：调研员口令 + 参与者专属链接**。网址公开可访问，但不登录什么也看不到；
- **数据存储：新服务器 SQLite**，照片存本机磁盘，字段与云数据库同名集合一致。

## 一句话架构

**页面代码不重写。** 网页版直接运行 `miniprogram/pages/` 里的小程序页面：WXML 在构建时转成 Vue 渲染函数，页面 `.ts` 原样执行，`wx.*` 由一层网页实现接住。识别、匹配、估重、摄入计算全部是小程序那一份代码，126 项回归测试同时守着两个版本。

```
手机浏览器 / 微信内置浏览器
  └─ /app/  （登录后才下发；包内含质构库与食物成分表）
       miniprogram/pages/*      ← 原样运行（Page + setData + wx.*）
       web/src/runtime/         ← Page 实例、页面栈与浏览器历史、提示框/对话框、选图压缩
       web/src/overrides/       ← 3 个直接依赖微信云的模块换成网页实现
         │  fetch（同源 Cookie）
Nginx (HTTPS) → Node 服务 server/dist/server.cjs（只需 Node 24，零 npm 依赖）
       ├─ 登录：调研员口令 / 参与者链接 /p/<令牌>
       ├─ /api/meals…   ← 对应 mealService.cloud.ts 每个函数，评估与快照用同一份 utils/evaluation.ts 计算
       ├─ /api/cloud/questionnaire ← 对应云函数 questionnaire（复用其 validateSubmission 与 schema.json）
       ├─ 识别队列      ← 直接复用 cloudfunctions/analyzeMeal/vision.js（快照、提示词、份量校准不变）
       └─ SQLite（DATA_DIR/app.db）+ 照片（DATA_DIR/images/）
```

### 与小程序的差别（有意为之）

| 方面 | 小程序 | 网页版 |
| --- | --- | --- |
| 身份 | 微信 `_openid`，集合「仅创建者可读写」 | 调研员可看全部编号；参与者只能读写本人编号。**每个接口都在服务端校验**，不凭前端传来的编号 |
| 照片交给千问 | 云存储临时链接 | 照片以 base64 data URL 放进请求体（DashScope 兼容接口支持），服务器不对外暴露照片地址 |
| 选图 | `wx.chooseMedia` 压缩图 | `<input type="file" accept="image/*">`（不加 capture，安卓微信里仍可选相册），本机缩到长边 1600px、JPEG 0.85，约 300–500 KB，按 EXIF 方向转正 |
| 饭后评估、审计快照、摄入汇总 | 手机算好写库 | 服务端用同一份 `utils/evaluation.ts` 计算后写库（结果相同，前端不能写入任意值） |
| 识别失败阶段 | 「获取图片临时地址」 | 「读取图片」；服务重启时 10 分钟内的任务重新排队，更早的标为失败（阶段「服务重启」） |
| 文档标识 | `_openid` = 微信 openid | `_openid` = `web:researcher` 或 `web:participant:<编号>`，另加 `source: "web"` |
| 两处文案 | 「当前微信账号」「本手机」 | 改为按参与者统计的说法（`web/plugins/miniprogram.mjs` 的 `WEB_TEXT`；原文变了构建会报错） |

模型仍是固定快照 `qwen3.8-max-0902`，`PROMPT_VERSION`、`ADAPTER_VERSION`、份量校准系数、`modelAudit` 字段全部与云函数一致；自然日仍按 `createdAt` 与 UTC+08:00 划分。

### 访问控制

- **调研员**：在 `/login` 输入口令（服务器环境变量 `RESEARCHER_PASSCODE`），登录 30 天。同一 IP 15 分钟内错 8 次即锁定。登录后与小程序一样，在首页填写为谁记录。
- **参与者**：管理员签发专属链接 `https://域名/p/<令牌>`，打印成二维码交给参与者。扫一次即记住身份（180 天，使用期间自动续期），编号固定为本人，界面里的编号框只读。
- 重新签发或停用链接后，旧链接与已登录的设备**立即失效**；令牌只存哈希。
- 写操作要求自定义请求头并核对 Origin，防跨站伪造；页面设置了严格的 Content-Security-Policy，禁止被嵌入。
- 前端包（含《中国食物成分表》数据）只下发给已登录的人；`/` 首页与 `/login` 是不含数据的静态页。

## 本地开发与手机联调

```bash
npm install
cp .env.example .env          # 填 DASHSCOPE_API_KEY；RESEARCHER_PASSCODE 不填则为 dev-passcode
npm run web:dev               # 真实识别
VISION_MOCK=1 npm run web:dev # 不调用千问，约 3 秒后返回示例菜品
```

打开 `http://localhost:5173/login` 用口令登录。手机连同一个 Wi-Fi，访问终端里显示的 Network 地址（如 `http://192.168.1.8:5173/login`）即可真机联调。数据默认存在仓库下的 `web-data/`（已忽略，不进仓库）。

本地签发一个参与者链接试试：

```bash
npm run web:build
PUBLIC_ORIGIN=http://localhost:5173 npm run web:admin -- issue 001207
```

检查：

```bash
npm test                 # 原 126 项 + 网页版转换器与后端接口测试
npm run type-check       # 小程序
npm run web:type-check   # 网页运行时与后端
```

## 部署上线

前提：国内轻量应用服务器（2 核 2G 即可，Ubuntu 22.04/24.04）、已备案并解析到该服务器的域名。购买与备案的逐步说明见 [上线准备：服务器、域名、ICP 备案](launch-prep-server-domain-icp.md)。**ICP 备案通过之前不要部署**——未备案域名在国内服务器上无法访问，审核期间也不应开放可登录的页面。

1. 把部署工具传到服务器并初始化（一次）：

   ```bash
   scp -r deploy ubuntu@服务器IP:~/
   ssh ubuntu@服务器IP 'sudo bash ~/deploy/setup-server.sh 你的域名'
   ```

   脚本会安装 Node 24、Nginx、certbot，生成 `/etc/food-web.env` 并**打印随机调研员口令**（请记下），装好 systemd 服务、管理命令 `food-web-admin` 和每天 3:30 的自动备份。

2. 在服务器上填 API Key：`sudo nano /etc/food-web.env`，填 `DASHSCOPE_API_KEY`（与云函数用同一个）。
3. 在电脑上构建并上传（以后每次更新也只跑这一句）：`deploy/deploy.sh ubuntu@服务器IP`。它会先跑全部测试，失败就不上传。
4. 申请 HTTPS 证书：`ssh ubuntu@服务器IP 'sudo certbot --nginx -d 你的域名'`（自动续期）。微信内置浏览器拍照上传需要 HTTPS。
5. 填备案号：在 `/etc/food-web.env` 填 `ICP_NUMBER`（首页、登录页底部显示并链接工信部系统），`sudo systemctl restart food-web`。网站开通后 30 日内办理公安联网备案，号码填 `PSB_NUMBER`。

## 日常运维（服务器上，均需 sudo）

| 要做的事 | 命令 |
| --- | --- |
| 给参与者发链接（终端显示二维码） | `sudo food-web-admin issue 001207 --note 张阿姨` |
| 批量生成可打印的二维码页 | `sudo food-web-admin sheet 001207 001208 001209`（生成在 `/opt/food-web/data/links/`，用完删除） |
| 停用某人的链接（手机丢失等） | `sudo food-web-admin revoke 001207` |
| 查看参与者、已登录设备数、记录数 | `sudo food-web-admin list` |
| 导出数据 | `sudo food-web-admin export --out /tmp/food-export` |
| 与小程序数据合并导出 | `sudo food-web-admin export --out /tmp/food-export --merge 小程序导出的meal_records.json` |
| 手动备份 | `sudo food-web-admin backup` |
| 看日志 / 重启 | `journalctl -u food-web -f` / `sudo systemctl restart food-web` |
| 换调研员口令或 API Key | 改 `/etc/food-web.env` 后 `sudo systemctl restart food-web` |

**导出与分析**：`export` 生成的 `meal_records.json` 是与云数据库导出完全相同的文档数组，下载到电脑后照旧 `npm run export:data -- --input meal_records.json` 转 CSV。网页版记录 ID 与小程序不会重复，`--merge` 可把两边合成一份；同一份数据不要合并两次（重复 ID 会报错）。`questionnaire_responses.json` 同理。

**备份**：每天自动把数据库（`VACUUM INTO`，保留 14 份）和新增照片复制到 `/var/backups/food-web`。这仍在同一台服务器上，建议每周把该目录下载到电脑或开启云服务商的快照。

## 代码位置与改动须知

- `web/plugins/wxml.mjs`：WXML → Vue。只实现了本项目用到的标签（view/text/image/button/input/slider/picker[date]/block/template/import）；页面里新加别的组件，构建会直接报错并指出位置，到这里补实现。
- `web/plugins/miniprogram.mjs`：按 `app.json` 汇总页面；WXSS 的 rpx 换算、`100vh` 扣除导航栏、页面样式作用域（`:where()` 零权重，层叠关系与小程序一致）；`OVERRIDES` 列出被换掉的模块；`WEB_TEXT` 是网页专用文案。
- `web/src/runtime/`：`page.ts`（Page 实例与 setData）、`router.ts`（页面栈 ↔ 浏览器历史，返回键可用）、`wx.ts`（wx.* 实现）、`ui.ts`（提示框/对话框/大图）、`image.ts`（选图压缩）、`app.ts`（导航栏、下拉刷新、长按、hover-class）。
- `web/src/overrides/`：`config.ts`、`mealService.http.ts`（替代 `mealService.cloud.ts`，导出同名函数）、`userProfile.ts`（参与者身份时编号固定）。
- `server/src/`：`app.ts` 路由、`auth.ts` 登录与权限、`meals.ts` 识别记录、`vision.ts` 识别队列、`questionnaire.ts` 问卷、`db.ts` SQLite、`admin.ts` 管理命令。
- **改页面**照旧改 `miniprogram/pages/`，小程序和网页同时生效；**改数据访问**时 `mealService.cloud.ts`、`mealService.mock.ts`、`web/src/overrides/mealService.http.ts` 与 `server/src/meals.ts` 要一起改。
- `web/dist/`、`server/dist/` 内含《中国食物成分表》数据，`web-data/` 含参与者照片与记录，均已在 `.gitignore`，不得提交到公开仓库。
