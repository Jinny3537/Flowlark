# Assess Task MCP Iteration Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flowlark the source of truth for a complete iteration lifecycle synchronized through the supplied local `assess-task-mcp` stdio server.

**Architecture:** Add an official-SDK-backed stdio session behind a transport-neutral MCP client manager, then place an `assess-task` semantic adapter and a plan/confirm/execute/verify synchronization service above it. Extend milestone and requirement files only with stable business state and external bindings; keep binary paths, accounts, execution journals, and credentials machine-local.

**Tech Stack:** Node.js 20+, ESM, `@modelcontextprotocol/client` 2.0.0, built-in `node:test`, existing local HTTP server, React 19, Ant Design 6.

---

## Execution scope

This plan implements design phases P0 through P3 and prepares the P4 live checklist. P4 cannot pass until a writable disposable platform project and test account are available. Do not run the supplied executable during automated tests.

Existing unrelated worktree changes must remain untouched. Stage and commit only files named by the current task.

## File map

New focused backend files:

- `src/core/integrations/mcp-client.js`: transport-neutral connection and call interface.
- `src/core/mcp-runtime.js`: machine-local stdio runtime profiles, executable diagnostics, and credentials.
- `src/core/integrations/assess-task/contract.js`: semantic operation keys and discovered-schema validation.
- `src/core/integrations/assess-task/adapter.js`: platform request/response normalization.
- `src/core/milestone-lifecycle.js`: lifecycle states, transitions, and freeze preflight.
- `src/core/milestone-sync-plan.js`: ownership-aware deterministic synchronization plans.
- `src/core/milestone-sync-journal.js`: secret-free resumable execution journal.
- `src/core/milestone-sync.js`: confirmed plan execution and remote verification.

New focused frontend files:

- `web/src/pages/settings/McpRuntimeFields.tsx`: stdio-specific local runtime editor and diagnostics.
- `web/src/pages/milestoneSyncModel.js`: plan/status presentation helpers.
- `web/src/pages/milestoneSyncModel.test.js`: UI model coverage.

Existing files retain their current responsibilities:

- `src/core/mcp-config.js`: Git-tracked logical MCP configuration.
- `src/core/milestones.js` and `src/core/requirements.js`: stable domain persistence.
- `src/core/service.js`: permission-checked application facade.
- `src/server/routes.js`: local HTTP endpoints.
- `web/src/pages/settings/McpSection.tsx`: settings composition.
- `web/src/pages/Milestones.tsx` and `web/src/pages/MilestoneDetail.tsx`: iteration UI.

## Task 1: Runtime floor and official MCP dependency

**Files:**
- Modify: `package.json`
- Create: `package-lock.json`
- Verify: `.nvmrc`

- [ ] **Step 1: Assert the declared Node floor is stale**

Run:

```bash
node -e "const p=require('./package.json'); if(p.engines.node!=='>=18.17') process.exit(1)"
```

Expected: exit 0 before the change.

- [ ] **Step 2: Install the exact official client version**

Run:

```bash
npm install @modelcontextprotocol/client@2.0.0 --save-exact
```

Expected: `package-lock.json` is created and `package.json` contains an exact `2.0.0` dependency.

- [ ] **Step 3: Raise the runtime floor**

Change:

```json
"engines": {
  "node": ">=20"
}
```

Keep `.nvmrc` equal to `20`.

- [ ] **Step 4: Verify manifest and package resolution**

Run:

```bash
node -e "const p=require('./package.json'); if(p.engines.node!=='>=20'||p.dependencies['@modelcontextprotocol/client']!=='2.0.0') process.exit(1)"
npm ls @modelcontextprotocol/client
```

Expected: both commands exit 0 and report `@modelcontextprotocol/client@2.0.0`.

- [ ] **Step 5: Commit the runtime boundary**

```bash
git add package.json package-lock.json .nvmrc
git commit -m "build: add official MCP client runtime"
```

## Task 2: MCP client manager and stdio protocol tests

**Files:**
- Create: `src/core/integrations/mcp-client.js`
- Create: `test/fixtures/fake-mcp-server.js`
- Create: `test/mcp-client.test.js`
- Modify: `src/core/integrations/mcp-jsonrpc.js`

