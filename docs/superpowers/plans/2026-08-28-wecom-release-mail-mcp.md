# WeCom Release Mail MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an idempotent “formal release” workflow that sets a baseline, synchronizes Git, and sends a project-templated release email through an automatically managed local WeCom MCP sidecar.

**Architecture:** Keep release configuration and queue logic in focused core modules, expose WeCom contact/mail operations through a loopback-only stateless MCP child process, and inject that runtime endpoint into `Hub`. The React project editor owns shared templates, while a dedicated formal-release dialog performs preflight, recipient disambiguation, preview, execution, and mail-only retry.

**Tech Stack:** Node.js 18+ ESM, built-in HTTP/child-process/fs/crypto APIs, existing Flowlark JSON-RPC client, React 19, Ant Design 6, Node test runner, Vite.

---

## File map

- Create `src/core/release-mail.js`: project release-mail normalization, template rendering, safe queue persistence, idempotency, and public-result sanitization.
- Create `src/core/wecom-mcp-manager.js`: start/stop the local child process and expose its authenticated runtime endpoint.
- Create `src/mcp/wecom-tools.js`: `wecom-cli` command adapter for auth, contact resolution, and Markdown mail sending.
- Create `src/mcp/wecom-server.js`: loopback HTTP MCP protocol endpoint and tool registry.
- Modify `src/core/service.js`: dependency injection, project config persistence, preflight, orchestration, list, and retry methods.
- Modify `src/server/index.js`: start and stop the sidecar with the two existing HTTP servers.
- Modify `src/server/routes.js`: formal-release and release-mail queue routes.
- Modify `src/core/integrations/mcp-jsonrpc.js`: preserve structured MCP error details and actionable hints.
- Create `test/release-mail.test.js`: core config, templates, queue, idempotency, and orchestration tests.
- Create `test/wecom-mcp.test.js`: MCP protocol, authentication, CLI command, temporary-file, and lifecycle tests.
- Modify `test/project-edit-api.test.js`: project release-mail config persistence and formal-release API contracts.
- Modify `web/src/pages/projectsModel.js` and `web/src/pages/projectsModel.test.js`: form/payload normalization for shared email settings.
- Modify `web/src/pages/Projects.tsx`: project-level recipients and custom template fields.
- Create `web/src/components/formalReleaseModel.js` and `web/src/components/formalReleaseModel.test.js`: recipient edits, candidate selection, preview, and result-state helpers.
- Create `web/src/components/FormalReleaseDialog.tsx`: accessible formal release workflow.
- Modify `web/src/pages/ProjectVersions.tsx`: open the formal-release dialog for the selected version and reload after success.
- Modify `web/src/services/api.ts`: typed API calls for preflight, execution, queue listing, and retry.
- Modify `web/src/styles/global.css`: compact responsive dialog styles only.
- Modify `README.md`: document prerequisites, authorization, project setup, and test-enterprise warning.

### Task 1: Release mail configuration, templates, and durable queue

**Files:**
- Create: `src/core/release-mail.js`
- Test: `test/release-mail.test.js`
- Modify: `src/core/projects.js`

- [x] **Step 1: Write failing normalization and template tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeReleaseMail, renderReleaseMail } from '../src/core/release-mail.js'

test('normalizes project release mail without reordering names', () => {
  assert.deepEqual(normalizeReleaseMail({
    enabled: true,
    to: [' 张三 ', '李四', '张三'],
    cc: [' 王五 '],
    subjectTemplate: '【发版】{{project}} {{version}}',
    bodyTemplate: '# {{project}}\n\n{{changes}}'
  }), {
    enabled: true,
    to: ['张三', '李四'],
    cc: ['王五'],
    subjectTemplate: '【发版】{{project}} {{version}}',
    bodyTemplate: '# {{project}}\n\n{{changes}}'
  })
})

test('renders only supported release variables', () => {
  const rendered = renderReleaseMail({
    subjectTemplate: '【发版】{{project}} {{version}}',
    bodyTemplate: '{{changes}}\n\n{{requirements}}'
  }, {
    project: '订单中心', version: 'v2', changes: '- 修改筛选', requirements: '- REQ-2'
  })
  assert.equal(rendered.subject, '【发版】订单中心 v2')
  assert.equal(rendered.markdown, '- 修改筛选\n\n- REQ-2')
  assert.throws(() => renderReleaseMail({ subjectTemplate: '{{secret}}', bodyTemplate: 'x' }, {}), /未知变量/)
})
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run: `node --test test/release-mail.test.js`

