# Flowlark

本地原型版本库。**CLI 管数据，浏览器看原型，数据是纯文本文件，直接进 Git。**

给需要在一堆 HTML 原型迭代里说清楚「现在到底按哪一版开发」的产品经理和研发。

## 最快的开始方式

```bash
./start.sh
```

macOS 上也可以直接**双击 `启动.command`**。

脚本做四件事：检查 Node 环境 → 构建浏览器工作台 → 首次运行时初始化仓库并生成一个可点的示例项目 → 起服务并打开浏览器。

```bash
./start.sh ~/我的原型         # 指定数据仓库位置（默认 ~/flowlark-repo）
./start.sh --port 8000       # 换端口，预览端口自动用 8001
./start.sh --no-open         # 只起服务不开浏览器
REBUILD=1 ./start.sh         # 强制重建工作台
```

装成全局命令后可以在任意目录用：

```bash
cd flowlark && npm link      # 之后 Flowlark 命令随处可用

cd ~/我的原型
flowlark init
flowlark new "订单中心重构" --code order-center
flowlark add ./订单中心_v1.0.html -t "首版原型"
flowlark baseline order-center v1.0
flowlark open
```

---

## 为什么是这个形态

三个决定，每个都排除了一类复杂度：

**CLI 而不是上传按钮。** 原型就在你的文件系统里，`flowlark add 文件.html -m "修改:筛选区:压缩为一行"` 一条命令归档完事，比打开浏览器拖拽快得多。CLI 也能进脚本、进 Makefile、进 CI。

**本地服务而不是内网服务器。** 没有部署、没有运维、没有账号系统、没有 CORS、没有防火墙工单。`flowlark serve` 起在 localhost，关掉就没了，数据一直在你的目录里。

**Git 而不是数据库。** 团队协作直接复用 Git：谁改的、什么时候改的、为什么改，`git log` 全都有；分享就是 `git push`。代价是数据必须是可 diff、可 merge 的纯文本——这个约束反过来让存储设计变得干净，见 [docs/STORAGE.md](docs/STORAGE.md)。

---

## 磁盘上长什么样

```
我的原型/                          ← 你自己 git init 的目录
├── flowlark.json                 仓库配置
├── .gitattributes                HTML 标为 binary；oplog 用 union 合并
├── projects/
│   └── order-center/
│       ├── project.json
│       ├── BASELINE              ← 一行文本：v1.2
│       └── versions/
│           ├── v1.2.json         元数据 + 变更日志 + 关联需求
│           ├── v1.2.html         原型文件
│           └── v1.2.spec.md      规格书
└── .flowlark/
    ├── oplog.ndjson              操作日志
    └── trash/                    删除的版本
```

**`BASELINE` 是一个文件，不是一个字段** —— 这是整个设计里收益最大的一处。「同一项目同时只有一个基线」不再靠应用层在事务里维护，而是文件结构本身保证的：文件只有一行，物理上不可能有第二个。切基线是一次原子写入，不需要事务；Git 冲突时冲突点就是那一行，一眼能解。

---

## 常用命令

```bash
# 日常
flowlark add <文件.html> [-n 版本号] -t "标题" [-m "类型:位置:说明[:需求号]"]... [--tag 已评审]
flowlark ls [项目]                   # 版本时间线，带「新」标记与标签
flowlark show <项目> <版本>           # 版本详情
flowlark baseline <项目> <版本>       # 设为当前基线
flowlark rollback <项目>             # 回滚到上一个基线
flowlark spec <项目> <版本> --edit    # 用 $EDITOR 写规格书
flowlark diff [项目]                 # 累计变更 + 反复修改热点

# 检索与组织
flowlark search <关键词>             # 全库搜索
flowlark read <项目> <版本>           # 标记「我看到这一版了」
flowlark tag <项目> <版本> 已评审      # 版本标签
flowlark attach <项目> <版本> <文件>  # 挂 PRD / 设计稿 / 评审纪要
flowlark offline <项目> <版本>        # 生成自包含的离线版
flowlark compare <项目> <v1> <v2>    # 浏览器里并排对比

# 系统
flowlark config                     # 查看 / 修改全部配置
flowlark lan on                     # 开放局域网，同事可访问
flowlark remote <地址>               # 配置 Git 远端

# Git
flowlark sync                       # 提交 + 拉取 + 推送
flowlark history <项目> <版本>        # 这一版都谁改过
flowlark blame <项目>                # 基线变迁史
flowlark resolve                    # 冲突辅助解决

# 运行
flowlark status / watch / serve / open
```