- [ ] **Step 1: Write a fake stdio server fixture**

The fixture is a dependency-free legacy-handshake MCP server with deterministic tools. It keeps the production dependency surface limited to the client package:

```js
import readline from 'node:readline'

const tools = [
  { name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'fail', description: 'fail', inputSchema: { type: 'object', properties: {} } }
]

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    return send(message.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'flowlark-test', version: '1.0.0' }
    })
  }
  if (message.method === 'tools/list') return send(message.id, { tools })
  if (message.method === 'tools/call' && message.params.name === 'echo') {
    return send(message.id, {
      content: [{ type: 'text', text: JSON.stringify({ value: message.params.arguments.value }) }],
      structuredContent: { value: message.params.arguments.value }
    })
  }
  if (message.method === 'tools/call' && message.params.name === 'fail') {
    return send(message.id, { isError: true, content: [{ type: 'text', text: 'fixture failure' }] })
  }
  if (message.id !== undefined) send(message.id, {})
})
```

- [ ] **Step 2: Write failing client-manager tests**

Cover the public interface:

```js
const manager = createMcpClientManager()
const session = await manager.connect({
  type: 'stdio',
  command: process.execPath,
  args: [FIXTURE],
  env: { FIXTURE_SECRET: 'hidden' },
  timeoutMs: 1000
})
const tools = await session.listTools()
assert.ok(tools.some((tool) => tool.name === 'echo'))
assert.deepEqual(await session.callTool('echo', { value: 'ok' }), { value: 'ok' })
await assert.rejects(session.callTool('fail', {}), (error) => error.code === 'MCP_TOOL_ERROR')
await session.close()
```

Also assert timeout, child exit, invalid message, stderr truncation/redaction, concurrent request correlation, and close idempotency.

- [ ] **Step 3: Run the tests and confirm failure**

Run:

```bash
node --test test/mcp-client.test.js
```

Expected: FAIL because `mcp-client.js` does not exist.

- [ ] **Step 4: Implement the manager**

Export:

```js
export function createMcpClientManager({ legacyHttpCall = callLegacyHttpTool } = {})
```

For `stdio`, construct `Client` with `{ versionNegotiation: { mode: 'legacy' } }` and `StdioClientTransport`, connect once, and return:

```js
{
  serverInfo,
  listTools: () => client.listTools().then((result) => result.tools || []),
  callTool: (name, args) => callAndNormalize(client, name, args, timeoutMs),
  close: () => client.close()
}
```

For existing `http` and `sse` configurations, call the existing `mcp-jsonrpc.js` function through the same session interface so current non-handshaking test servers remain compatible.

Normalize results in one place:

```js
function normalizeCallResult(result) {
  if (result?.isError) throw err.bad('MCP_TOOL_ERROR', toolErrorText(result))
  if (result?.structuredContent !== undefined) return result.structuredContent
  const text = result?.content?.find((item) => item?.type === 'text')?.text
  if (looksJson(text)) return JSON.parse(text)
  return text == null ? result : { text }
}
```

- [ ] **Step 5: Pass focused and existing HTTP tests**

Run:

```bash
node --test test/mcp-client.test.js test/mcp-config.test.js test/v07-upgrade.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit transport foundation**

```bash
git add src/core/integrations/mcp-client.js src/core/integrations/mcp-jsonrpc.js test/fixtures/fake-mcp-server.js test/mcp-client.test.js
git commit -m "feat: add stdio MCP client sessions"
```

## Task 3: Machine-local runtime profiles and executable diagnostics

**Files:**
- Create: `src/core/mcp-runtime.js`
- Create: `test/mcp-runtime.test.js`
- Modify: `src/core/secrets.js`
- Modify: `src/core/service.js`
- Modify: `src/server/routes.js`

- [ ] **Step 1: Write failing runtime-profile tests**

Use a temporary `FLOWLARK_HOME` and assert:

```js
saveRuntimeProfile(root, 'assess-task-local', {
  command: '/opt/assess-task-mcp',
  args: [],
  baseUrl: 'https://assess.example.com',
  account: 'tester',
  expectedSha256: 'a'.repeat(64)
})
const profile = getRuntimeProfile(root, 'assess-task-local')
assert.equal(profile.account, 'tester')
assert.equal(profile.passwordStored, false)
assert.equal(JSON.stringify(profile).includes('password'), false)
```

Add diagnostic cases for missing file, non-file, missing execute permission, SHA mismatch, architecture mismatch, and unsigned macOS executable warning.

- [ ] **Step 2: Confirm tests fail**

Run:

```bash
node --test test/mcp-runtime.test.js
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement local storage**