Expected: FAIL because `src/core/release-mail.js` does not exist.

- [x] **Step 3: Implement release-mail normalization and rendering**

```js
const VARIABLES = new Set([
  'project', 'projectCode', 'version', 'title', 'previousBaseline',
  'releasedAt', 'releasedBy', 'changes', 'requirements'
])

function names(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 100)
}

export function normalizeReleaseMail(input = {}) {
  return {
    enabled: input.enabled === true,
    to: names(input.to),
    cc: names(input.cc),
    subjectTemplate: String(input.subjectTemplate || '').slice(0, 500),
    bodyTemplate: String(input.bodyTemplate || '').slice(0, 50000)
  }
}

function interpolate(template, context) {
  return String(template || '').replace(/\{\{([A-Za-z]+)\}\}/g, (raw, key) => {
    if (!VARIABLES.has(key)) throw new Error(`发版邮件模板包含未知变量：${key}`)
    return String(context[key] ?? '')
  })
}

export function renderReleaseMail(config, context) {
  const subject = interpolate(config.subjectTemplate, context).trim()
  const markdown = interpolate(config.bodyTemplate, context).trim()
  if (!subject) throw new Error('发版邮件主题不能为空')
  if (!markdown) throw new Error('发版邮件正文不能为空')
  return { subject, markdown }
}
```

Add `normalizeReleaseMail` to project creation/update paths so `project.json.releaseMail` is always normalized.

- [x] **Step 4: Add queue tests and implementation**

Test the stable ID, duplicate enqueue, pending-to-sent transition, retry attempts, and public sanitization. Implement `enqueueReleaseMail`, `listReleaseMails`, `markReleaseMailSent`, `markReleaseMailFailed`, `readReleaseMail`, and `publicReleaseMail` in `src/core/release-mail.js`, storing `{ schemaVersion: 1, items: [] }` at `.flowlark/cache/release-mails.json` with atomic rename writes.

```js
const first = enqueueReleaseMail(root, {
  project: 'orders', version: 'v2', baselineAt: '2026-08-28T10:00:00.000Z',
  subject: '发版 v2', markdown: '正文', to: [{ name: '张三', userid: 'wo1' }], cc: []
})
const second = enqueueReleaseMail(root, {
  project: 'orders', version: 'v2', baselineAt: '2026-08-28T10:00:00.000Z',
  subject: '发版 v2', markdown: '正文', to: [{ name: '张三', userid: 'wo1' }], cc: []
})
assert.equal(first.id, second.id)
assert.equal(listReleaseMails(root).length, 1)
assert.equal('userid' in publicReleaseMail(first).to[0], false)
```

- [x] **Step 5: Run focused tests**

Run: `node --test test/release-mail.test.js test/projects.test.js`

Expected: all release-mail and existing project tests pass.

- [x] **Step 6: Commit the core model**

```bash
git add src/core/release-mail.js src/core/projects.js src/core/service.js test/release-mail.test.js test/projects.test.js
git commit -m "feat: add release mail model and queue"
```

### Task 2: WeCom CLI tools behind a real MCP endpoint

**Files:**
- Create: `src/mcp/wecom-tools.js`
- Create: `src/mcp/wecom-server.js`
- Test: `test/wecom-mcp.test.js`

- [x] **Step 1: Write failing CLI-adapter tests**

Inject a command runner and assert exact argument arrays without a shell:

```js
const calls = []
const tools = createWecomTools({
  command: 'wecom-cli',
  run: async (command, args) => {
    calls.push({ command, args })
    if (args[0] === '--version') return { stdout: 'wecom-cli 1.1.0 (npm)' }
    if (args[0] === 'auth') return { stdout: 'authorized\n' }
    if (args[0] === 'contact') return { stdout: JSON.stringify({ users: [{ userid: 'wo1', name: '张三', departments: ['产品'] }] }) }
    return { stdout: JSON.stringify({ mail_id: 'hidden' }) }
  }
})
assert.equal((await tools.authStatus()).authorized, true)
assert.equal((await tools.resolveContacts({ names: ['张三'] })).results[0].status, 'unique')
```

- [x] **Step 2: Implement `wecom-tools.js`**

