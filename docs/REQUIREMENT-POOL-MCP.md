# 需求池 MCP 配置合同

本文档面向需求池平台和内部集成方。v0.7.5 只接入需求读取能力：配置导入、连接测试、需求列表搜索、单条详情刷新、本地引用、版本关联、迭代范围和正式交付快照来源冻结。

自动写回、自动关闭外部需求、自动结束外部 Sprint 不在 v0.7.5 范围内。

## 使用入口

在 Flowlark 工作台打开：

```text
设置 → MCP 集成 → 需求池配置导入
```

可直接加载内置示例，也可以粘贴或选择平台提供的 JSON 文件。HTTP 接口也暴露同一合同：

```text
GET  /api/mcp/requirement-pool/template
GET  /api/mcp/requirement-pool/schema
POST /api/mcp/requirement-pool/inspect
POST /api/mcp/requirement-pool/import
POST /api/mcp/requirement-pool/status
```

## Manifest 示例

可复制的示例文件在 [`docs/examples/requirement-pool-manifest.example.json`](examples/requirement-pool-manifest.example.json)。该文件会被测试读取并通过当前 manifest 预检。

```json
{
  "manifestVersion": "2026-09",
  "platform": {
    "id": "demand-pool",
    "name": "需求池平台",
    "type": "requirement-pool",
    "docsUrl": "https://docs.example.com/requirement-pool-mcp"
  },
  "project": {
    "id": "safe-prod"
  },
  "transport": {
    "type": "http",
    "url": "https://mcp.example.com/api",
    "timeoutMs": 10000,
    "headers": {
      "Authorization": "Bearer ${secret:demand-pool-mcp}"
    }
  },
  "tools": {
    "test": "requirements.test",
    "search": "requirements.search",
    "get": "requirements.get"
  },
  "fields": {
    "code": "code",
    "title": "title",
    "module": "module",
    "type": "type",
    "priority": "priority",
    "owner": "owner",
    "status": "status",
    "url": "url"
  },
  "statuses": {
    "backlog": "待排期",
    "doing": "开发中",
    "done": "已完成",
    "closed": "已关闭"
  },
  "secrets": [
    {
      "name": "demand-pool-mcp",
      "label": "需求池访问 Token",
      "required": true
    }
  ],
  "safety": {
    "readOnly": true,
    "writes": [],
    "dangerous": []
  }
}
```

## 字段规则

- `manifestVersion`：必填。当前示例为 `2026-09`。
- `platform.id`：必填，只能使用小写字母、数字、点、下划线和连字符。
- `platform.name`：必填，用于设置页和需求来源展示。
- `project.id`：可选。导入后会作为需求池项目或空间标识传给 MCP 工具。
- `transport.type`：必填，只支持 `http` 或 `sse`。
- `transport.url`：必填，只支持 HTTP/HTTPS URL，不能携带用户名或密码。
- `transport.headers`：可选，但凭据必须使用占位符。
- `tools.test`、`tools.search`、`tools.get`：必填。
- `tools.comment`：可选。v0.7.5 的 manifest 导入仍按只读验收，不依赖评论或写回。
- `fields`：可选。缺失时只显示原始外部引用，不阻塞导入。
- `statuses`：可选。缺失时不会自动判断外部状态，不阻塞导入。
- `safety.readOnly`：建议保持 `true`。声明写能力会产生警告，v0.7.5 不启用写回。

## 密钥规则

允许：

```text
Authorization: Bearer ${secret:demand-pool-mcp}
Authorization: Bearer ${env:FLOWLARK_V075_SECRET_DEMAND_POOL_MCP}
```

不允许：

```text
Authorization: Bearer real-token
https://user:password@mcp.example.com/api
```

`${secret:name}` 表示用户在本机设置页录入，值不写入 `mcp.json`，也不进入 Git。`${env:NAME}` 表示运行时从环境变量读取，适合 smoke 验收或 CI 的一次性测试环境。

## MCP 工具契约

Flowlark 通过 JSON-RPC `tools/call` 调用 manifest 指定的工具名。

### 连接测试

工具名来自 `tools.test`。参数：

```json
{
  "project": "safe-prod"
}
```

返回值可包含：

```json
{
  "identity": "pm@example.com"
}
```

`identity`、`name`、`login`、`email` 或 `text` 都会被当作连接身份摘要。

### 列表搜索

工具名来自 `tools.search`。参数：

```json
{
  "query": "订单",
  "q": "订单",
  "text": "订单",
  "project": "safe-prod",
  "limit": 20
}
```

返回值可以直接是数组，也可以放在 `items`、`data`、`results` 或 `requirements` 字段内：

