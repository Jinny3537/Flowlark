# 正式发版领域服务拆分设计

## 背景

`src/core/service.js` 同时承担项目、需求、迭代、同步、交付、正式发版和外部集成等职责，文件已超过 3,700 行。其中正式发版流程约占 450–500 行，包含目标校验、预检、基线切换、Git 同步、交付快照、生命周期推进、邮件发送和失败恢复。

这些逻辑属于同一个领域流程，但目前分散在 `Hub` 的公开方法、私有方法和文件级 helper 中。修改发版步骤时需要跨越较大文件理解状态与依赖，容易遗漏幂等、审计或恢复路径。

## 目标

- 将正式发版编排集中到一个边界明确的领域服务模块。
- 保持 `Hub` 作为 CLI 与 HTTP API 的稳定业务门面。
- 保持所有公开方法、参数、返回值、错误码、持久化格式和业务行为不变。
- 保持现有发版顺序：目标校验 → 预检 → 基线 → Git → 快照 → 生命周期 → 邮件。
- 保持失败后的续跑与邮件幂等语义不变。

## 非目标

- 不修改正式发版业务规则或用户界面。
- 不重命名公开 API，不调整 HTTP 路由或 CLI 命令。
- 不改造 `release-mail.js`、`formal-release-run.js` 的存储格式。
- 不同时拆分验收、迭代同步或其他 `Hub` 领域。
- 不引入新的框架、依赖注入容器或抽象基类。

## 方案

新增 `src/core/formal-release-service.js`，使用普通导出函数承载正式发版领域流程。模块通过显式 context 接收仍由 `Hub` 负责的能力，不直接导入或构造 `Hub`，从而避免循环依赖。

领域服务对外提供四个操作：

- `preflightMilestoneFormalRelease(context, name, slug, versionNo, input)`
- `formalReleaseMilestoneVersion(context, name, slug, versionNo, input)`
- `listReleaseMails(context)`
- `retryReleaseMail(context, id)`

`Hub` 保留同名公开方法。公开方法只负责建立 context、执行写权限检查，以及在正式发版时持有现有的互斥锁，然后委托给领域服务。

## 模块职责

`formal-release-service.js` 负责：

- 校验迭代状态、版本范围、版本规格书和需求验收规格。
- 生成公开预检结果，并确保内部收件人身份不泄漏。
- 编排基线切换、Git 同步、快照创建、交付记录和邮件发送。
- 记录和恢复 `formal-release-run` 的各步骤状态。
- 处理重复发版、Git 失败、快照失败、邮件待重试等现有分支。
- 查询和重试发版邮件。
- 承载仅由正式发版使用的 helper，包括发版时间校验、Git 结果检查、交付定位和邮件结果组装。

`Hub` 继续负责：

- 对外暴露稳定的业务门面。
- 执行 `#assertWritable`。
- 使用 `withMilestoneSyncLock` 保证同一发版目标串行执行。
- 提供已有的基线、Git、版本查询和日志能力。

## 依赖端口

context 只暴露正式发版流程实际需要的能力：

- `root`
- 当前 `settings`
- 当前 `wecomMcp` 和 `gitSyncOverride`
- `gitIdentity`、`gitConflicts`、`gitInProgress`、`gitRemote`、`gitSync`
- `listVersions`、`setBaseline`、`getVersion`
- `appendLog`

存储、规则、交付快照、迭代、需求、发版运行记录和邮件队列由领域服务直接使用现有核心模块。这样既保留原有领域规则，又避免把整个 `Hub` 传入新模块。

context 在每次公开方法调用时创建，确保运行期更新后的配置、企业微信适配器和 Git override 能立即生效，不缓存可变状态。

## 数据流

### 预检

1. `Hub.preflightMilestoneFormalRelease` 创建 context 并委托领域服务。
2. 领域服务校验迭代与版本范围。
3. 领域服务检查版本、Git、邮件配置和企业微信通讯录。
4. 返回移除 `internalTo` 与 `internalCc` 后的公开结果。

预检不得写入基线、邮件队列、发版运行记录或交付快照。

### 正式发版

1. `Hub.formalReleaseMilestoneVersion` 检查写权限并获取现有发版锁。
2. 领域服务先识别已完成或可恢复的发版记录。
3. 未完成时执行预检并切换基线。
4. 依次执行 Git 同步、快照创建、交付生命周期记录和邮件发送。
5. 每一步沿用 `formal-release-run` 的现有持久化与恢复语义。
6. 返回与当前实现完全一致的结果结构。

### 邮件重试

1. `Hub.retryReleaseMail` 检查写权限后委托领域服务。
2. 领域服务验证当前基线仍与邮件任务一致。
3. 只重试邮件步骤，并更新关联的发版运行记录。

## 错误与持久化约束

- 所有现有错误码、中文消息和 hint 保持不变。
- Git 失败时不得创建快照或发送邮件。
- 快照失败时不得推进交付生命周期或发送邮件。
- 邮件失败时保留 pending 任务，重试不得重复基线、Git 或快照步骤。
- 已完成发版重复调用不得再次调用企业微信。
- 交付快照与迭代、项目、版本不匹配时继续使用 `DELIVERY_SCOPE_MISMATCH`。
- 任何公开响应继续隐藏 userid、邮箱和内部收件人对象。

## 文件变更

- 新增 `src/core/formal-release-service.js`。
- 修改 `src/core/service.js`：增加领域服务导入和 context 构造；将四个公开方法改为委托；删除已迁移的私有方法与文件级 helper。
- 原则上不修改现有测试断言；只有在需要直接验证新模块边界时才新增聚焦测试。

## 验证

1. 运行 `node --test test/release-mail.test.js test/release-mail-api.test.js`，验证发版业务、失败恢复、幂等和 API 契约。
2. 运行 `npm test`，验证全部核心与前端模型测试。
3. 运行 `npm run build`（`web/`），验证前端调用契约未改变。
4. 运行 `node --check` 检查两个变更模块的语法。
5. 运行 `git diff --check`，并确认变更文件仅包含设计范围内的文件。

## 成功标准

- `service.js` 减少约 450–500 行正式发版实现代码。
- 正式发版流程集中在单一领域模块中。
- `Hub` 的公开接口及调用方无需修改。
- 现有相关测试、全量测试与前端构建全部通过。
- 没有新的运行时依赖、存储迁移或用户可见行为变化。

## 回滚

该变更不包含数据迁移。若验证失败，可直接回退 `service.js` 的委托改动并删除 `formal-release-service.js`，不会影响已有仓库数据。
