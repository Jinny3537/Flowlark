# 版本上线与任务平台收尾

在版本工作台点击“标记已上线”，保存本地上线事实，并按顺序结束关联冲刺、关闭平台版本。不执行部署，不发送通知，不自动完成需求或任务，也不触发已有的正式发版邮件流程。

## 首次配置

1. 设置 → MCP 集成 → 迭代能力，绑定已有的 Assess Task stdio 服务及平台项目。
2. 保留已有工具映射，补充 `getVersion`、`closeVersion`，填写服务实际提供的工具名称。工具发现结果必须满足下面的调用契约；不能用名称相似的发布/删除工具代替关闭工具。
3. 在能力选项中增加 `releaseClosure` 对象，包含 `sprintEndedStatuses`、`versionClosedStatuses`、`taskCompletedStatuses` 三个非空数组。值必须使用平台文档定义的实际状态值。没有默认状态码，避免错误关闭。
4. 在迭代中关联本地版本，并完成已有平台冲刺绑定。
5. 版本工作台 → 配置上线联动，填写平台版本 ID 并保存。之后一次点击即可完成上线及同步。

本次代码没有平台版本接口的真实定义或可用运行配置；工具映射、状态码和实际平台联调仍需基于平台接口确认。缺少映射或接口不匹配会返回明确错误，不会报告同步完成。

## 接口契约

| 操作 | 工具参数 | 读取结果要求 |
| --- | --- | --- |
| `getSprint` | `{ sprintId }` | `id` 或 `sprintId`、`projectId`、`revision`、`status` 或 `state` |
| `listTasks` | `{ projectId, sprintIds: [id], pageNum, pageSize }` | 数组或已有适配器支持的列表包装，任务含 `status` 或 `state`；支持分页 |
| `endSprint` | `{ body: { sprintId, revision, reason, confirmUnfinished: false } }` | 成功后再次读取冲刺验证终态 |
| `getVersion` | `{ versionId }` | `id` 或 `versionId`、`projectId`、`revision`、`status` 或 `state` |
| `closeVersion` | `{ body: { versionId, revision, reason, confirmUnfinished: false } }` | 成功后再次读取版本验证终态 |

写入接口需遵守修订号校验及未完成项约束。当前版本工具契约必须与发现的必填参数匹配；若平台接口不同，需要调整适配器，不能仅修改名称强行接入。

## 范围与异常

- 支持一个版本关联多个冲刺，全部结束后才关闭平台版本。
- 关联冲刺包含其他本地版本时阻止联动，提示拆分；也检查多个本地迭代指向同一个平台冲刺的情况。
- 未开始、取消的迭代和缺少平台关联的迭代不能自动结束。
- 结束前分页检查未完成任务；不强制确认或改写任务完成状态。
- 写入前读取所有目标对象，验证 ID、项目、状态、修订号。
- 外部失败后保留 `deliveryStatus: online` 与首次 `onlineAt`。现有原型的草稿/基线/废弃状态保持原有含义。
- `onlineSync` 保存操作人、首次时间、各步骤状态及错误。成功步骤不重复执行；响应丢失时重试先读取远端状态核对。
- 已尝试平台写入后锁定版本绑定，重试检查冲刺范围是否变化；仅配置或读取检查失败时允许修正绑定。同一服务进程内重复点击会被拒绝。
- 平台步骤成功但本地写入失败时可重试核对。不同服务进程不应同时操作同一工作区；远端修订号校验仍必须由平台保证。

## API

- `PUT /api/versions/:slug/:no/release-binding`，请求 `{ "versionId": 123 }`，平台项目和服务取当前迭代配置。
- `POST /api/versions/:slug/:no/online`，同时用于首次标记及失败重试，返回完整版本对象。
- API 复用工作区写权限与团队主机权限。同步业务失败返回版本对象中的 `onlineSync.status: failed` 和 `onlineSync.error`，调用方不能只根据 HTTP 200 判断同步成功。
