# 更新日志

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-08-21

首个完整版本。

### 核心

- **文件即数据库**：项目/版本以稳定序列化的 JSON + 独立 HTML/Markdown 存储，直接进 Git
- **BASELINE 是文件不是字段**：「同项目只有一个基线」由文件结构保证，切换是原子写入，无需事务
- 版本状态机 R1–R7：状态派生、单基线、可回滚、基线锁定、版本号唯一、变更日志必填、逻辑删除
- 沙箱隔离：原型由独立端口提供，iframe 不给 `allow-same-origin`，端口守卫双向封锁

### CLI（33 个命令）

- 日常：`add` `ls` `show` `baseline` `rollback` `change` `spec` `diff`
- 检索组织：`search` `read` `tag` `attach` `offline` `compare`
- Git：`sync` `history` `blame` `resolve`
- 系统：`config` `lan` `remote`
- 运行：`serve` `open` `watch` `status`

### 浏览器工作台

- 左原型右文档的分屏工作台，可拖拽调整比例
- `⌘K` 全局搜索、并排双版本对比、Git 面板、设置页
- 每个操作旁边显示等价的 CLI 命令，可一键复制

### 协作

- 局域网分享：读开放给同网段，写仅限本机
- 版本附件：PRD、设计稿、评审纪要随 Git 提交
- Git 远端配置与一键同步，首次推送自动建立上游

### 实现过程中修复的问题

这些都是跑起来才暴露的，记在这里以免重复踩：

- 操作日志在 Git 合并时冲突 → `.gitattributes` 加 `merge=union`
- 变更日志里写的需求号搜不到 → 搜索索引补上 `requirement` 字段
- `read` 说「新增 1 版」而 `diff` 说「0 条变更」→ `sinceLastRead` 终点改取时间线最新版而非基线
- `git status --porcelain` 在无提交时把分支名解析成 `No` → 覆盖四种分支行形态
- 搜索片段高亮位置偏移 → 换行替换必须长度守恒
- `history` 排序不稳定 → 改为单次 `git log` 传多 pathspec，由 git 保证拓扑序
- Git 把中文文件名转义成八进制 → 自动设 `core.quotepath=false`（不覆盖用户已有偏好）
- `sync` 卷走用户放在旁边的草稿 → 只暂存 protohub 自有路径
- 端口 `0`（内核分配）被 `||` 判成假值 → 改用 `??` 并回填实际端口
- `--lan` 临时开启时 `/api/health` 读的是配置文件，导致局域网访客看到可写界面 → 改为反映实际运行状态

[1.0.0]: https://github.com/OWNER/protohub/releases/tag/v1.0.0