变更类型中英文都认：`新增/修改/删除` 或 `ADD/MODIFY/REMOVE`。
仓库里只有一个项目时 `-p` 可省略；版本号能从文件名推断（`订单中心_v1.4.html` → `v1.4`）。
所有查询命令支持 `--json`，方便接脚本。

---

## 四个核心能力

### 1. `diff` — 变更日志的杠杆

变更日志是手写的（不做截图 diff、不做源码 diff——那两个成本高且没人看）。手写方案唯一的短板是研发跳版本开发时要逐版翻，`diff` 就是补这个：

```
$ flowlark diff order-center --from v1.0 --to v1.2
v1.0 → v1.2  跨 2 个版本，共 5 条变更

新增 2 条
  [订单列表-表格] 表头支持排序  v1.2
  [订单列表-工具栏] 新增批量关闭按钮 REQ-0275  v1.1

修改 3 条
  [订单列表-筛选区] 筛选条件切页后保留  v1.2
  ...

反复修改的区域  建议重点确认
  🔥 订单列表-筛选区 — 改了 3 次
```

热点统计是手写日志唯一能产出的洞察，成本只有一个 groupBy，但它直接指出了返工重灾区。

**不带参数时，起点取你上次标记已读的那一版** —— 这才是「我不在的这几天改了什么」的正确答案。

### 2. `read` — 已读标记

```bash
flowlark read order-center v1.2   # 我看到这一版了
flowlark ls order-center          # 之后的版本会被打上「新」
flowlark diff order-center        # 只看这之后的变更
flowlark status                   # 一屏看完哪些项目有你没看过的新版本
```

已读状态存在 `.flowlark/cache/` 下，**不进 Git** —— 它是每个人自己的，提交上去会变成「张三把李四标成已读」这种荒唐冲突。

### 3. Git 集成 — 把 Git 翻译成产品语言

数据进了 Git 之后，很多本来要自己造的东西 Git 已经有了。这些命令做的是翻译：用户问的是「v1.2 的规格书上周是什么样」，不该让他去想 `git show HEAD~5:path`。

```bash
$ flowlark blame order-center
基线    切换时间  操作人  提交     说明
● v1.2  2 小时前  张小雨  3d5aaed  B 切 v1.2
· v1.1  昨天      李哲    89169ff  A 切 v1.1
· v1.0  上周      张小雨  d395fe4  初始提交

$ flowlark spec order-center v1.2 --history   # 规格书改过几次
$ flowlark spec order-center v1.2 --at 0278f7d  # 回看当时的内容
```

`sync` 的顺序是**提交 → 拉取(rebase) → 推送**，不是先拉后提交：先提交能保证 rebase 时冲突落在自己的提交上，语义清楚；反过来做，未提交的改动会在 rebase 时被 stash 来 stash 去，出问题很难解释。

**冲突辅助解决**利用了基线是单行文件这个性质：

```
$ flowlark resolve
▎基线冲突  projects/order-center/BASELINE
  两边各自把 order-center 的基线指向了不同版本：
    v1.2   （你这边）
    v1.1   （对方那边）
  选一个保留：
    flowlark resolve order-center v1.2
    flowlark resolve order-center v1.1
```

用户不需要理解 Git 的冲突标记，直接回答「保留哪个」就行。

### 4. 局域网分享 — 读开放，写留本机

```bash
flowlark lan on     # 开放给同网段
flowlark serve      # 起服务，会打印同事该访问的地址
```

安全模型是**读开放给局域网，写只留给本机**。

这个产品原本没有账号体系——本地单机工具，无所谓。一旦开到局域网，「没有鉴权」立刻从无所谓变成同网段任何人都能删版本、改基线。加账号体系是另一个量级的复杂度，而真实需求其实只是「让研发能打开看」，所以按请求来源区分读写：成本最低，而且没有密码可泄漏。

局域网用户看到的界面会显式标「只读」，写操作按钮直接隐藏——让人点了才收到 403 是很差的体验。真要多人可写就 `flowlark config server.readonlyFromLan false`，设置页会用红字说明后果。