Store profiles in `$FLOWLARK_HOME/mcp-runtime.json`, keyed by canonical workspace path and runtime profile ID. Write through a temporary sibling plus rename and apply mode `0o600`.

Export:

```js
export function listRuntimeProfiles(root)
export function getRuntimeProfile(root, id)
export function saveRuntimeProfile(root, id, input)
export function removeRuntimeProfile(root, id)
export function diagnoseExecutable(profile)
export function runtimeEnvironment(root, id)
export function setRuntimePassword(root, id, password)
export function deleteRuntimePassword(root, id)
```

`runtimeEnvironment` returns only:

```js
{
  ASSESS_BASE_URL: profile.baseUrl,
  ASSESS_ACCOUNT: profile.account,
  ASSESS_PASSWORD: storedPassword
}
```

- [ ] **Step 4: Add permission-checked service and HTTP methods**

Add service methods for inspect/save/remove/diagnose/password operations and routes:

```text
GET    /api/mcp/runtime/:id
PUT    /api/mcp/runtime/:id
DELETE /api/mcp/runtime/:id
POST   /api/mcp/runtime/:id/diagnose
PUT    /api/mcp/runtime/:id/password
DELETE /api/mcp/runtime/:id/password
```

Never return the password or injected environment.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test test/mcp-runtime.test.js test/server.test.js test/mcp-config.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit runtime profiles**

```bash
git add src/core/mcp-runtime.js src/core/secrets.js src/core/service.js src/server/routes.js test/mcp-runtime.test.js
git commit -m "feat: store local MCP runtime profiles"
```

## Task 4: Logical MCP schema version 2

**Files:**
- Modify: `src/core/mcp-config.js`
- Modify: `src/core/json.js`
- Modify: `test/mcp-config.test.js`

- [ ] **Step 1: Add failing schema-normalization tests**

Assert that a stdio server round-trips:

```js
{
  id: 'assess-task-local',
  name: '研发任务管理',
  type: 'stdio',
  adapter: 'assess-task',
  runtimeProfile: 'assess-task-local',
  timeoutMs: 15000,
  enabled: true
}
```

Assert that schema-1 HTTP configuration normalizes without losing URL/headers and that stdio validation rejects a missing adapter or runtime profile without requiring a URL.

- [ ] **Step 2: Confirm tests fail**

Run:

```bash
node --test test/mcp-config.test.js
```

Expected: FAIL on stdio normalization.

- [ ] **Step 3: Implement schema version 2**

Make `defaultMcpConfig().schemaVersion` equal `2`. Normalize servers by transport:

```js
{
  id,
  name,
  type: ['http', 'sse', 'stdio'].includes(input.type) ? input.type : 'http',
  adapter: String(input.adapter || ''),
  runtimeProfile: String(input.runtimeProfile || ''),
  enabled: input.enabled !== false,
  url: type === 'stdio' ? '' : String(input.url || ''),
  timeoutMs,
  headers: type === 'stdio' ? {} : normalizeHeaders(input.headers)
}
```

`resolveCapability()` returns a resolved server plus runtime-profile ID but never expands credentials.

- [ ] **Step 4: Pass focused tests**

Run:

