# 更新日志

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.6] - 2026-08-22

### 新增

- Schema 2：需求成为一等实体，版本落盘只保存需求编号，Hub 返回完整对象保持兼容。
- 自动迁移、元数据备份、冲突报告和回滚；已有 HEAD 的脏仓库拒绝迁移。
- 需求列表与详情、跨项目版本演进、派生状态和可重建反向索引。
- 迭代文件与视图，显式固定需求、项目和版本，并提示草稿、废弃及基线漂移。
- 需求/迭代静态交付包，包含离线原型、规格、附件、索引和清单。
- 跨对象搜索面板、结构化筛选和团队已存视图。
- 新增 `req`、`milestone`、`export` CLI 命令组。

### 验证

- Schema 迁移、需求索引、迭代、导出、筛选和 HTTP API 定向测试通过。
- 需求、迭代、搜索页面完成桌面与移动浏览器验收。

## [0.3.6] - 2026-08-22

### 新增

- 原型预览支持框选区域反馈，自动携带项目、版本、基线、需求、变更和区域深链。
- 反馈可生成 Markdown，或通过 GitHub、GitLab、Gitee Provider 创建 Issue；远端失败时保留本机草稿并自动降级。
- Issue Token 支持 macOS 钥匙串和环境变量，不写入仓库配置。
- 新建版本支持拖拽文件、粘贴完整 HTML、公开 URL 三种导入方式，并自动读取 `<title>`。
- URL 导入增加协议、凭据、DNS、IP、重定向、响应类型、时长和大小检查，阻断 SSRF。
- `flowlark watch` 增加内容哈希去重、稳定写入检查和草稿箱；失败项保留原因并可重试。
- 新增 `flowlark feedback list/export/submit/rm` 和工作台草稿箱页面。

### 验证

- 208 项 Node 测试通过，Web 生产构建通过。
- 浏览器验证覆盖桌面/移动工作台、三种导入入口、区域标注和 Markdown 降级，控制台无错误。

## [1.1.0] - 2026-08-22

### 新增

- **Git 助手**。产品不再让用户去终端敲 git。新增 `flowlark git` 命令组：不带参数做体检，看当前处境并给出下一件该做的事；`setup` 一步完成初始化、提交身份和首次提交；`whoami` 管身份；`resolved` / `continue` / `abort` 处理中断的同步。工作台 Git 面板是同一套能力的按钮版本。
- **AI 助理交接**。`flowlark git brief` 与面板上的「复制给 AI 助理」，把仓库处境和几条「不知道就一定会做错」的约定整理成一段可粘贴的说明。不接 AI、不需要 API key，交出去的是描述而非数据 —— 只有路径、状态和规则，不含原型内容。
- 提交说明建议：`/api/git/suggest-message` 从待提交文件反推一条中文说明，界面上的「帮我写一条」。

### 修复

- **rebase 期间基线冲突的两边标反了。** Git 在 rebase 时 `ours` / `theirs` 与直觉相反（HEAD 侧是别人的），界面照搬导致用户会稳定地选错基线。现在读冲突时就翻译成「你这边」「对方」。
- **解决完冲突无法继续。** 解决动作本身会往 oplog 追加记录，工作区因此变脏，git 拒绝 `rebase --continue`，还回一句指向 `git add` 的提示。现在继续之前先收拢自有路径。
- **继续失败时错误信息是空的。** git 这类提示走 stdout 而非 stderr，只读 stderr 得到空字符串。
- **`git status` 把未跟踪目录折叠成一行**，新建项目时「改了哪些版本」无从判断；且 Flowlark 自己的内部文件被误标进「请不要提交」清单。现在用 `-uall` 逐个列出，归属按 owned paths 判断。
- **版本号按点截断**，`v1.0` 在改动摘要里显示成 `v1`。

### 变更

- **品牌标记落地。** 头部的蓝底白字「F」方块换成 glide 标记 —— 一只滑翔的云雀，下面两道是它掠过的气流，对应 slogan「Where prototypes flow」。UI 主色由 `#1677ff` 蓝改为 `#0E9384` 青绿，取自标记渐变的中段（两端 `#0B5F55` / `#2ED3B7` 直接做 UI 主色都不合适：深端在小字上发闷，亮端在白底上对比度不到 4.5:1）。新增 `assets/brand/`、`BrandMark.vue`、favicon 与应用图标；颜色集中在 `web/src/brand.js`，同时供给 Ant Design 主题 token 和手写 CSS。
- **工作台预览视窗塌陷。** `a-spin` 会插入一层没有 `height:100%` 的容器，高度链断掉，iframe 塌成默认高度；同时预览区没有 `flex-shrink:0`，窗口变窄时被右侧文档区挤到与其等宽。现在 loading 改为绝对定位覆盖层，预览区宽度由分栏比例显式决定。
- 预览区新增「全宽」切换、分隔条双击复位，拖动上限放宽到 88%；窄屏（<900px）自动改为上下堆叠。
- 所有文档与命令提示中的裸 git 指令替换为产品级动作。

## [1.0.1] - 2026-08-22

### 变更

- **产品更名为 Flowlark**，Slogan：*Where prototypes flow*
  - npm 包名、CLI 命令改为 `flowlark`（短别名 `fl`）
  - 仓库配置文件 `protohub.json` → `flowlark.json`，内部目录 `.protohub/` → `.flowlark/`
  - 环境变量 `PROTOHUB_*` → `FLOWLARK_*`

### 兼容

- 打开更名前的仓库时**自动改名并提示**，数据一字不改地搬过去。
  只做文件改名，不碰 Git —— 改完处于「有未提交改动」状态，用户 review 后自己提交。
- 新旧名并存时保留新的，老文件原地留着交给用户处置，不静默覆盖。
- 老的 `PROTOHUB_REPO` / `PROTOHUB_USER` / `PROTOHUB_DEBUG` 环境变量仍然生效。

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
- `sync` 卷走用户放在旁边的草稿 → 只暂存 Flowlark 自有路径
- 端口 `0`（内核分配）被 `||` 判成假值 → 改用 `??` 并回填实际端口
- `--lan` 临时开启时 `/api/health` 读的是配置文件，导致局域网访客看到可写界面 → 改为反映实际运行状态

[1.0.0]: https://github.com/OWNER/flowlark/releases/tag/v1.0.0
