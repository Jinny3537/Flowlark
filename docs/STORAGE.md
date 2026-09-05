# 存储设计：文件即数据库

## 为什么不能继续用 SQLite

数据目录要进 Git，SQLite 就出局了：它是二进制，`git diff` 看不见任何东西，两个人各加一个版本必然产生无法自动合并的冲突，而冲突长什么样、怎么解，谁也说不清。

换成文件布局后，Git 从「存储介质」变成了「协作机制」——谁改了什么、什么时候改的、为什么改，这些本来要靠操作日志表去记的东西，Git 本身就记了。

## 目录布局

```
my-prototypes/                    ← flowlark git setup 纳入 Git 的目录
├── flowlark.json                 仓库配置（schemaVersion: 5 / 仓库名 / 设置）
├── .gitattributes                原型 HTML 标记为二进制，避免污染 diff
├── projects/
│   └── order-center/             ← 项目 slug，即目录名
│       ├── project.json          项目元数据（含生效中的 project.sync 策略）
│       ├── BASELINE              ← 单行文本：当前基线的版本号
│       └── versions/
│           ├── v1.0.json         版本元数据（含变更日志、关联需求）
│           ├── v1.0.html         原型文件
│           ├── v1.0.spec.md      规格书（独立文件，方便直接编辑与 diff）
│           ├── v1.1.json
│           ├── v1.1.html
│           └── v1.1.spec.md
├── requirements/
│   └── REQ-27/
│       ├── requirement.json      需求生命周期与受控外部任务绑定
│       └── spec.md               需求规格与验收边界
├── milestones/                  迭代范围、生命周期与外部 Sprint 绑定
├── snapshots/                   不可变交付快照
├── acceptances/                 每个正式交付快照的验收结论与反馈
└── .flowlark/
    ├── oplog.ndjson              操作日志，append-only
    ├── sync-audit.ndjson         同步审计，追加写入、递归脱敏并进入 Git
    ├── cache/                    本机运行缓存，不进入 Git
    │   └── sync-queue/           可恢复的同步预览与执行状态
    ├── backup/                   Schema 迁移恢复数据，不进入 Git
    └── trash/                    逻辑删除的版本移动到这里
```

## Schema 5 验收数据

项目增加 `acceptance.roles` 和 `acceptance.rule`，默认产品、研发、测试全部必选，当前通过规则为 `all-required`。同一角色的最新记录参与聚合；必选拒绝、未关闭的条件或未解决的阻断反馈会阻止通过。

正式交付快照 `kind: delivery` 通过完整 Git 提交 ID 固化范围、版本规格、需求规格和验收规则。原型和附件保存提交中的实际字节（Base64）及 SHA-256，因此后续工作区改动不会改变历史材料。快照发布采用排他创建，重复同一发版返回原快照，内容不匹配则拒绝读取。

每条验收结论追加到 `acceptances/<snapshot>/<uuid>.json`，绑定 `snapshotHash`，由服务端生成操作者、时间和 ID。反馈创建记录位于 `feedback/<uuid>.json`，解决记录位于 `feedback-resolutions/<uuid>.json`；解决操作保留原反馈字节。当前 API 没有验收历史的更新和删除入口。

Schema 4→5 为旧项目补规则，为里程碑补 `deliveries`，把未分类旧快照标记为 `legacy`。旧快照不能作为正式验收依据。迁移保留正式快照和材料字节，验证引用并拒绝符号链接；失败恢复到迁移链开始前的状态。

正式发版续跑与生命周期收尾仍在接入该数据层；以下 Schema 3/4 章节保留其引入版本背景。

## Schema 3 保存项目同步策略

Schema 3 在每个 `projects/<项目>/project.json` 中增加 `project.sync`：

```json
{
  "sync": {
    "mode": "manual",
    "server": "",
    "projectId": "",
    "managedFields": [
      "title",
      "description",
      "acceptance",
      "priority",
      "assignee",
      "sprint",
      "status",
      "delivery"
    ]
  }
}
```