```bash
node --test test/mcp-config.test.js test/v07-upgrade.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit logical configuration**

```bash
git add src/core/mcp-config.js src/core/json.js test/mcp-config.test.js
git commit -m "feat: support stdio MCP server configuration"
```

## Task 5: Assess Task contract and read-only adapter

**Files:**
- Create: `src/core/integrations/assess-task/contract.js`
- Create: `src/core/integrations/assess-task/adapter.js`
- Create: `test/assess-task-adapter.test.js`
- Modify: `src/core/integrations/milestones/index.js`

- [ ] **Step 1: Define fixture tool mappings and responses in tests**

Use semantic keys:

```js
export const ASSESS_OPERATIONS = [
  'currentUser', 'listProjects', 'projectCapabilities', 'listMembers',
  'listSprints', 'getSprint', 'listTasks', 'getTask',
  'saveSprint', 'createTask', 'updateTask', 'moveTasks',
  'startSprint', 'endSprint', 'cancelSprint'
]
```

The fake session records tool name and arguments and returns response fixtures with nested `data`, `items`, `records`, and direct-object variants.

- [ ] **Step 2: Write failing contract and normalization tests**

Verify:

```js
const adapter = createAssessTaskAdapter({ session, tools, projectId: 123 })
assert.equal((await adapter.probe()).account, 'tester')
assert.equal((await adapter.listProjects())[0].id, 123)
assert.equal((await adapter.listSprints())[0].name, 'S12')
assert.equal((await adapter.listTasks({ sprintId: 9 }))[0].revision, 4)
```

Reject a missing operation, missing required input-schema field, and a non-numeric configured project ID.

- [ ] **Step 3: Confirm tests fail**

Run:

```bash
node --test test/assess-task-adapter.test.js
```

Expected: FAIL because the adapter is missing.

- [ ] **Step 4: Implement contract validation**

`validateAssessContract(tools, mapping, { write })` returns normalized operation descriptors and problems. Read-only mode requires current user/projects/capabilities/members/sprint/task queries. Write mode additionally requires all seven mutation operations.

Validate semantic required arguments against discovered JSON Schema, including nested `body` requirements.

- [ ] **Step 5: Implement read-only methods and provider registration**

Normalize IDs to numbers, retain revisions, and return stable shapes:

```js
{ id, name, title, status, revision, startAt, endAt, ownerId, raw }
{ id, code, title, status, revision, sprintId, assigneeId, raw }
```

Register provider name `assess-task` without changing the existing `mcp` provider.

- [ ] **Step 6: Pass tests**

Run:

```bash
node --test test/assess-task-adapter.test.js test/mcp-config.test.js test/milestones.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit the read-only adapter**

```bash
git add src/core/integrations/assess-task src/core/integrations/milestones/index.js test/assess-task-adapter.test.js
git commit -m "feat: add Assess Task MCP adapter"
```

## Task 6: Milestone lifecycle and external task bindings

**Files:**
- Create: `src/core/milestone-lifecycle.js`
- Create: `test/milestone-lifecycle.test.js`
- Modify: `src/core/milestones.js`
- Modify: `src/core/requirements.js`
- Modify: `src/core/json.js`
- Modify: `test/milestones.test.js`
- Modify: `test/requirements.test.js`

- [ ] **Step 1: Write failing default/migration tests**

Assert old files read as:

```js
{ goal: '', owner: '', status: 'planning', external: null }
```

Assert requirement `externalTasks` defaults to `[]`, is stable-sorted, and upserts uniquely by `provider + server + projectId`.

- [ ] **Step 2: Write failing transition tests**

Cover the exact allowed graph and errors:

```js
assert.equal(transition('planning', 'reviewing').to, 'reviewing')
assert.throws(() => transition('planning', 'active'), (error) => error.code === 'MILESTONE_TRANSITION_INVALID')
assert.throws(() => transition('archived', 'planning'), (error) => error.code === 'MILESTONE_TERMINAL')
```

Assert ordinary item edits are rejected while frozen/active/delivered/archived/canceled, while a system sync metadata patch remains allowed.

- [ ] **Step 3: Confirm tests fail**

Run:

```bash
node --test test/milestone-lifecycle.test.js test/milestones.test.js test/requirements.test.js
```

Expected: FAIL on missing lifecycle fields/functions.

- [ ] **Step 4: Implement lifecycle and persistence helpers**

Export:

```js
export const MILESTONE_STATUSES = new Set([
  'planning', 'reviewing', 'frozen', 'active', 'delivered', 'archived', 'canceled'
])
export function transitionMilestoneStatus(current, target, context = {})
export function freezePreflight(root, milestone, integration = {})
export function upsertExternalTask(root, code, binding)
```

Add `updateMilestone(root, name, patch, { system = false } = {})`; only system patches may change `external` without unlocking the business fields.

- [ ] **Step 5: Pass focused tests**

Run:

```bash
node --test test/milestone-lifecycle.test.js test/milestones.test.js test/requirements.test.js test/snapshots.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit domain state**

```bash
git add src/core/milestone-lifecycle.js src/core/milestones.js src/core/requirements.js src/core/json.js test/milestone-lifecycle.test.js test/milestones.test.js test/requirements.test.js
git commit -m "feat: add iteration lifecycle state"
```

## Task 7: Deterministic synchronization planner

**Files:**
- Create: `src/core/milestone-sync-plan.js`
- Create: `test/milestone-sync-plan.test.js`

- [ ] **Step 1: Write failing plan tests**

Build a milestone with duplicate requirement items and assert one task operation:

```js
const plan = await buildMilestoneSyncPlan(context)
assert.equal(plan.operations.filter((op) => op.kind === 'task.create').length, 1)
assert.equal(plan.summary.createTask, 1)
assert.match(plan.hash, /^sha256:/)
assert.equal(plan.blockers.length, 0)
```

Add cases for unchanged objects, updates, task moves, missing task-type mapping, unknown priority, missing member mapping warning, stale binding, remote drift, and start/end/cancel risk levels.

- [ ] **Step 2: Confirm tests fail**

Run:

```bash
node --test test/milestone-sync-plan.test.js
```

Expected: FAIL because the planner is missing.

- [ ] **Step 3: Implement stable projections and hashes**

Project only Flowlark-owned fields:

```js
function taskProjection(requirement, milestone, mapping) {
  return {
    projectId: mapping.projectId,
    taskType: mapping.taskType,
    title: `[${requirement.code}] ${requirement.title}`,
    descriptionDoc: renderDescription(requirement, milestone),
    acceptanceDoc: requirement.spec || '',
    priority: mapping.priorities[requirement.priority],
    assigneeId: mapping.members[requirement.owner] || null,
    planStartDate: toRemoteDate(milestone.startAt, mapping.timezone),
    planEndDate: toRemoteDate(requirement.dueDate || milestone.endAt, mapping.timezone)
  }
}
```

Sort requirements and operations by stable keys before hashing. A plan includes `generatedAt`, `expiresAt`, `hash`, `summary`, `blockers`, `warnings`, and dependency-ordered operations.

- [ ] **Step 4: Implement ownership-aware diffing**

Remote platform-owned fields never appear in update patches. A changed remote Flowlark-owned field produces `conflict` unless `resolution` explicitly selects `restore-local` or `accept-remote`.

- [ ] **Step 5: Pass tests**

Run:

```bash
node --test test/milestone-sync-plan.test.js test/milestone-lifecycle.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the planner**

```bash
git add src/core/milestone-sync-plan.js test/milestone-sync-plan.test.js
git commit -m "feat: plan iteration MCP synchronization"
```

## Task 8: Resumable executor and journal

**Files:**
- Create: `src/core/milestone-sync-journal.js`
- Create: `src/core/milestone-sync.js`
- Create: `test/milestone-sync.test.js`

- [ ] **Step 1: Write failing execution tests**

Assert:

- no call occurs when `confirmed !== true`;
- a changed/expired plan hash is rejected;
- operations execute sprint → tasks → moves → lifecycle → verification;
- a successful create immediately persists external ID;
- injected failure leaves completed steps and pending retry steps;
- retry re-reads revisions and skips verified completed work;
- ambiguous create stops with `MCP_SYNC_LINK_REQUIRED`;
- lifecycle status changes only after verification.

Use an adapter spy:

```js
const calls = []
const adapter = {
  saveSprint: async (body) => (calls.push(['saveSprint', body]), { id: 10, revision: 1 }),
  createTask: async (body) => (calls.push(['createTask', body]), { id: 20, revision: 1 }),
  getSprint: async () => ({ id: 10, revision: 1, status: 'planning' }),
  listTasks: async () => [{ id: 20, revision: 1, sprintId: 10 }]
}
```

- [ ] **Step 2: Confirm tests fail**

Run:

```bash
node --test test/milestone-sync.test.js
```

Expected: FAIL because executor/journal modules are missing.

- [ ] **Step 3: Implement the secret-free journal**

Journal path:

```text
.flowlark/cache/mcp-sync/<encoded-milestone-name>.json
```

Persist only plan hash, operation keys, statuses, safe summaries, external IDs, timestamps, and redacted errors. Write atomically.

- [ ] **Step 4: Implement confirmed execution**

Export:

```js
export async function executeMilestoneSync({ root, milestoneName, plan, confirmed, reason, adapter })
export async function resumeMilestoneSync({ root, milestoneName, adapter })
export function readMilestoneSyncJournal(root, milestoneName)
```

Before every update/lifecycle call, fetch the current object and use its latest `revision`. On a revision rejection, mark conflict and stop; do not retry the write automatically.

- [ ] **Step 5: Pass tests**

Run:

```bash
node --test test/milestone-sync.test.js test/milestone-sync-plan.test.js test/milestones.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit synchronization execution**

```bash
git add src/core/milestone-sync-journal.js src/core/milestone-sync.js test/milestone-sync.test.js
git commit -m "feat: execute resumable iteration synchronization"
```

## Task 9: Service facade and HTTP API

**Files:**
- Modify: `src/core/service.js`
- Modify: `src/server/routes.js`
- Create: `test/milestone-sync-api.test.js`

- [ ] **Step 1: Write failing API tests**

Add an injectable adapter/client factory to the Hub test setup and cover:

```text
GET  /api/milestones/:name/preflight
POST /api/milestones/:name/sync-plan
POST /api/milestones/:name/sync-execute
POST /api/milestones/:name/sync-resume
POST /api/milestones/:name/transition
GET  /api/milestones/:name/sync-journal
```

Assert read-only permission rejects plan execution and transitions, blockers return 409-compatible domain errors, and API responses never contain password/environment values.

- [ ] **Step 2: Confirm tests fail**

Run:

```bash
node --test test/milestone-sync-api.test.js
```

Expected: FAIL with route not found.

- [ ] **Step 3: Implement service methods**

Add:

```js
inspectMilestonePreflight(name)
planMilestoneSync(name, input)
executeMilestoneSync(name, input)
resumeMilestoneSync(name)
transitionMilestone(name, input)
milestoneSyncJournal(name)
```

All mutations call `#assertWritable`. Resolve the configured stdio session and `assess-task` adapter inside the service; close the session in `finally`.

- [ ] **Step 4: Add routes and preserve compatibility**

Keep existing `POST /api/milestones/:name/sync` as a compatibility wrapper that now returns a plan unless `confirmed: true` and a matching plan hash are supplied. Do not retain a one-click opaque remote write.

- [ ] **Step 5: Pass API and regression tests**

Run:

```bash
node --test test/milestone-sync-api.test.js test/v04-api.test.js test/mcp-config.test.js test/permissions.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit application API**

```bash
git add src/core/service.js src/server/routes.js test/milestone-sync-api.test.js
git commit -m "feat: expose confirmed iteration sync API"
```

## Task 10: MCP settings UI for stdio runtime

**Files:**
- Create: `web/src/pages/settings/McpRuntimeFields.tsx`
- Modify: `web/src/pages/settings/McpSection.tsx`
- Modify: `web/src/pages/settings/mcpModel.js`
- Modify: `web/src/pages/settings/mcpModel.test.js`
- Modify: `web/src/services/api.ts`

- [ ] **Step 1: Write failing model tests**

Test HTTP and stdio payloads:

```js
assert.deepEqual(serverPayload(stdioForm), {
  name: '研发任务管理',
  type: 'stdio',
  adapter: 'assess-task',
  runtimeProfile: 'assess-task-local',
  enabled: true,
  timeoutMs: 15000
})
```

Test diagnostic severity for missing executable, architecture mismatch, missing execute bit, unsigned binary, and SHA match.

- [ ] **Step 2: Confirm tests fail**

Run:

```bash
node --test web/src/pages/settings/mcpModel.test.js
```

Expected: FAIL on missing stdio fields.

- [ ] **Step 3: Extend API methods**

Add get/save/remove/diagnose runtime profile and set/delete password methods. Password setters accept a transient value but no response type includes it.

- [ ] **Step 4: Implement runtime fields component**

Render binary path, base URL, account, expected SHA, password, and diagnostic result only when server type is `stdio`. Require explicit diagnostic success before enabling the milestone capability's write mode.

The component displays:

- blockers: missing file, non-file, missing execute permission, architecture mismatch, SHA mismatch;
- warning: unsigned/unverifiable signature;
- evidence: architecture, actual SHA, file size, modification time.

- [ ] **Step 5: Pass frontend model and build checks**

Run:

```bash
node --test web/src/pages/settings/mcpModel.test.js
cd web && npm run build
```

Expected: tests PASS and the Vite build exits 0. A chunk-size warning is informational and does not change the exit status.

- [ ] **Step 6: Commit settings UI**

```bash
git add web/src/pages/settings/McpRuntimeFields.tsx web/src/pages/settings/McpSection.tsx web/src/pages/settings/mcpModel.js web/src/pages/settings/mcpModel.test.js web/src/services/api.ts
git commit -m "feat: configure local stdio MCP runtimes"
```

## Task 11: Iteration lifecycle and synchronization UI

**Files:**
- Create: `web/src/pages/milestoneSyncModel.js`
- Create: `web/src/pages/milestoneSyncModel.test.js`
- Modify: `web/src/pages/Milestones.tsx`
- Modify: `web/src/pages/MilestoneDetail.tsx`
- Modify: `web/src/pages/milestoneModel.js`
- Modify: `web/src/pages/milestoneModel.test.js`
- Modify: `web/src/services/api.ts`

- [ ] **Step 1: Write failing UI model tests**

Cover status labels/actions and plan grouping:

```js
assert.deepEqual(allowedMilestoneActions({ status: 'frozen', ready: true }), ['start', 'unfreeze', 'cancel'])
assert.equal(groupPlanOperations(plan).create.length, 2)
assert.equal(syncHealth({ journal: { status: 'failed' } }).tone, 'error')
```

Also test high-risk action classification, blocker repair routes, drift labels, and partial-failure retry text.

- [ ] **Step 2: Confirm tests fail**

Run:

```bash
node --test web/src/pages/milestoneSyncModel.test.js web/src/pages/milestoneModel.test.js
```

Expected: FAIL because the sync model is missing.

- [ ] **Step 3: Extend API methods**

Add preflight, plan, execute, resume, transition, and journal methods with encoded milestone names.

- [ ] **Step 4: Upgrade milestone list**

Add lifecycle tag, synchronization health, drift count, and last synchronization time without removing current period/version/risk/platform columns. Local-only iterations show `未连接平台`, not an error.

- [ ] **Step 5: Upgrade milestone detail**

Add:

- editable goal/owner while planning/reviewing;
- preflight panel with repair links;
- generate-plan button;
- grouped operation preview table;
- ordinary and high-risk confirmation dialogs;
- progress/journal result;
- retry action;
- lifecycle actions for the current state;
- platform execution summary.

Failed operations retain the open plan and user-entered reason.

- [ ] **Step 6: Pass model tests and build**

Run:

```bash
node --test web/src/pages/milestoneSyncModel.test.js web/src/pages/milestoneModel.test.js
cd web && npm run build
```

Expected: PASS and successful build.

- [ ] **Step 7: Commit iteration UI**

```bash
git add web/src/pages/milestoneSyncModel.js web/src/pages/milestoneSyncModel.test.js web/src/pages/Milestones.tsx web/src/pages/MilestoneDetail.tsx web/src/pages/milestoneModel.js web/src/pages/milestoneModel.test.js web/src/services/api.ts
git commit -m "feat: add iteration sync workflow UI"
```

## Task 12: CLI, documentation, full verification, and completion audit

**Files:**
- Modify: `src/cli/cmd-milestones.js`
- Modify: `src/cli/help.js`
- Modify: `test/cli.test.js`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/PRODUCT-UPGRADE-PLAN.md`
- Modify: `docs/react-parity-matrix.md`
- Create: `docs/ASSESS-TASK-MCP.md`

