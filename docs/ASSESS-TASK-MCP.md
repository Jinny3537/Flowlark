# Assess Task MCP 迭代同步

Flowlark 可以通过本地 `stdio` MCP 把迭代、需求和原型版本范围同步到“研发任务管理”平台。

当前边界：

- Flowlark 是迭代计划事实源；
- 每个 Flowlark 项目配置自己的 MCP 服务和平台项目；同一迭代中的项目必须解析到同一同步目标；
- 一个 Flowlark 迭代对应一个平台冲刺；
- 同一需求在同一外部项目中最多绑定一个平台主任务；
- Flowlark 只写项目声明的托管字段；实际工时、评论、Bug、活动记录和其他非托管字段由平台保留；
- 平台写入必须先生成计划，再显式确认。
- `v0.7.3` 只实现手工预览、确认、执行和恢复，不会自动执行同步。

## 环境要求

- Node.js 20 或更高版本；
- 与操作系统和 CPU 匹配的 `assess-task-mcp`；
- 可访问研发管理平台的网络；
- 正常启用且具备项目权限的个人平台账号。

本次静态审查收到的文件是 macOS x86_64 可执行文件：

```text
SHA-256 fffb6d3291e5ee39b2e4c78d2f0afbe3b6028dee49fc1af94df852172b5156f2
```

这个哈希只用于标识本次审查样本，**不是所有未来版本的通用白名单**。升级 MCP 后应使用发布方随安装包提供的新 SHA-256。

审查样本没有执行权限且未签名。缺执行权限是运行阻塞项；未签名属于企业安全警告，应按组织的软件安全流程处理。Flowlark 不会关闭 Gatekeeper 或绕过安全软件。

## 配置

打开“设置 → MCP”，新增服务：

1. 传输类型选择“本机 stdio”；
2. 平台适配器选择“Assess Task · 研发任务管理”；
3. 填写本机运行配置标识，例如 `assess-task-local`；
4. 保存逻辑服务；
5. 在“本机 stdio 运行配置”填写：
   - 可执行文件绝对路径；
   - 启动参数，通常为 `[]`；
   - 平台根地址；
   - 个人平台账号；
   - 发布方提供的 SHA-256；
6. 单独保存平台密码；
7. 执行“检查可执行文件”。

仓库中的 `mcp.json` 只保存团队共享的逻辑配置。以下信息不进入 Git：

- 可执行文件绝对路径；
- 平台地址和个人账号；
- 密码；
- 执行日志与失败恢复状态。

本机路径、地址和账号保存在 `$FLOWLARK_HOME/mcp-runtime.json`，文件权限为 `0600`。密码只保存到系统钥匙串；启动 MCP 子进程时才注入 `ASSESS_PASSWORD`。

## 迭代能力映射

“迭代能力映射”只提供工具映射和平台枚举选项。实际 MCP 服务和平台 `projectId` 来自项目同步设置，不能由全局能力配置或浏览器请求覆盖。

能力选项示例：

```json
{
  "ownerId": 7,
  "taskType": 2,
  "priorities": {
    "P0": 0,
    "P1": 1,
    "P2": 2
  },
  "members": {
    "zhangsan": 8,
    "lisi": 12
  },
  "timezoneOffset": "+08:00"
}
```

数字 ID 和枚举值必须来自实际平台查询或管理员确认。Flowlark 不根据姓名、标题或常见枚举习惯猜测。

目标 MCP 需要提供以下语义操作：

```text
currentUser
listProjects
projectCapabilities
listMembers
listSprints
getSprint
listTasks
getTask
saveSprint
createTask
updateTask
moveTasks
startSprint
endSprint
cancelSprint
```

保存写入能力前，Flowlark 会检查工具是否存在，以及关键参数是否仍是必填字段。后端升级导致 Schema 不兼容时，写入能力会停止，不会带着旧参数继续调用。

## 配置项目同步目标和托管字段

Schema 3 在 `projects/<项目>/project.json` 中保存 `project.sync`：

- `mode`：`manual` 或 `trusted-auto`，默认为 `manual`；
- `server`：逻辑 MCP 服务标识；
- `projectId`：外部平台项目标识；
- `managedFields`：Flowlark 计划管理的标题、描述、验收标准、优先级、负责人、迭代、状态和交付信息。

生成预览前，Flowlark 会从迭代范围读取每个项目的设置，并要求 `server`、`projectId` 和排序后的 `managedFields` 完全一致。选中的项目服务决定 stdio 运行配置，迭代能力只补充工具名和枚举映射。缺少目标、服务停用、传输类型错误、适配器错误或跨项目配置不一致时，在任何远端读取前停止。

