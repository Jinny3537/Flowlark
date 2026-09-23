# 功能关联升级验收记录

日期：2026-09-12。范围：[升级方案](../specs/2026-09-12-module-workflow-linkage.md)中的 L1–L5 与 A1–A12。

## 实际完成

| 范围 | 实现证据 | 验证证据 |
|---|---|---|
| L1 需求关系与下一步 | `RequirementDetail`、`RequirementWorkflow`、`WorkflowLinks`；原型/迭代/交付关系可展开，安排成功可直接进入迭代 | 浏览器 A1、A3、A7、A11 |
| L2 原型去向 | `VersionWorkbench`、`ProjectVersions`；精确版本关联、加入入口、新归档提示、源页面返回 | 浏览器 A2、A4、A5、A10；核心跨项目匹配测试 |
| L3 就地安排 | `AssignIterationDialog`、`assignMilestone`；预览、重复识别、显式保留/替换、新建携带范围 | 浏览器 A1、A2、A6；核心修订冲突、锁、权限、未关联/删除/废弃/锁定测试 |
| L4 迭代组织范围 | `MilestoneDetail`、`Milestones`；需求标题链接、去重计数、来源行定位、交付列表 | 浏览器 A7、A9；计数模型测试 |
| L5 交付续办 | `Deliveries`、`DeliveryComposer`、`DeliveryDetail`；预填来源、补材料返回、按仓库暂存、重查与清除草稿 | 浏览器 A8、A12；原有交付冻结/ZIP 下载回归 |

关系查询复用原有需求关联、迭代 items 和冻结交付数据。未新增关系存储或批量迁移。历史多版本映射保留，用户可以明确选择替换；既有冻结检查仍拒绝未解决的多版本冲突。

## 已执行检查

| 检查 | 实际结果 |
|---|---|
| `node --test` | 489 项通过，0 失败，73 个 suite |
| `node --test test/workflow-links.test.js test/milestones.test.js web/src/pages/workflowModel.test.js` | 11 项通过，0 失败 |
| `npm run build --prefix web` | 通过；约 1.94 MB 主包，gzip 约 612 KB，仍有已有的非阻塞体积告警 |
| `node .codex-ui-regression/workflow-linkage.mjs` | 通过；A1–A12 的浏览器/核心分工见下文；桌面及 390px 页面与弹窗已检查 |
| `node .codex-ui-regression/requirement-workflow-08.mjs` | 通过；既有归档关联、采用版本、分析、删除恢复、问题回复、研发进度及测试验收回归 |
| `node .codex-ui-regression/delivery-check.mjs` | 通过；创建、检查、冻结、查看材料、ZIP 下载、小屏交付列表 |
| `git diff --check`、新文件空白检查、核心文件语法检查 | 通过 |

浏览器场景 A1 验证取消不留空迭代、创建时带入范围；A2 验证多需求原型只加入选定需求；A3–A5 验证不同迭代与同号跨项目不串联、新归档不改范围；A6 验证确认前变更被拒绝；A7 验证返回原范围行；A8 验证补材料返回及刷新恢复表单并成功冻结；A9 验证多次交付独立保留；A10 验证三种远程角色只读关联；A11 验证查询失败与重试；A12 验证进入/暂存不创建交付，重复映射与竞争提交由核心和 HTTP 测试验证。

角色协作回归使用隔离仓库的预置访客身份，测试真实服务端角色权限及提交记录；没有进行真实微信登录或外部平台联调。旧 smoke 中已失效的需求范围筛选器定位改为从被删除需求详情恢复，仍实际执行删除和恢复并检查数据结果。

验收产物保存在仓库 `test-results/workflow-linkage/`：完整测试日志、构建日志、浏览器报告、桌面/小屏截图和实施文件 SHA-256。所有业务写入验证使用临时仓库。

## 本地生效检查

原有本地服务以相同 Node 程序、启动命令和数据仓库重新启动：工作台端口 7788，预览端口 7789，数据仓库仍为 `/Users/beluga/flowlark-repo`。

重启后健康检查通过；对实际仓库各取一个已有需求、迭代、原型执行关联只读查询，均返回正确响应结构。未在实际仓库创建、调整或删除业务对象，未执行 Git 提交/推送或远端发布，也未主动发送消息。

工作区已有的原型界面修改以及同时出现的团队登录修改均保留，本记录只归属本次功能关联升级。使用说明见 [功能关联操作指南](../../MODULE-WORKFLOW.md)。
