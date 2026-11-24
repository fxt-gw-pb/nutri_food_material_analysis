# 项目协作偏好

- 用户已于 2026-10-02 指定：本项目可以持续使用 Codex 内置浏览器查看微信云后台。后续查询云端数据时优先使用内置浏览器，复用已有后台标签页和登录状态。
- 登录需要用户扫码时，打开登录界面交由用户完成，再继续查询。遵守浏览器站点安全限制。
- 已验证的后台入口：`https://tcb.cloud.tencent.com/dev?envId=cloud1-d8gfgeids7d390dbc#/db/doc/collection/flexdb/tnt-a8vu66zq4/meal_records`。
- 生产环境为 `cloud1-d8gfgeids7d390dbc`；识别记录集合为 `meal_records`。统计每日新增时按 `createdAt` 毫秒时间戳及 UTC+08:00 的自然日计算，每个文档算一条记录；饭后评估更新不算新增。区分全部新增记录与 `status=completed` 的有效识别记录。