### 5. 附件 — PRD、设计稿、评审纪要

```bash
flowlark attach order-center v1.2 ./需求文档.pdf ./评审纪要.md
```

存在 `projects/<项目>/versions/<版本>.files/`，**随 Git 一起提交**，因为它们是真实交付物。

附件和规格书一样**不受基线锁定**——事后补一份评审纪要是常态，锁死会逼产品为了加个附件去发一个假版本。

### 6. 系统配置

```bash
flowlark config                              # 分组列出全部
flowlark config server.maxFileBytes 50MB     # 改
flowlark config rules.requireChangelog       # 看单项详情与风险说明
```

17 个配置项分四组：服务与网络、Git 与身份、业务规则、外观与默认值。**schema 是单一来源**——CLI 列表、网页设置表单、校验规则都从同一份定义生成，加一项配置只改一处，三边自动跟上。

R4 基线锁定和 R6 变更日志必填都可以关掉，但它们在界面上标为「高风险」，关闭前会弹窗说明后果。默认都是开的。

### 7. `offline` — 断网也能看

AI 生成的原型几乎都引 CDN。断网、上高铁、代理拦截时会掉样式，而用户的第一反应永远是「这工具坏了」。

```bash
flowlark offline order-center v1.2
```

抓取所有外链内联成一个自包含 HTML。**不修改原型文件本身** —— 原型是需求追溯的证据，R4 说它确认后不可变。离线版是派生产物，存在 `.flowlark/cache/` 下，随时可重新生成，也不进 Git。正因如此，基线版本也能生成离线版而不违反不可变性。工作台里勾选「离线预览」即可切换。

---

## 业务规则

规则在 `src/core/rules.js` 里集中定义，CLI 和 HTTP API 都从这一处取——不存在两套实现漂移的可能。

| 编号 | 规则 |
|---|---|
| R1 | 展示状态（编辑中/基线/历史/废弃）是**派生**的，不落库。落库的只有 `status` 和 `baselineAt` |
| R2 | 同项目同时只有一个基线，由 `BASELINE` 文件结构性保证 |
| R3 | 基线可回滚，用于新版评审没过时止血 |
| R4 | 基线的原型文件与变更日志锁定；**规格书、标签、附件不受限制** |
| R5 | 版本号同项目内唯一，字符集受限（它同时是文件名） |
| R6 | 设为基线前变更日志非空。豁免：项目首版；曾当过基线的版本 |
| R7 | 删除是把文件移进 `.flowlark/trash/`，可恢复 |

**R4 的取舍**：原型是需求追溯的证据，锁定才有证据效力；但规格书是活文档，锁死会逼产品为了补一句说明去发一个假版本。标签同理 —— 它是事后追加的组织信息（「已评审」「已交付」），和「这一版长什么样」这个事实无关，锁它没有道理。

**R6 的第二条豁免**是上一轮实现跑测试时发现的：首版靠豁免成为基线时没有变更日志，等它被顶替成历史版本后想回滚就会被 R6 卡住——而回滚正是止血动作。R6 该约束的是「向前推进」，不是「往回退」。

---

## 沙箱隔离

原型是用户自己扔进来的任意 HTML，里面可以有任意脚本。所以：

- 工作台在 `:7788`，**原型预览在 `:7789`**，端口不同即不同源
- iframe 给 `sandbox="allow-scripts ..."` 但**不给** `allow-same-origin`
- 端口守卫双向封锁：预览端口只放行 `/p/**`，主端口拒绝 `/p/**`

结果是原型可以随便跑 JS，但读不到工作台的 localStorage、发不出带凭据的请求。主端口拒绝 `/p/` 这条容易被忽略——少了它，原型可以被同源加载，隔离就白做了。

---

## 开发

```bash
git clone <repo> && cd flowlark
npm run build:web        # 构建浏览器工作台（web/dist）
npm test                 # 跑全部测试
node bin/flowlark.js --help
```

**运行时零依赖。** CLI 与本地服务只用 Node 内置模块（`node:http`、`node:util` 的 parseArgs、`node:fs`）。本地工具装起来该是一秒的事，不该为了几十行路由拖进一棵依赖树。浏览器工作台的 Vue / Ant Design Vue 只是构建期依赖，产物是静态文件。