Use `execFile`, JSON-only stdout parsing, a minimum CLI version of `1.1.0`, one contact query per name, and a random `0600` Markdown file under `os.tmpdir()`. Always remove the file in `finally`; preserve `error.message` and `error.instruction`, but remove `code`, `callid`, `mail_id`, Bot ID, and tokens from returned values.

- [x] **Step 3: Write failing MCP protocol tests**

Start the server on port `0` and assert:

```js
const initialized = await rpc(baseUrl, token, 'initialize', {
  protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' }
})
assert.equal(initialized.result.serverInfo.name, 'flowlark-wecom')
const listed = await rpc(baseUrl, token, 'tools/list', {})
assert.deepEqual(listed.result.tools.map((tool) => tool.name), [
  'wecom_auth_status', 'wecom_contacts_resolve', 'wecom_release_mail_send'
])
assert.equal((await fetch(baseUrl, { method: 'POST' })).status, 401)
```

- [x] **Step 4: Implement `wecom-server.js`**

Implement an ESM entrypoint and exported `startWecomMcpServer` using built-in `http`. Require `Authorization: Bearer <runtime token>`, reject bodies above 1 MB, return JSON-RPC errors, and support `initialize`, `ping`, `tools/list`, and `tools/call`. Return both `content: [{ type: 'text', text: JSON.stringify(value) }]` and `structuredContent: value` for successful tools.

- [x] **Step 5: Verify protocol and cleanup behavior**

Run: `node --test test/wecom-mcp.test.js`

Expected: protocol, unauthorized request, tool annotations, CLI arguments, error sanitization, and temporary-file deletion tests all pass.

- [x] **Step 6: Commit the MCP server**

```bash
git add src/mcp/wecom-tools.js src/mcp/wecom-server.js test/wecom-mcp.test.js
git commit -m "feat: expose WeCom mail through local MCP"
```

### Task 3: Sidecar lifecycle and MCP client error fidelity

**Files:**
- Create: `src/core/wecom-mcp-manager.js`
- Modify: `src/core/integrations/mcp-jsonrpc.js`
- Modify: `src/server/index.js`
- Test: `test/wecom-mcp.test.js`
- Test: `test/server.test.js`

- [x] **Step 1: Write lifecycle tests**

Assert the manager starts the child on a random loopback port, reports `{ baseUrl, headers }`, rejects an invalid ready message, times out with a readable degraded status, and terminates the child during `close()`.

- [x] **Step 2: Implement the manager**

Generate a 32-byte token with `crypto.randomBytes`, spawn `process.execPath` with `src/mcp/wecom-server.js`, pass `FLOWLARK_WECOM_MCP_TOKEN`, `FLOWLARK_WECOM_MCP_PORT=0`, and the configured CLI command, and consume exactly one JSON ready line from stdout. Keep stderr bounded for diagnosis and never log the token.

- [x] **Step 3: Integrate lifecycle with `startServer`**

Start the sidecar before building API routes, pass its MCP config into the `Hub` runtime, and include sidecar shutdown in the existing `close()` promise. A sidecar startup failure must return a disabled runtime adapter rather than reject `startServer`.

- [x] **Step 4: Preserve MCP error instructions**

Extend `callTool` so a tool error containing structured `{ message, instruction }` becomes a `PhError` with the message and hint. Add a test that `code`, `callid`, and internal IDs do not appear in the resulting message.

- [x] **Step 5: Run lifecycle and regression tests**

Run: `node --test test/wecom-mcp.test.js test/server.test.js test/mcp-config.test.js`

Expected: all tests pass and every server test closes the sidecar child.

- [x] **Step 6: Commit lifecycle support**

```bash
git add src/core/wecom-mcp-manager.js src/core/integrations/mcp-jsonrpc.js src/server/index.js test/wecom-mcp.test.js test/server.test.js
git commit -m "feat: manage WeCom MCP sidecar lifecycle"
```

### Task 4: Formal release orchestration and API

**Files:**
- Modify: `src/core/service.js`
- Modify: `src/server/routes.js`
- Modify: `test/release-mail.test.js`
- Modify: `test/project-edit-api.test.js`

- [x] **Step 1: Add dependency injection and failing orchestration tests**

Allow `new Hub(root, { wecomMcp, gitSync })` while preserving existing callers. Inject fakes and record order:

```js
const order = []
const hub = new Hub(root, {
  wecomMcp: {
    authStatus: async () => ({ installed: true, authorized: true }),
    resolveContacts: async ({ names }) => ({ results: names.map((name) => ({ query: name, status: 'unique', candidate: { name, userid: `wo-${name}` } })) }),
    sendReleaseMail: async () => { order.push('mail'); return { ok: true } }
  },
  gitSync: () => { order.push('git'); return { ok: true, pushed: true } }
})
hub.setBaseline = new Proxy(hub.setBaseline, { apply(target, thisArg, args) { order.push('baseline'); return Reflect.apply(target, thisArg, args) } })
await hub.formalRelease('orders', 'v2', request)
assert.deepEqual(order, ['baseline', 'git', 'mail'])
```

- [x] **Step 2: Implement preflight**

Add `preflightFormalRelease(slug, versionNo, input)` that reuses existing baseline rules, validates Git identity/remote/conflicts, calls auth and contact tools, renders the frozen preview, and returns `{ ready, blockers, warnings, releasedAt, recipients, subject, markdown }`. It performs no project, baseline, Git, or queue writes.

- [x] **Step 3: Implement execution and retry**

Add `formalRelease`, `listReleaseMails`, and `retryReleaseMail`. Execution must revalidate, allow the already-target-baseline continuation case, call the injected Git sync, enqueue before sending, and mark `sent` or retain `pending`. Retry must reject a changed baseline and call only the mail tool.

- [x] **Step 4: Add route contracts**

Register:

```text
POST /api/versions/:slug/:no/formal-release/preflight
POST /api/versions/:slug/:no/formal-release
GET  /api/release-mails
POST /api/release-mails/:id/retry
```

Return `200` for preflight/execution/retry and sanitize all release-mail output before `sendJson`.

- [x] **Step 5: Verify failure semantics**

Tests must prove: preflight is read-only; Git failure never calls mail; mail failure keeps the baseline and queue item; Git continuation skips baseline; mail retry skips Git; duplicate success does not send twice; changed baseline blocks retry; project config persists through the existing update API.

Run: `node --test test/release-mail.test.js test/project-edit-api.test.js test/mcp-config.test.js`

Expected: all focused tests pass.

- [x] **Step 6: Commit the release API**

```bash
git add src/core/service.js src/server/routes.js test/release-mail.test.js test/project-edit-api.test.js
git commit -m "feat: add formal release orchestration"
```

### Task 5: Project-level email settings UI

**Files:**
- Modify: `web/src/pages/projectsModel.js`
- Modify: `web/src/pages/projectsModel.test.js`
- Modify: `web/src/pages/Projects.tsx`

- [x] **Step 1: Write failing model tests**

```js
assert.deepEqual(initialProjectValues({ releaseMail: {
  enabled: true, to: ['张三'], cc: ['李四'], subjectTemplate: '主题', bodyTemplate: '正文'
} }).releaseMail, {
  enabled: true, to: ['张三'], cc: ['李四'], subjectTemplate: '主题', bodyTemplate: '正文'
})
assert.deepEqual(projectPayload({
  name: '订单', code: 'ORDERS', releaseMail: {
    enabled: true, to: [' 张三 ', '张三'], cc: [], subjectTemplate: '主题', bodyTemplate: '正文'
  }
}).releaseMail.to, ['张三'])
```

- [x] **Step 2: Implement model normalization**

Keep release mail nested under `releaseMail`, trim/dedupe names, and preserve disabled templates. Do not change unrelated project filtering or code validation.

- [x] **Step 3: Add the project editor fields**

Use an Ant Design `Switch`, `Select mode="tags"` for recipient names, an `Input` for subject, and `Input.TextArea` for Markdown. Require at least one recipient, a subject, and a body only when enabled. Show the supported variable names below the template field.

- [x] **Step 4: Run model and build checks**

Run: `node --test web/src/pages/projectsModel.test.js && npm --prefix web run build`

Expected: model tests pass and Vite exits 0.

- [x] **Step 5: Commit project settings UI**

```bash
git add web/src/pages/projectsModel.js web/src/pages/projectsModel.test.js web/src/pages/Projects.tsx
git commit -m "feat: configure project release mail"
```

### Task 6: Formal release dialog and project versions integration