- `mode` 只接受 `manual` 或 `trusted-auto`，缺省时为 `manual`。`v0.7.3` 只允许 `manual` 执行；`trusted-auto` 仍是保留配置，不能触发无人值守的远端写入。
- `server` 是逻辑 MCP 服务标识，`projectId` 是外部项目标识。密码、Token、可执行文件路径和个人运行配置不放进 `project.sync`。
- `managedFields` 只保存 Flowlark 允许管理的字段：`title`、`description`、`acceptance`、`priority`、`assignee`、`sprint`、`status` 和 `delivery`。

生成迭代同步计划时，迭代范围内的所有项目必须解析到相同的 `server`、`projectId` 和 `managedFields`。项目配置决定实际连接的 stdio 服务和平台项目；MCP 迭代能力只提供工具名及枚举映射，浏览器不能覆盖这些值。

## Schema 4 保存权威需求生命周期

Schema 4 在 `requirements/<编号>/requirement.json` 中保存权威生命周期：

```json
{
  "status": "draft",
  "statusChangedAt": "2026-09-04T08:00:00.000Z",
  "statusChangedBy": "migration:schema4",
  "statusReason": "legacy-derived:not_started",
  "externalTasks": []
}
```

生命周期值包括 `draft`、`confirmed`、`developing`、`pending-acceptance`、`completed` 和 `archived`。`v0.7.3` 只开放用户执行 `draft → confirmed`，以及经过远端验证的 Sprint 启动执行 `confirmed → developing`。`pending-acceptance`、`completed` 和 `archived` 是后续验收闭环的保留状态，本版没有用户入口。

需求规格独立保存在 `requirements/<编号>/spec.md`。确认需求前，标题、描述、负责人和规格书必须齐备。普通需求创建或编辑不能写入 `status`、`statusChanged*`、`statusOverride`、`external` 或 `externalTasks`。

Schema 3 → 4 迁移按以下顺序决定状态：

1. 有 `statusOverride` 时使用它；
2. 没有覆盖值但已有合法 `status` 时保留该状态及变更元数据；
3. 只有缺少 `status` 时才根据关联版本派生旧状态。

旧状态映射为：

| 旧状态 | Schema 4 状态 |
|---|---|
| `not_started`、`designing` | `draft` |
| `finalized`、`delivered` | `confirmed` |

迁移生成的记录使用 `statusChangedBy: "migration:schema4"` 和 `statusReason: "legacy-derived:<旧状态>"`，并删除 `statusOverride`。未知状态或重复外部任务绑定会令迁移失败并恢复初始备份。

打开 Schema 1、2 或 3 仓库时，Flowlark 会先备份受影响元数据，再按顺序升级到 Schema 4。任一步失败都会恢复整个迁移链开始前的字节；不带参数回滚时，按有效 backup manifest 的时间选择最新备份。迁移拒绝符号链接形式的 `flowlark.json`、`.gitignore`、`.gitattributes`、`requirements/` 和需求目录，避免读取或改写仓库外文件。

## 受控外部绑定只保存稳定身份

需求的 `externalTasks` 按 `(provider, server, projectId)` 保存当前主任务；同一个 `(server, projectId, taskId)` 不能属于两个需求。迭代的 `external` 保存唯一主 Sprint；同一个 `(server, projectId, sprintId)` 不能属于两个迭代。

首次绑定和重新绑定都必须先读取远端对象，验证项目归属，再生成高风险预览。确认执行时使用 `expectedTaskId` 或 `expectedSprintId` 做 CAS 检查，并在统一绑定锁内重验计划哈希和唯一性。重新绑定会清空 `lastSyncHash`，下一次字段同步必须明确选择恢复 Flowlark 值。

## 区分团队历史和本机恢复状态

| 路径 | 用途 | 是否进入 Git |
|---|---|---|
| `projects/*/project.json` | 项目同步策略等团队元数据 | 是 |
| `requirements/*/requirement.json` | 需求生命周期和稳定外部任务绑定 | 是 |
| `requirements/*/spec.md` | 需求规格与验收边界 | 是 |
| `milestones/*.json` | 迭代范围、生命周期、Sprint 绑定和冻结验证摘要 | 是 |
| `.flowlark/sync-audit.ndjson` | 同步状态和步骤的 append-only 审计历史 | 是，使用 `merge=union` |
| `.flowlark/cache/sync-queue/` | 已持久化预览、步骤状态、安全错误和重试进度 | 否 |
| `.flowlark/backup/` | Schema 迁移前的可恢复元数据 | 否 |
| `.flowlark/cache/` 中的其他外部系统缓存 | 旧版 MCP 记录等本机运行数据 | 否 |