```
start.sh          一键启动（检查环境 / 构建 / 初始化 / 起服务）
启动.command       macOS 双击入口
bin/              CLI 入口
src/core/         ← CLI 与 HTTP 的唯一事实来源
  store.js        文件读写
  rules.js        R1–R7
  service.js      业务门面
  git.js          Git 集成
  search.js       全局搜索
  readstate.js    已读标记
  offline.js      离线版本生成
src/cli/          命令行（commands / cmd-git / cmd-find）
src/server/       本地 HTTP 服务 + 沙箱预览
web/              Vue 3 工作台
test/             八组测试，全部跑真实进程 / 真实 git / 真实 HTTP
docs/STORAGE.md   存储设计与 Git 冲突面分析
docs/ROADMAP.md   产品升级路线图
docs/V2-BLUEPRINT.md  v2.0 蓝图：需求驱动的全链路
```

### 浏览器工作台

与 CLI 能力对等，并把每个操作对应的命令摆在旁边（点一下就能复制）—— CLI 是主入口，网页顺带教会用户用它。

- `⌘K` 全局搜索面板，支持字段筛选、上下键选择
- 并排双版本对比，上方叠加变更清单
- 顶部 Git 徽标：冲突红、未提交黄；点开是提交/同步/冲突辅助面板
- 「离线预览」开关，一键生成并切换
- 版本演进历史抽屉、规格书历史回溯

---

## 验证情况

全部在真实环境执行，无 mock：

| 测试组 | 内容 | 结果 |
|---|---|---|
| `rules.test.js` | R1–R7 状态机、累计变更、外链检测、输入校验 | ✅ 30 项 |
| `cli.test.js` | 真实 spawn CLI 进程，验证参数解析、退出码、输出格式 | ✅ 15 项 |
| `server.test.js` | 真起 HTTP 服务，验证 API、沙箱隔离、升级后的新路由 | ✅ 18 项 |
| `git.test.js` | 真跑 git init/commit/merge，验证 diff 与冲突面 | ✅ 5 项 |
| `gitint.test.js` | 真实 git：状态解析、sync、历史追溯、冲突辅助解决 | ✅ 12 项 |
| `search.test.js` | 搜索排序与字段、标签、已读标记 | ✅ 21 项 |
| `offline.test.js` | 起本地 HTTP 扮演 CDN，真跑抓取 / 内联 / 失败降级 | ✅ 8 项 |
| `watch.test.js` | 真实子进程 + 文件系统事件，验证自动归档与防抖 | ✅ 5 项 |
| `admin.test.js` | 配置校验、局域网放行矩阵、附件读写、远端推送到真实裸仓库 | ✅ 37 项 |
| | **合计** | **✅ 166/166** |

浏览器工作台 `vite build` 通过（3198 模块）。CLI → 服务 → 浏览器 → 磁盘的完整链路做过端到端实跑，包括制造一次真实 Git 冲突并用 `flowlark resolve` 解决。

### 测试里抓到的真实问题

按发现顺序：

1. **操作日志会在 Git 合并时冲突。** 「两个人各加一个版本应该无冲突」这条承诺，在真跑 `git merge` 时被 `oplog.ndjson` 打破了——两边各追加几行，Git 判定为冲突。修复是给 `.gitattributes` 加 `merge=union`。这个问题只有真的跑一次 merge 才会暴露。

2. **变更日志里写的需求号搜不到。** 用户用 `-m "…:REQ-0275"` 把需求号写进变更日志，自然会期待 `search REQ-0275` 找得到，但搜索只扫了 `content` 和 `location`。

3. **`read` 和 `diff` 的口径自相矛盾。** `read` 说「新增了 1 个版本」，`diff` 却说「0 条变更」——因为 `sinceLastRead` 把终点取成了基线，而新增的版本还是草稿状态。终点应该取时间线上最新的一版。

4. **分支名被解析成 `No`。** `git status --porcelain` 在仓库尚无提交时输出 `## No commits yet on master`，正则直接截了第一个词。四种 porcelain 分支行形态现在都有覆盖。

5. **搜索片段的高亮位置偏移。** 片段里把 `\n+` 折叠成一个空格，改变了字符串长度，`matchStart` 随即失准，高亮框到了旁边的字上。换行必须 1:1 替换。