**Files:**
- Create: `web/src/components/formalReleaseModel.js`
- Create: `web/src/components/formalReleaseModel.test.js`
- Create: `web/src/components/FormalReleaseDialog.tsx`
- Modify: `web/src/pages/ProjectVersions.tsx`
- Modify: `web/src/services/api.ts`
- Modify: `web/src/styles/global.css`

- [x] **Step 1: Write failing dialog-model tests**

Test name list normalization, candidate selection keyed by query, `ready` derivation, mail-failure result labels, and hidden internal IDs:

```js
const state = applyCandidate(emptyRecipientState(['张三']), '张三', { key: 'candidate-1', name: '张三', departments: ['产品'] })
assert.equal(state.selections['张三'].key, 'candidate-1')
assert.equal(releaseOutcome({ released: true, mail: { status: 'pending' } }).kind, 'mail-pending')
```

- [x] **Step 2: Add API methods**

Add `preflightFormalRelease`, `formalRelease`, `listReleaseMails`, and `retryReleaseMail` using the exact routes from Task 4. Follow existing `request` error handling and do not add a second HTTP client.

- [x] **Step 3: Implement `FormalReleaseDialog`**

The dialog must load project defaults, allow one-off recipient changes, debounce or explicitly run preflight, render candidate radio choices, show subject and Markdown preview, disable confirmation until `ready`, lock controls during execution, and show the four result states from the design. It must never render `userid`, `mail_id`, Bot ID, or tokens.

- [x] **Step 4: Integrate without changing existing baseline behavior**

Add a “正式发版” action beside the existing baseline action for non-void versions. Keep “设为基线” available as the lower-level action. On release completion, clear the selected-version cache and call the existing page/planning reload functions.

- [x] **Step 5: Add responsive styles**

Use a single-column layout below 700 px, allow long department paths and Markdown lines to wrap, and keep action buttons reachable at 390 px. Do not restyle unrelated pages.

- [x] **Step 6: Run UI-focused checks**

Run: `node --test web/src/components/formalReleaseModel.test.js web/src/pages/projectsModel.test.js web/src/pages/projectVersionsModel.test.js && npm --prefix web run build`

Expected: all model tests pass and Vite exits 0.

- [x] **Step 7: Commit the formal release UI**

```bash
git add web/src/components/formalReleaseModel.js web/src/components/formalReleaseModel.test.js web/src/components/FormalReleaseDialog.tsx web/src/pages/ProjectVersions.tsx web/src/services/api.ts web/src/styles/global.css
git commit -m "feat: add formal release workflow UI"
```

### Task 7: Documentation, full verification, and completion audit

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-28-wecom-release-mail-mcp.md`

- [x] **Step 1: Document safe setup**

Add commands and behavior:

```bash
npm install -g @wecom/cli
wecom-cli auth init
wecom-cli auth show --status
```

Explain project recipients/templates, the formal release order, mail-only retry, test-enterprise recommendation, and that Flowlark never stores the Bot Secret.

- [x] **Step 2: Run formatting and focused security scans**

Run:

```bash
git diff --check
rg -n "mail_id|userid|BOT_SECRET|WECOM.*TOKEN" src web/src test README.md
```

Expected: no whitespace errors; sensitive names occur only in internal adapters, sanitizers, and explicit non-rendering tests.

- [x] **Step 3: Run the complete backend suite**

Run: `npm test`

Expected: every Node test passes.

- [x] **Step 4: Run the complete web verification**

Run: `node --test web/src/**/*.test.js && npm --prefix web run build`

Expected: every web model test passes and Vite exits 0.

- [x] **Step 5: Run fake-CLI end-to-end verification**

Start Flowlark with a temporary repository and fake `wecom-cli`, execute project configuration, preflight, formal release, failed mail, and retry through HTTP, and assert the fake command log contains contact search followed by exactly one successful `mail send`. Confirm no network request reaches real WeCom.

- [x] **Step 6: Audit every completion criterion**

Record evidence for sidecar lifecycle, loopback binding, project config, name ambiguity blocking, exact operation order, retry idempotency, secret/ID non-disclosure, full tests, and web build. Leave the task active if any criterion lacks direct evidence.

- [x] **Step 7: Commit documentation and verification updates**

```bash
git add README.md docs/superpowers/plans/2026-08-28-wecom-release-mail-mcp.md
git commit -m "docs: explain WeCom formal release mail"
```
