# 故障恢复

## 服务打不开

- 运行 `flowlark git doctor` 检查仓库、Git 和身份。
- 端口占用时使用 `flowlark serve --port <新端口>`。
- 原型与工作台必须使用不同端口，否则沙箱隔离失效。

## Schema 迁移失败

- 已有 Git 历史的仓库必须先提交或清理 Flowlark 路径改动。
- 迁移备份位于 `.flowlark/backup/schema-1-<时间>/`。
- 不要手工混合 Schema 1 需求对象和 Schema 2 编号数组。

## Issue 或通知失败

- 在设置/交付页使用“测试连接”。
- Token、Webhook 只进入 macOS 钥匙串；钥匙串不可用时使用环境变量。
- Issue 失败可导出 Markdown；通知失败进入交付页重试队列。

## 镜像停止同步

- 查看 `flowlark mirror status`。
- 脏工作区先人工处理；非快进和冲突不得在镜像上自动解决。

## 更新失败

- 检查清单 URL 是否 HTTPS、版本号是否为三段式、SHA-256 是否为 64 位小写十六进制。
- 校验失败的临时文件会被删除，当前应用不会被覆盖。