6. **`history` 的排序不稳定。** 分别查三个文件的 git log 再按时间排，同一秒内的提交时间戳相同，合并后顺序会飘。改成一次 `git log` 传多个 pathspec，由 git 自己保证拓扑序；测试里拿 `git log` 的全局顺序做交叉验证。

7. **Git 把中文文件名转义成八进制。** 端到端跑推送时发现远端的附件列成了 `"\351\234\200..."`。`git status`、`git log --name-only` 在中文项目里全是乱码，而这个产品的项目名、附件名几乎都是中文。现在会自动设 `core.quotepath=false`——但只在用户没显式设过时才写，不覆盖别人的偏好。

8. **`sync` 会卷走用户放在旁边的文件。** 端到端跑完发现提交里混进了 `我正在改的原型.html`——`git add -A` 的必然结果。`flowlark sync` 的契约应该是「同步 Flowlark 的数据」，不是「提交这个文件夹里的一切」。现在只暂存 `projects/`、`flowlark.json` 等自有路径，跳过的文件会在输出里列出来。顺带修正了「工作区干净」的判断：旁边有草稿不该让同步按钮一直亮着。

### Git diff 实测

改一条变更日志：

```diff
+    },
+    {
+      "type": "ADD",
+      "location": "订单详情-右侧",
+      "content": "新增物流轨迹时间线",
+      "requirement": "REQ-0301"
     }
```

切换基线：

```diff
--- a/projects/order-center/BASELINE
+++ b/projects/order-center/BASELINE
@@ -1 +1 @@
-v1.0
+v1.2
```

原型 HTML：`Bin 181 -> 4093 bytes`，不逐行 diff。

---

## 角色模型

产品经理写，研发和测试读。在「本地 + Git」的形态下，**角色就是 Git 仓库权限的投影**：

| 角色 | Git 权限 | 在 Flowlark 里 |
|---|---|---|
| 产品经理 | write | `flowlark sync` 能推送 |
| 研发 / 测试 | read | 能 clone、能 pull，推不上去 |

好处是权限设施已经存在——GitHub/GitLab 的 collaborator 权限、公司的 LDAP 集成、离职时的权限回收，都不用重做一遍。

当前版本还是用「地点」近似角色（局域网只读、本机可写），把 Git 权限如实反映到界面上是下一步的第一优先级，见 [docs/ROADMAP.md](docs/ROADMAP.md)。

---

## 不做

截图 diff / 源码 diff · 自建账号体系 · 多人实时协同 · 需求池 API 对接 · 云端托管 · 桌面客户端

需求池只存编号 + URL 做跳转，标题是录入时的快照，不与外部系统同步。

## 已知限制

- **版本号字符集受限**（`[A-Za-z0-9._+-]`，≤32 字符），因为它同时是磁盘文件名。这是文件存储换来 diff 可读、冲突可解的代价。
- **无文件锁**。同一个仓库同时跑两个 `flowlark serve` 并发写同一版本，后写的赢。本地单人场景不构成问题，多人靠 Git 而不是靠并发控制。
- **并排对比无法同步页面内滚动**。原型跑在跨源 iframe 里（这正是沙箱隔离的目的），读不到它内部的滚动位置。真正的像素级同步需要往原型里注入脚本，会破坏隔离，不做。
- **离线版不递归抓取 CSS 里的字体**。`@font-face` 失效只是字体回退，不影响布局；递归抓取会让复杂度和失败面都放大。
- **搜索是暴力扫描**，不建索引。几百个版本仍是毫秒级；引索引会带来「什么时候重建」这个新问题，不值得。
- **工作台主 chunk 约 1.5MB**（Ant Design 未做按需加载）。本地加载无感，在意可引 `unplugin-vue-components`。
- **局域网只读靠来源 IP 判定**，不是账号鉴权。同一台机器上的其他用户、以及能伪造回环来源的攻击者不在防护范围内。这是「内网协作工具」这个定位下的合理取舍；真需要账号体系的场景，这个产品本来就不合适。
- **附件没有大小之外的类型限制**。任何文件都能挂上去，包括可执行文件。仓库是团队自己的，这个信任前提和 Git 仓库本身一致。