`.flowlark/sync-audit.ndjson` 记录预览生成、取消请求与结果、执行状态和步骤变化。写入前会按键名递归脱敏，并清洗错误消息等字符串中的 `Bearer`、`Basic`、`api_key` 和 `sk-` Token，敏感值替换为 `[REDACTED]`。审计文件是可追踪历史，但不是凭据存储。备份、队列记录和所有外部缓存都只留在当前本机 checkout，由 `.gitignore` 排除。

## 三个关键决定

### 1. BASELINE 是一个文件，不是一个字段

这是整个设计里收益最大的一处。

之前 SQLite 版本里，「当前基线」是 `version.status = 'BASELINE'`，R2「同时只能有一个基线」得靠**应用层在事务里手工维护**：把旧的降级、把新的升级，中间任何一步失败都会留下「零个基线」或「两个基线」的脏状态。所以那段代码必须包在事务里，还得写测试去证明它没坏。

改成文件之后，基线是 `projects/<项目>/BASELINE` 这个文件的内容——一行版本号。于是：

- **不可能有两个基线**，因为文件只有一行。约束从「运行时校验」变成了「数据结构性质」。
- 切换基线是**一次原子的文件写入**，不需要事务。
- Git 合并冲突时，冲突点就是这一行，`<<<<<<< v1.3 ======= v1.4 >>>>>>>`，一眼就知道两个人各自把基线指向了哪，怎么解不用猜。

版本自己只存 `status`（DRAFT / READY / VOID）和 `baselineAt`，**「是不是当前基线」是派生出来的**：

| 展示状态 | 派生条件 |
|---|---|
| 已废弃 | `status === 'VOID'` |
| 已确认 · 当前基线 | `versionNo === BASELINE 文件内容` |
| 历史版本 | `baselineAt != null` 且不是当前基线 |
| 编辑中 | 其余 |

派生的好处是**没有需要同步的冗余字段**，也就没有「降级忘了写」这类 bug 的容身之处。

### 2. JSON 必须稳定序列化

Git 友好不是把数据写成 JSON 就完事了。键顺序随机、缩进不一致、数组挤成一行，diff 照样没法看。所以 `src/core/json.js` 里强制：

- 键按固定 schema 顺序输出，不用 `Object.keys` 的偶然顺序
- 2 空格缩进，数组每项独占多行
- 文件末尾保留换行（否则每次改动 diff 都会多出一行噪音）

一条变更日志改动，diff 应该正好是一行。

### 3. 原型 HTML 在 .gitattributes 里标为 binary

原型是 AI 生成的单文件 HTML，动辄几千行且经常整体重排。让 Git 去逐行 diff 它，只会把 review 界面淹掉，而且没人真的会去读那个 diff——要看差异，人看的是**渲染后的页面**和**手写的变更日志**。

所以 `*.html binary`，Git 只记录「这个文件变了」。真正承载语义的是 `.json` 里的变更日志和 `.spec.md`，那两个是精心保持可读的。

## 冲突面分析

| 场景 | 结果 |
|---|---|
| 两人各加一个新版本 | 不同文件，**无冲突** |
| 两人改同一版本的变更日志 | `v1.x.json` 冲突，因为键序稳定，冲突块可读 |
| 两人各自切了不同基线 | `BASELINE` 单行冲突，**极易判断** |
| 两人各自编辑规格书 | `.spec.md` 冲突，Markdown 按行 merge，通常能自动合并 |
| 操作日志 | ndjson append-only，冲突时保留双方即可 |

## 逻辑删除

R7 的逻辑删除不再是 `deleted_at` 字段，而是把版本的三个文件**移动**到 `.flowlark/trash/<项目>/<时间戳>-<版本号>/`。

好处是主目录保持干净——`ls projects/order-center/versions/` 看到的就是真实存在的版本，不需要每个查询都带上 `WHERE deleted_at IS NULL`（那个条件漏写一次就是一个 bug）。恢复就是移回去。