```json
{
  "items": [
    {
      "code": "REQ-0275",
      "title": "订单列表支持批量关闭",
      "description": "需要在列表工具栏增加批量关闭入口。",
      "project": "safe-prod",
      "module": "订单列表",
      "type": "功能",
      "priority": "P1",
      "owner": "张小雨",
      "status": "开发中",
      "url": "https://demand.example.com/REQ-0275"
    }
  ]
}
```

### 单条详情

工具名来自 `tools.get`。参数：

```json
{
  "key": "REQ-0275",
  "code": "REQ-0275",
  "project": "safe-prod"
}
```

返回单个需求对象。推荐字段为：

```text
code, title, description, project, module, type, priority, owner, status, url
```

兼容别名：

```text
code/key/id/number
title/name/summary
description/body
project/projectKey/projectName/space
module/component/componentName/category
type/issueType/requirementType
priority/severity/level
owner/assignee/assigneeName
status/state
url/web_url/html_url
```

`code`、`key`、`id` 或 `number` 至少要有一个；否则 Flowlark 会拒绝导入，错误码为 `REQUIREMENT_REMOTE_INVALID`。

## 验收命令

真实平台验收必须使用一次性测试项目和安全测试需求：

```bash
FLOWLARK_V075_MANIFEST=/path/to/requirement-pool.json \
FLOWLARK_V075_QUERY="safe test requirement" \
FLOWLARK_V075_SECRET_DEMAND_POOL_MCP="token-if-manifest-uses-secret" \
npm run smoke:v075:requirement-pool -- --keep --output .flowlark/cache/v075-requirement-pool-smoke.json
```

只校验配置合同、不连接真实平台：

```bash
npm run smoke:v075:requirement-pool -- \
  --manifest docs/examples/requirement-pool-manifest.example.json \
  --inspect-only
```

如果 manifest 使用 `${secret:demand-pool-mcp}`，smoke 脚本会推导出环境变量名 `FLOWLARK_V075_SECRET_DEMAND_POOL_MCP`，并在一次性仓库中临时替换为 `${env:FLOWLARK_V075_SECRET_DEMAND_POOL_MCP}`。密钥值不会写入 `mcp.json`。

设置页浏览器验收：

```bash
npm run build:web
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
npm run smoke:v075:mcp-ui -- --output .flowlark/cache/v075-mcp-ui-smoke.json
```

该浏览器 smoke 覆盖模板加载、manifest 预检/导入、缺失本机密钥提示、环境变量密钥连接测试、页面错误和桌面/移动端横向溢出。它不会点击本机钥匙串保存动作。

真实平台 smoke 会在正式交付后读取交付快照，并校验需求池来源摘要已冻结 `code`、`title`、`source`、`provider`、`key`、`status`、`syncedAt`，以及平台返回的来源 URL。

最终发布前可以运行只读门禁，确认 manifest、凭据环境变量、真实 smoke 结果文件、浏览器 smoke 入口和版本号都已满足。真实平台与浏览器 smoke 证据齐全后，先跑 `pre-bump`；它通过后再把版本号提升到 `0.7.5`，并跑 `final`：

```bash
FLOWLARK_V075_MANIFEST=/path/to/requirement-pool.json \
FLOWLARK_V075_SMOKE_RESULT=.flowlark/cache/v075-requirement-pool-smoke.json \
FLOWLARK_V075_UI_SMOKE_RESULT=.flowlark/cache/v075-mcp-ui-smoke.json \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
npm run check:v075:readiness -- --phase pre-bump

FLOWLARK_V075_MANIFEST=/path/to/requirement-pool.json \
FLOWLARK_V075_SMOKE_RESULT=.flowlark/cache/v075-requirement-pool-smoke.json \
FLOWLARK_V075_UI_SMOKE_RESULT=.flowlark/cache/v075-mcp-ui-smoke.json \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
npm run check:v075:readiness -- --phase final
```

## v0.7.5 完成标准

以下条件全部满足后，才能把需求池 MCP 接入视为通过 v0.7.5 验收：

- 平台方 manifest 通过 `/api/mcp/requirement-pool/inspect` 且没有 blockers。
- 本机密钥或环境变量配置完成，`/api/mcp/requirement-pool/status` 的连接测试通过。
- `刷新需求池列表` 能创建或更新至少一条测试需求。
- 单条需求详情刷新成功；失败时能保留旧数据并显示脱敏错误。
- 测试需求可关联到原型版本，并加入迭代范围。
- 正式交付快照冻结了需求池来源摘要。
- `npm run smoke:v075:requirement-pool -- --keep` 在真实测试平台跑通。
- `npm run smoke:v075:mcp-ui` 在安装 Playwright 的本机跑通。
- 保存真实平台 smoke 和浏览器 smoke 结果后，`npm run check:v075:readiness -- --phase pre-bump` 通过；完成最终版本号提升后，`npm run check:v075:readiness -- --phase final` 通过。