`managedFields` 直接决定计划哈希、漂移比较和更新请求：

- `title`：任务标题或 Sprint 名称；
- `description`：任务说明或 Sprint 目标；
- `acceptance`：任务验收标准；
- `priority`：任务优先级；
- `assignee`：任务或 Sprint 负责人；
- `sprint`：任务移入或移出 Sprint；
- `status`：按能力配置中的显式状态映射更新任务状态；
- `delivery`：`v0.7.3` 只显示提示，不执行远端写入。

更新只覆盖托管字段，并把平台对象的非托管字段合并回请求。远端值与上次同步摘要不一致时，`v0.7.3` 只支持高风险的 `restore-local`：显式确认后恢复 Flowlark 值；不会把远端文本静默写回本地。

`trusted-auto` 仍是禁用的保留模式，不能跳过预览或确认。无人值守执行要等后续版本完成资格验证后才会开放。

## 使用流程

迭代状态：

```text
计划中 → 评审中 → 已冻结 → 进行中 → 已交付 → 已归档
   \        \          \
              已取消
```

建议流程：

```text
生成同步预览 → 在同步中心检查差异 → 确认执行 → 查看步骤和审计 → 失败后重试
```

1. 创建迭代，填写目标、负责人和周期；
2. 加入需求对应的原型版本；
3. 进入评审；
4. 处理冻结检查中的草稿、基线漂移、审阅状态和规格书问题；
5. 生成同步预览；预览会以 `pending-confirmation` 状态持久化；
6. 在同步中心审阅创建、更新、迁移、冲突和生命周期操作；
7. 核对计划哈希，显式确认并执行；
8. 以 `action: "freeze"` 生成冻结计划；完成远端回读后，服务端写入 `scopeHash` 和 `verifiedAt`，再把迭代置为已冻结；
9. 从 Flowlark 生成并确认 Sprint 启动计划；只有远端启动回读成功后，迭代进入进行中，范围内已确认需求进入开发中。

同步中心只暴露服务端固定的“执行”、“重试”和“取消”动作。浏览器可提交计划哈希、原因和未完成任务确认，但不能指定 MCP 服务、工具名或任意远端操作。执行和重试都以持久化的 `intent` 为准：服务端从记录取出 `entityKey`、`intent` 和 `planHash`，重新读取当前本地数据与远端对象并重建计划。哈希一致时才会执行；发现变化时会保存新的 `pending-confirmation` 预览，不执行旧计划。

Sprint 启动、取消和进行中范围变化属于高风险操作，必须填写原因并确认影响。正式发版不会自动结束 Sprint 或归档迭代；把 Sprint end 和归档接入验收闭环属于后续版本。
解除冻结同样必须填写原因，原因会进入操作日志。

CLI 对应命令：

```bash
flowlark milestone preflight S12
flowlark milestone plan S12 --action freeze --json
flowlark milestone plan S12 --action start --json
flowlark milestone sync S12 --plan-hash sha256:... --action start --confirm --reason "进入开发" --unfinished
flowlark milestone resume S12
flowlark milestone transition S12 reviewing
```

`plan` 只读取，不写平台。只有带正确计划哈希和 `--confirm` 的 `sync` 才执行远端操作。

旧的单迭代 `POST /api/milestones/:name/sync` 路由现在只生成服务端预览，不再根据请求中的 provider、映射或工具配置直接写入平台；通用 HTTP 直推入口已收紧到相同的“预览后确认”边界。

## 冲突和失败恢复

每次写入前都会重新读取平台对象的 `revision`。平台对象已被其他人修改时：

- 不自动覆盖；
- 计划显示冲突；
- 用户只能显式选择恢复 Flowlark 值；
- 需要采用平台文本时，先手工修改 Flowlark 文件，再生成新计划。

## 受控绑定和未知创建结果恢复

需求任务和迭代 Sprint 的首次绑定、重新绑定都走同步中心：服务端从项目设置解析目标，读取远端对象并验证项目归属，生成高风险计划，再使用计划哈希、统一绑定锁、反向唯一性和 `expectedTaskId` / `expectedSprintId` CAS 执行。浏览器只能提交本地项目、远端 ID、预期旧 ID、原因和确认标记，不能选择服务、工具或请求体。

如果 `sprint.create` 或 `task.create` 的请求可能已经送达，但响应超时、断线或无法解析，记录会停在 `paused`，错误为 `MCP_SYNC_LINK_REQUIRED`。不要直接重试创建。先在平台确认实际对象，再调用固定恢复接口：