- [ ] **Step 1: Write failing CLI tests**

Cover:

```text
flowlark milestone preflight <name>
flowlark milestone plan <name>
flowlark milestone sync <name> --plan-hash <hash> --confirm
flowlark milestone resume <name>
flowlark milestone transition <name> <status> --reason <text> --confirm
```

Assert JSON mode contains no secret and destructive commands require `--confirm`.

- [ ] **Step 2: Implement CLI commands and help**

CLI output must show blockers, warnings, operation counts, conflicts, and live-verification status. It must not expose raw tool payloads or environment variables.

- [ ] **Step 3: Document setup and honest verification status**

`docs/ASSESS-TASK-MCP.md` must include:

- supported architecture and signature diagnostics;
- local runtime profile and Keychain behavior;
- project/task-type/priority/member mapping;
- lifecycle and synchronization workflow;
- partial failure and retry;
- credential rotation and binary upgrade;
- exact SHA of the supplied reviewed binary as evidence, not as a universal allowlist;
- the P4 disposable-project live checklist;
- the statement that live platform compatibility remains pending without a test environment.

- [ ] **Step 4: Run focused backend tests**

Run:

```bash
node --test test/mcp-client.test.js test/mcp-runtime.test.js test/assess-task-adapter.test.js test/milestone-lifecycle.test.js test/milestone-sync-plan.test.js test/milestone-sync.test.js test/milestone-sync-api.test.js test/mcp-config.test.js test/milestones.test.js test/requirements.test.js test/cli.test.js
```

Expected: PASS.

- [ ] **Step 5: Run all frontend tests and build**

Run:

```bash
node --test web/src/**/*.test.js
cd web && npm run build
```

Expected: all tests PASS and build succeeds.

- [ ] **Step 6: Run the full backend suite**

Run:

```bash
npm test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 7: Perform secret and scope audit**

Run:

```bash
rg -n "ASSESS_PASSWORD|个人平台密码|password" mcp.json docs src web test
git diff --check
git status --short
```

Expected: password references are only field names, redaction tests, or documentation; no credential value or unrelated file is staged. `git diff --check` has no whitespace errors.

- [ ] **Step 8: Audit every design success criterion**

Record evidence for configuration privacy, plan confirmation, one-sprint mapping, requirement deduplication, idempotent rerun, revision conflict, partial recovery, lifecycle confirmation, ownership separation, local-only degradation, HTTP regression, and secret absence. Mark live acceptance explicitly pending until P4 is executed.

- [ ] **Step 9: Commit docs and final integration changes**

```bash
git add src/cli/cmd-milestones.js src/cli/help.js test/cli.test.js README.md CHANGELOG.md docs/PRODUCT-UPGRADE-PLAN.md docs/react-parity-matrix.md docs/ASSESS-TASK-MCP.md
git commit -m "docs: document Assess Task iteration workflow"
```

## P4 live gate: not executable without external state

After a writable disposable platform environment is provided:

- [ ] Discover the released tool set and save a redacted test fixture.
- [ ] Verify current user and project permissions.
- [ ] Create one sprint and three requirement tasks.
- [ ] Repeat unchanged sync and prove no duplicates.
- [ ] Move a task into and out of the sprint.
- [ ] Provoke a stale-revision conflict and prove no overwrite.
- [ ] Start the sprint.
- [ ] Verify unfinished-task confirmation behavior.
- [ ] End one sprint and cancel another.
- [ ] Prove secrets are absent from Git, logs, API responses, and journals.
- [ ] Update compatibility documentation with observed tool names, enum values, and timestamp format.

The feature must not be described as live-verified until every P4 checkbox has direct evidence.