```text
POST /api/sync/<同步记录 ID>/link-result
{
  "operationKey": "sprint:S12:create",
  "remoteId": 123,
  "reason": "人工核对平台结果"
}
```

服务端会重新解析当前项目目标，读取候选对象，并检查远端 ID、项目归属、托管字段投影、任务类型、所属 Sprint 和绑定唯一性。验证通过后立即保存 binding 和 `remoteResult`，把步骤改为 `remote-complete`。用户随后仍需点击重试；重试只补本地持久化、验证和后续步骤，不会重发已经完成的 create。

冻结计划另有一份覆盖迭代业务字段、排序范围、需求生命周期及投影、稳定绑定、项目目标和托管字段的 `sourceHash`。执行进入锁后会重算该哈希；不一致时旧计划失效。只有所有远端任务和 Sprint 回读存在且托管字段匹配，才会原子写入 `external.scopeHash`、`external.verifiedAt` 和本地 `frozen` 状态。

新的同步预览和执行步骤记录在：

```text
.flowlark/cache/sync-queue/<基于同步对象的 SHA-256>.json
```

这是当前 checkout 的本机可恢复执行状态，包含预览、计划哈希、步骤状态、时间和最新的安全错误，不进入 Git。Flowlark 仍可以只读旧的 `.flowlark/cache/mcp-sync/<迭代>.json`，但新写入只使用全局同步队列。

团队可追踪的脱敏审计追加到：

```text
.flowlark/sync-audit.ndjson
```

预览生成、取消请求与结果、执行状态和步骤变化都进入该团队审计。写入前会递归脱敏密码、授权信息、Token、Secret 和环境变量值，并清洗错误消息字符串中的 `Bearer`、`Basic`、`api_key` 和 `sk-` Token，然后以 append-only 文本进入 Git。

执行顺序是：冲刺 → 任务 → 任务迁移 → 生命周期操作 → 回读验证。

同一迭代同时只能有一个执行或重试流程；进程异常结束后，已失效的本机锁可在下次操作时回收。

如果中途失败：

- 已成功对象的远端 ID 会立即写入本地绑定；
- 迭代状态不会提前转换；
- “恢复同步”只执行未完成步骤；
- 不会自动删除已经创建的远端对象；
- 创建结果不明确，或 `remote-complete` 步骤缺少远端 ID 时，暂停并要求人工关联远端对象，不重发创建；
- `remote-complete` 步骤已有远端 ID 时，只补写本地 binding，不重发远端请求。

在同步中心重试时，服务端只从 `failed` 或 `paused` 记录恢复，跳过已完成步骤，避免重复创建远端对象。这个恢复动作仍由人发起，不是后台自动同步。

同步记录不保存密码、Token、完整环境变量或未脱敏的授权信息。

## 更新二进制

1. 退出正在运行的 Flowlark；
2. 从平台下载与系统和 CPU 匹配的新安装包；
3. 校验发布方提供的 SHA-256；
4. 按组织要求检查签名或公证；
5. 替换文件并确认执行权限；
6. 更新设置中的期望 SHA-256；
7. 重新执行可执行文件检查和连接测试。

不要把二进制、账号或密码提交到原型数据仓库。

## 当前验证状态

已完成：

- stdio MCP 握手、工具发现、调用、错误、超时和进程关闭测试；
- HTTP MCP 兼容回归；
- 本机配置权限、SHA、架构和签名诊断测试；
- Assess Task 工具契约和响应归一化测试；
- 生命周期、冻结检查、确定性计划、漂移冲突测试；
- 部分失败、断点恢复、重复执行和 `revision` 刷新测试；
- API、CLI、React 模型和生产构建验证。

尚未完成：使用真实可写平台账号的端到端联调。因此当前状态必须描述为：

> 实现及模拟契约验证完成；目标平台真实联调待完成。

## P4 真实联调清单

在一次性测试项目中完成：

- [ ] 发现实际发布工具并保存脱敏 Schema 夹具；
- [ ] 验证当前账号和项目权限；
- [ ] 创建一个冲刺和三个需求任务；
- [ ] 重复执行无变更同步，确认没有重复对象；
- [ ] 将任务迁入、迁出冲刺；
- [ ] 制造过期 `revision`，确认不会覆盖；
- [ ] 开始冲刺；
- [ ] 验证未完成任务确认规则；
- [ ] 验证 Sprint 启动和显式取消；Sprint end 与归档待后续验收闭环开放后再验收；
- [ ] 检查 Git、日志、API 响应和同步记录中没有凭据；
- [ ] 用真实结果更新工具名、枚举和时间格式兼容说明。

P4 全部通过前，不得宣称该平台集成已在生产环境验收。
