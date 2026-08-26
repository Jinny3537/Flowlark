# Flowlark React Framework Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port every reachable Vue workbench capability to the active React frontend, delete the legacy Vue/Pinia/Arco/Umi stack, and prove functional and visual parity without changing backend contracts.

**Architecture:** Keep the existing React 19, React Router 7, Ant Design 6, Vite 5 frontend and Node backend. Add only a small runtime context, pure tested models, and focused feature components; keep `web/src/services/api.ts` as the single request client. Migrate by workflow, verify each workflow, then delete the legacy stack in one guarded task.

**Tech Stack:** React 19, TypeScript/TSX, React Router 7, Ant Design 6, Vite 5, CSS custom properties and CSS Modules, Node built-in test runner, existing Playwright regression scripts, existing Flowlark HTTP API.

---

## Working-Tree Constraint

The repository contains many user-owned unstaged and untracked React migration files. Preserve all of them.

- Run `git status --short` before and after every task.
- Never use `git add .`, `git add -A`, `git reset`, `git checkout --`, or cleanup commands.
- Stage only the exact files listed in each task.
- Several target React files are currently untracked; staging one records its complete current content plus the task's change. Inspect `git diff --cached --name-only` and `git diff --cached` before every commit.
- If a target file changes concurrently and the origin of overlapping lines is unclear, stop and ask before editing.

## Success Baseline

- Current web build: passes with a non-blocking approximately 1.6 MB chunk warning.
- Current root tests: 268 pass, 0 fail.
- Production entry: `web/index.html` → `web/src/main.tsx`.
- Legacy inventory: 33 `.vue` files plus duplicate JS entry/router/store/API/style modules.
- Approved design: `docs/superpowers/specs/2026-08-25-react-framework-consolidation-design.md`.

## File Map

Create:

- `docs/react-parity-matrix.md`: route and capability closure checklist.
- `web/src/services/requestModel.js`: framework-independent payload and API error model.
- `web/src/services/requestModel.test.js`: request-model tests.
- `web/src/domain/status.js`: canonical version, review, Git, watch, and operation-log status metadata.
- `web/src/domain/status.test.js`: status-model tests.
- `web/src/runtime/AppRuntime.tsx`: health, permission, workspace, Git, and notification context.
- `web/src/components/gitModel.js`: deterministic Git stage and label rules.
- `web/src/components/gitModel.test.js`: Git model tests.
- `web/src/components/NewVersionDialog.tsx`: React file/paste/URL version import workflow.
- `web/src/components/newVersionModel.js`: version source validation and summary helpers.
- `web/src/components/newVersionModel.test.js`: version source tests.
- `web/src/pages/searchModel.js`: current/all-workspace result normalization and routing.
- `web/src/pages/searchModel.test.js`: search model tests.
- `web/src/pages/milestoneModel.js`: milestone item normalization.
- `web/src/pages/milestoneModel.test.js`: milestone model tests.
- `web/src/pages/settings/OperationLog.tsx`: operation-log table.
- `web/src/pages/settings/SoftwareUpdateSection.tsx`: software update state and actions.
- `web/src/pages/settings/mcpModel.js`: MCP form normalization and JSON parsing.
- `web/src/pages/settings/mcpModel.test.js`: MCP model tests.
- `web/src/pages/settings/McpSection.tsx`: MCP service, secret, and capability editor.
- `web/src/frameworkGuard.test.js`: final no-legacy-framework assertion.

Modify:

- `web/index.html`, `web/package.json`, `web/package-lock.json`: record the existing React entry and dependency migration as the tracked baseline.
- `web/src/services/api.ts`: typed errors and removal of dead browser-only draft call.
- `web/src/main.tsx`: runtime provider, direct React Router routes, `/oplog` redirect.
- `web/src/components/AppShell.tsx`: runtime context, keyboard search, notification details, status, version dialog.
- `web/src/components/GitDrawer.tsx`: full Git assistant parity.
- `web/src/pages/Projects.tsx`, `Requirements.tsx`, `RequirementDetail.tsx`, `Milestones.tsx`, `MilestoneDetail.tsx`, `Deliveries.tsx`, `DeliveryDetail.tsx`, `NotFound.tsx`: remove Umi shim and use React Router directly.
- `web/src/pages/ProjectVersions.tsx`: React version dialog entry and parity checks.
- `web/src/pages/Search.tsx`: cross-workspace search, saved views, structured filters.
- `web/src/pages/WatchInbox.tsx`: open/retry actions.
- `web/src/pages/Trash.tsx`: restore action.
- `web/src/pages/Settings.tsx`: workspace/update/log/MCP sections.
- `web/src/pages/settings/SettingsSections.tsx`: workspace registration, clone, index controls.
- `web/src/pages/settings/settingsConfig.tsx`: section metadata and icons.
- `web/src/styles/global.css`: shared states for the added React controls.
- `web/vite.config.js`: remove `@umijs/max` alias.
- `README.md`, `DESIGN.md`, `design-system/flowlark/MASTER.md`, `assets/brand/README.md`: current React stack documentation.
- `.codex-ui-regression/ui-regression.spec.js`: route and workflow regression coverage.

Delete after parity gates pass:

- Every `web/src/**/*.vue` file.
- `web/src/main.js`, `router.js`, `store.js`, `api.js`, `utils.js`, `style.css`, `brand.js`, `umi-shim.ts`.
- `web/src/ui/feedback.js`, `web/src/ui/status.js`.

Do not delete prototype `.html` files or backend HTML import/preview support.

### Task 1: Freeze the Reachable Capability Matrix

**Files:**

- Create: `docs/react-parity-matrix.md`
- Inspect: `web/src/router.js`
- Inspect: `web/src/App.vue`
- Inspect: `web/src/views/*.vue`
- Inspect: `web/src/components/*.vue`
- Inspect: `web/src/main.tsx`
- Inspect: `web/src/pages/**/*.tsx`

- [ ] **Step 1: Create the matrix with every reachable workflow**

Create `docs/react-parity-matrix.md` with this exact initial table:

```markdown
# React Parity Matrix

Status values: `verified`, `gap`, `delete-unreachable`.

| Area | Reachable Vue behavior | API / boundary | React target | Initial status |
|---|---|---|---|---|
| Shell | navigation, quick create, Ctrl/Cmd+K, notification detail/retry, runtime/read-only/LAN/update status | health, notifications, update check | AppShell | gap |
| Git | doctor, initialize, identity, permission refresh, sync, conflict choose/mark/continue/abort, brief | git/* | GitDrawer | gap |
| Projects | list and create projects | projects | Projects | verified |
| Versions | list/filter/detail, create from file/paste/URL, inspect dependencies, impact suggestion | versions, import, impact | ProjectVersions + NewVersionDialog | gap |
| Workbench | preview/edit/spec/change/requirement/tag/attachment/feedback/history/offline/review/baseline | versions/* | VersionWorkbench | verified |
| Compare | version/version and prototype/system comparison with URL restoration | preview + cumulative | Compare | verified |
| Search | current/all workspaces, saved views, structured filters, object routing | search, workspace-search, views | Search | gap |
| Requirements | create/filter, external search/import/sync/token | requirements + integrations/requirements | Requirements | gap |
| Requirement detail | edit, export, linked-version navigation | requirement + export | RequirementDetail | gap |
| Milestones | create, optional sync, bulk sync | milestones + sync | Milestones | gap |
| Milestone detail | add/remove scope item, export, external sync | milestone + export | MilestoneDetail | gap |
| Deliveries | create snapshot, notification retry, webhook test/save | snapshots + notifications | Deliveries | gap |
| Delivery detail | frozen snapshot detail | snapshots | DeliveryDetail | verified |
| Watch inbox | show errors, open archived version, retry failed item | watch/inbox | WatchInbox | gap |
| Trash | restore deleted version | trash + restore | Trash | gap |
| Settings | schema config, LAN, Git remote | config + lan + git/remote | Settings | verified |
| Workspaces | register, clone, remove, rebuild index | workspaces + workspace-index | Settings/WorkspaceSection | gap |
| Software update | status, fetch, dirty guard, pull, restart notice | update/software | Settings/SoftwareUpdateSection | gap |
| Operation log | paginated semantic actions | oplog | Settings/OperationLog | gap |
| MCP | service CRUD, secret set/delete, capability CRUD/test | mcp/* | Settings/McpSection | gap |
| Setup wizard | no route or production entry | drafts/version | none | delete-unreachable |
```

- [ ] **Step 2: Record the exact legacy API reference audit**

Append these commands and their date-stamped result beneath the table:

```bash
rg -o "api\.[A-Za-z0-9_]+" web/src/App.vue web/src/views web/src/components web/src/store.js --glob '*.vue' --glob '*.js' | sed 's/.*api\.//' | sort -u
rg -o "api\.[A-Za-z0-9_]+" web/src/main.tsx web/src/pages web/src/components web/src/services web/src/utils --glob '*.tsx' --glob '*.ts' --glob '*.js' | sed 's/.*api\.//' | sort -u
```

Record `2026-08-25: legacy source 106 unique API names; active React 65 unique API names; raw counts include unreachable legacy code.`

- [ ] **Step 3: Verify only the matrix is staged**

Run:

```bash
git add docs/react-parity-matrix.md
git diff --cached --name-only
git diff --cached --check
```

Expected: only `docs/react-parity-matrix.md`; no whitespace errors.

- [ ] **Step 4: Commit the audit baseline**

```bash
git commit -m "docs: freeze React parity matrix"
```

### Task 2: Adopt the Existing React Migration as the Tracked Baseline

**Files:**

- Modify/track: `web/index.html`
- Modify/track: `web/package.json`
- Modify/track: `web/package-lock.json`
- Modify/track: `web/vite.config.js`
- Track: `web/src/main.tsx`
- Track: `web/src/components/AppShell.tsx`
- Track: `web/src/components/GitDrawer.tsx`
- Track: `web/src/components/MetricCard.tsx`
- Track: `web/src/components/PageHeader.tsx`
- Track: `web/src/components/State.tsx`
- Track: all current React files under `web/src/pages/`
- Track: `web/src/services/api.ts`
- Track: `web/src/styles/global.css`
- Track: `web/src/umi-shim.ts`
- Track: `web/src/utils/format.ts`

This task records the already-created React migration without changing its behavior. It is necessary so later commits are reproducible and do not leave the active frontend, package dependencies, or entrypoint only in the working tree.

- [ ] **Step 1: Resolve the exact React baseline file list**

Run:

```bash
git status --short web/index.html web/package.json web/package-lock.json web/vite.config.js web/src
find web/src/pages -type f | sort
```

Expected: modified React package/entry/config files, untracked React TSX/TS/JS/CSS files, and separately tracked Vue legacy files. Do not stage any `.vue` file in this task.

- [ ] **Step 2: Verify the existing baseline before recording it**

```bash
cd web && npm run build
cd .. && npm test
```

Expected: Vite exits 0 with only the existing chunk-size warning; 268 tests pass and 0 fail.

- [ ] **Step 3: Stage only the active React foundation**

```bash
git add web/index.html web/package.json web/package-lock.json web/vite.config.js web/src/main.tsx web/src/components/AppShell.tsx web/src/components/GitDrawer.tsx web/src/components/MetricCard.tsx web/src/components/PageHeader.tsx web/src/components/State.tsx web/src/pages web/src/services/api.ts web/src/styles/global.css web/src/umi-shim.ts web/src/utils/format.ts
git diff --cached --name-only
git diff --cached --check
```

Expected: the listed React files plus `web/index.html`, package files, and Vite config. The staged list contains no `.vue`, root packaging, launcher, README, or unrelated documentation changes.

- [ ] **Step 4: Inspect and commit the baseline**

Run `git diff --cached --stat` and inspect representative entry, router, workbench, settings, and package diffs. Then commit:

```bash
git commit -m "feat: establish React frontend baseline"
```

### Task 3: Make Request Failures Deterministic and Testable

**Files:**

- Create: `web/src/services/requestModel.js`
- Create: `web/src/services/requestModel.test.js`
- Modify: `web/src/services/api.ts:1-64`

- [ ] **Step 1: Write failing request-model tests**

Create `web/src/services/requestModel.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, errorFromResponse, errorText, parsePayload } from './requestModel.js'

test('parses JSON, text, and empty response bodies', () => {
  assert.deepEqual(parsePayload('{"ok":true}'), { ok: true })
  assert.equal(parsePayload('plain failure'), 'plain failure')
  assert.equal(parsePayload(''), null)
})

test('preserves structured business error fields', () => {
  const error = errorFromResponse(409, { code: 'CONFLICT', message: '发生冲突', hint: '先处理文件' })
  assert.equal(error.status, 409)
  assert.equal(error.code, 'CONFLICT')
  assert.equal(error.hint, '先处理文件')
  assert.equal(error.message, '发生冲突（先处理文件）')
})

test('converts text errors without throwing JSON syntax errors', () => {
  const error = errorFromResponse(502, 'Bad Gateway')
  assert.equal(error.message, 'Bad Gateway')
  assert.equal(error.code, 'HTTP_502')
})

test('uses stable read-only and fallback messages', () => {
  assert.equal(errorFromResponse(403, { code: 'READONLY_FROM_LAN' }).message, '这是别人共享出来的只读视图，只能查看不能修改')
  assert.equal(errorFromResponse(403, { code: 'GIT_READONLY' }).message, '当前 Git 身份没有远端写权限，Flowlark 已进入只读模式')
  assert.equal(errorText(new Error('具体错误'), '默认错误'), '具体错误')
  assert.equal(errorText(null, '默认错误'), '默认错误')
})

test('ApiError carries a network cause without leaking it into the message', () => {
  const cause = new Error('socket closed')
  const error = new ApiError('无法连接本地服务，flowlark serve 可能已经停止', { code: 'NETWORK', cause })
  assert.equal(error.code, 'NETWORK')
  assert.equal(error.cause, cause)
})
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run:

```bash
node --test web/src/services/requestModel.test.js
```

Expected: `ERR_MODULE_NOT_FOUND` for `requestModel.js`.

- [ ] **Step 3: Implement the request model**

Create `web/src/services/requestModel.js`:

```js
const READONLY_MESSAGES = {
  READONLY_FROM_LAN: '这是别人共享出来的只读视图，只能查看不能修改',
  GIT_READONLY: '当前 Git 身份没有远端写权限，Flowlark 已进入只读模式'
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN', hint = '', payload = null, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.hint = hint
    this.payload = payload
  }
}

export function parsePayload(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

export function errorFromResponse(status, payload) {
  const code = payload && typeof payload === 'object' && payload.code
    ? String(payload.code)
    : `HTTP_${status}`
  const hint = payload && typeof payload === 'object' && payload.hint ? String(payload.hint) : ''
  const base = READONLY_MESSAGES[code]
    || (payload && typeof payload === 'object' && payload.message ? String(payload.message) : '')
    || (typeof payload === 'string' && payload.trim() ? payload.trim() : '请求失败')
  return new ApiError(hint && !READONLY_MESSAGES[code] ? `${base}（${hint}）` : base, {
    status, code, hint, payload
  })
}

export function errorText(error, fallback = '请求失败') {
  return error instanceof Error && error.message ? error.message : fallback
}
```

- [ ] **Step 4: Route every API response through the model**

In `web/src/services/api.ts`, remove the `antd` import and `reportError`. Replace `request` and `requestText` with:

```ts
import { ApiError, errorFromResponse, parsePayload } from './requestModel.js';

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined
        ? {}
        : options.raw
          ? { 'Content-Type': options.contentType || 'application/octet-stream' }
          : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : options.raw ? (body as BodyInit) : JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiError('无法连接本地服务，flowlark serve 可能已经停止', {
      code: 'NETWORK',
      cause: cause instanceof Error ? cause : undefined,
    });
  }

  const payload = parsePayload(await response.text());
  if (!response.ok) throw errorFromResponse(response.status, payload);
  return payload as T;
}

async function requestText(path: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch (cause) {
    throw new ApiError('无法连接本地服务，flowlark serve 可能已经停止', {
      code: 'NETWORK',
      cause: cause instanceof Error ? cause : undefined,
    });
  }
  const text = await response.text();
  if (!response.ok) throw errorFromResponse(response.status, parsePayload(text));
  return text;
}
```

Keep all endpoint paths unchanged. Remove `draftVersion` from the browser API object because its only legacy consumer is the unreachable setup wizard.

- [ ] **Step 5: Run focused tests and the production build**

```bash
node --test web/src/services/requestModel.test.js
cd web && npm run build
```

Expected: five tests pass; Vite exits 0 with only the existing chunk-size warning.

- [ ] **Step 6: Commit only the request foundation**

```bash
git add web/src/services/requestModel.js web/src/services/requestModel.test.js web/src/services/api.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "refactor: centralize React API errors"
```

### Task 4: Remove Umi Navigation and Add Shared Runtime State

**Files:**

- Create: `web/src/domain/status.js`
- Create: `web/src/domain/status.test.js`
- Create: `web/src/runtime/AppRuntime.tsx`
- Modify: `web/src/main.tsx`
- Modify: `web/src/components/AppShell.tsx`
- Modify: `web/src/pages/Projects.tsx`
- Modify: `web/src/pages/Requirements.tsx`
- Modify: `web/src/pages/RequirementDetail.tsx`
- Modify: `web/src/pages/Milestones.tsx`
- Modify: `web/src/pages/MilestoneDetail.tsx`
- Modify: `web/src/pages/Deliveries.tsx`
- Modify: `web/src/pages/DeliveryDetail.tsx`
- Modify: `web/src/pages/NotFound.tsx`
- Modify: `web/vite.config.js`
- Delete: `web/src/umi-shim.ts`

- [ ] **Step 1: Test canonical status metadata**

Create `web/src/domain/status.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { operationMeta, statusMeta, VERSION_STATUS, WATCH_STATUS } from './status.js'

test('returns canonical version and watch labels', () => {
  assert.deepEqual(statusMeta(VERSION_STATUS, 'DRAFT'), { label: '编辑中', color: 'gold' })
  assert.deepEqual(statusMeta(WATCH_STATUS, 'failed'), { label: '失败', color: 'red' })
})

test('falls back to readable unknown state', () => {
  assert.deepEqual(statusMeta(VERSION_STATUS, 'CUSTOM'), { label: 'CUSTOM', color: 'default' })
})

test('maps semantic operation log actions', () => {
  assert.deepEqual(operationMeta('BASELINE_ROLLBACK'), { label: '回滚基线', color: 'orange' })
  assert.deepEqual(operationMeta('CUSTOM'), { label: 'CUSTOM', color: 'default' })
})
```

- [ ] **Step 2: Implement the canonical maps**

Create `web/src/domain/status.js`:

```js
export const VERSION_STATUS = {
  DRAFT: { label: '编辑中', color: 'gold' },
  BASELINE: { label: '当前基线', color: 'green' },
  HISTORY: { label: '历史版本', color: 'default' },
  VOID: { label: '已废弃', color: 'red' }
}

export const REVIEW_STATUS = {
  unread: { label: '未读', color: 'orange' },
  reviewing: { label: '审阅中', color: 'gold' },
  approved: { label: '已确认', color: 'green' },
  obsolete: { label: '已过期', color: 'default' },
  pending: { label: '待评审', color: 'orange' },
  confirmed: { label: '已确认', color: 'green' },
  questions: { label: '有疑问', color: 'gold' }
}

export const WATCH_STATUS = {
  pending: { label: '待归档', color: 'gold' },
  archived: { label: '已归档', color: 'green' },
  failed: { label: '失败', color: 'red' }
}

const OPERATION_STATUS = {
  PROJECT_CREATE: { label: '创建项目', color: 'green' },
  PROJECT_UPDATE: { label: '编辑项目', color: 'blue' },
  VERSION_ADD: { label: '新增版本', color: 'green' },
  VERSION_UPDATE: { label: '编辑版本', color: 'blue' },
  VERSION_REPLACE_FILE: { label: '替换文件', color: 'blue' },
  VERSION_VOID: { label: '废弃', color: 'red' },
  VERSION_REOPEN: { label: '重新打开', color: 'green' },
  VERSION_REMOVE: { label: '删除', color: 'red' },
  VERSION_RESTORE: { label: '恢复', color: 'green' },
  BASELINE_SET: { label: '设为基线', color: 'green' },
  BASELINE_ROLLBACK: { label: '回滚基线', color: 'orange' },
  SPEC_UPDATE: { label: '更新规格书', color: 'blue' },
  CHANGES_SET: { label: '更新变更日志', color: 'blue' },
  REQS_SET: { label: '更新关联需求', color: 'blue' }
}

export function statusMeta(table, key) {
  return table[key] || { label: key || '未知', color: 'default' }
}

export function operationMeta(action) {
  return statusMeta(OPERATION_STATUS, action)
}
```

- [ ] **Step 3: Add the runtime provider**

Create `web/src/runtime/AppRuntime.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type HealthInfo } from '@/services/api';

type RuntimeValue = {
  health: HealthInfo | null;
  git: any;
  notifications: any[];
  loading: boolean;
  reload: () => Promise<void>;
};

const RuntimeContext = createContext<RuntimeValue | null>(null);

export function AppRuntimeProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [git, setGit] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [nextHealth, nextGit, nextNotifications] = await Promise.all([
      api.health().catch(() => null),
      api.gitStatus({ fast: true, cache: true }).catch(() => null),
      api.listNotifications().catch(() => []),
    ]);
    setHealth(nextHealth);
    setGit(nextGit);
    setNotifications(nextNotifications);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const value = useMemo(() => ({ health, git, notifications, loading, reload }), [git, health, loading, notifications, reload]);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useAppRuntime() {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('useAppRuntime must be used inside AppRuntimeProvider');
  return value;
}
```

Wrap `AppShell` with `AppRuntimeProvider` inside `HashRouter` in `main.tsx`:

```tsx
<HashRouter>
  <AppRuntimeProvider>
    <AppRoutes />
  </AppRuntimeProvider>
</HashRouter>
```

Change `AppShell` to read `{ health, git, notifications, reload }` from `useAppRuntime()` and delete its duplicate health/Git/notification state and `loadShell` function. Pass `reload` to `GitDrawer.onChanged`.

- [ ] **Step 4: Replace Umi navigation at every call site**

Use these exact patterns:

```tsx
// list pages
import { useNavigate } from 'react-router-dom';
const navigate = useNavigate();
navigate(`/requirements/${encodeURIComponent(item.code)}`);

// detail pages
import { useParams } from 'react-router-dom';
const { code = '' } = useParams();

// NotFound
const navigate = useNavigate();
<Button type="primary" onClick={() => navigate('/actions')}>回到个人工作台</Button>
```

Replace every `history.push(...)` with `navigate(...)`. Do not use `window.location.hash`.

Add the compatibility redirect to `main.tsx`:

```tsx
<Route path="/oplog" element={<Navigate to="/settings/oplog" replace />} />
```

Remove the `@umijs/max` alias from `web/vite.config.js`, then delete `web/src/umi-shim.ts`.

- [ ] **Step 5: Run status tests, the Umi audit, and build**

```bash
node --test web/src/domain/status.test.js
rg -n "@umijs/max|umi-shim|window\.location\.hash" web/src web/vite.config.js
cd web && npm run build
```

Expected: three status tests pass; `rg` returns no matches; build exits 0.

- [ ] **Step 6: Commit the runtime and routing foundation**

Stage only the files listed in this task, inspect the staged diff, then:

```bash
git add web/src/domain/status.js web/src/domain/status.test.js web/src/runtime/AppRuntime.tsx web/src/main.tsx web/src/components/AppShell.tsx web/src/pages/Projects.tsx web/src/pages/Requirements.tsx web/src/pages/RequirementDetail.tsx web/src/pages/Milestones.tsx web/src/pages/MilestoneDetail.tsx web/src/pages/Deliveries.tsx web/src/pages/DeliveryDetail.tsx web/src/pages/NotFound.tsx web/vite.config.js web/src/umi-shim.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "refactor: unify React routing and runtime state"
```

### Task 5: Restore Shell and Git Assistant Parity

**Files:**

- Create: `web/src/components/gitModel.js`
- Create: `web/src/components/gitModel.test.js`
- Modify: `web/src/components/AppShell.tsx`
- Modify: `web/src/components/GitDrawer.tsx`
- Modify: `web/src/styles/global.css`
- Modify: `docs/react-parity-matrix.md`

- [ ] **Step 1: Write Git stage and sync-label tests**

Create `web/src/components/gitModel.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { canWriteGit, gitStage, syncLabel } from './gitModel.js'

test('uses doctor stage and conflict fallback', () => {
  assert.equal(gitStage({ stage: 'no-repo' }, null), 'no-repo')
  assert.equal(gitStage({ stage: 'ready' }, { conflicts: [{}] }), 'conflicted')
})

test('blocks Git writes for app or remote read-only state', () => {
  assert.equal(canWriteGit(false, { mode: 'writable' }), false)
  assert.equal(canWriteGit(true, { mode: 'readonly' }), false)
  assert.equal(canWriteGit(true, null), true)
})

test('describes local, pull, push, and full sync actions', () => {
  assert.equal(syncLabel({ hasRemote: false }), '提交到本地')
  assert.equal(syncLabel({ hasRemote: true, clean: true, behind: 1 }), '拉取更新')
  assert.equal(syncLabel({ hasRemote: true, clean: true, ahead: 1 }), '推送到远端')
  assert.equal(syncLabel({ hasRemote: true, clean: false }), '提交并同步')
})
```

- [ ] **Step 2: Implement the Git model**

Create `web/src/components/gitModel.js`:

```js
export function gitStage(doctor, status) {
  if (status?.conflicts?.length) return 'conflicted'
  return doctor?.stage || null
}

export function canWriteGit(appCanWrite, permission) {
  return Boolean(appCanWrite && permission?.mode !== 'readonly')
}

export function syncLabel(status = {}) {
  if (!status.hasRemote) return '提交到本地'
  if (status.clean && status.behind) return '拉取更新'
  if (status.clean && status.ahead) return '推送到远端'
  return '提交并同步'
}
```

- [ ] **Step 3: Port the full Git action state machine**

In `GitDrawer.tsx`, add state for `permission`, `conflicts`, `busy`, `commitMessage`, `steps`, and a form with `{ name, email, remote }`. Load doctor first; unless its stage is `no-git` or `no-repo`, also load full status and populate identity.

Use this single guarded mutation helper and handlers:

```tsx
const { health } = useAppRuntime();
const writable = canWriteGit(health?.canWrite !== false, permission);

const guard = useCallback(async <T,>(action: () => Promise<T>, success?: string | ((result: T) => string), allowReadonly = false) => {
  if (!allowReadonly && !writable) {
    message.info('当前是只读模式，不能执行 Git 写操作');
    return null;
  }
  setBusy(true);
  try {
    const result = await action();
    if (success) message.success(typeof success === 'function' ? success(result) : success);
    await load();
    onChanged?.();
    return result;
  } catch (error) {
    message.error(errorText(error, 'Git 操作失败'));
    return null;
  } finally {
    setBusy(false);
  }
}, [load, message, onChanged, writable]);

const initialize = () => guard(
  () => api.gitInit(form.getFieldsValue()),
  (result: any) => result.needIdentity ? '仓库已建立，还差提交身份' : '已纳入 Git 管理'
);
const saveIdentity = () => guard(() => api.gitSetIdentity(form.getFieldsValue(['name', 'email'])), '身份已保存');
const refreshPermission = () => guard(() => api.refreshGitPermission(), (result: any) => result.mode === 'readonly' ? '已刷新：当前身份只读' : '已刷新 Git 写权限', true);
const pickBaseline = (slug: string, versionNo: string) => guard(() => api.gitResolve(slug, versionNo), `已把 ${slug} 的基线定为 ${versionNo}`);
const markResolved = (path: string) => guard(() => api.gitMarkResolved([path]), '已标记为解决');
const continueSync = () => guard(() => api.gitContinue());
const abortSync = () => guard(() => api.gitAbort(), '已回到同步之前的状态');
const sync = () => guard(async () => {
  const result: any = await api.gitSync(commitMessage);
  setSteps(result.steps || []);
  if (result.conflicted) message.warning('产生了冲突，下面可以逐个处理');
  setCommitMessage('');
  return result;
}, '已同步');
const fillSuggestion = async () => {
  const result: any = await api.gitSuggestMessage();
  if (result.message) setCommitMessage(result.message);
  else message.info('没有待提交的改动');
};
```

Render exactly four states:

1. `no-git`: installation guidance and re-detect button.
2. `no-repo`: name/email/optional remote form and “纳入 Git 管理”.
3. missing identity: name/email form and “保存身份”.
4. conflicted or ready: assisted baseline choices or mark-resolved buttons; continue/abort/brief controls; otherwise changes, ignored foreign files, commit message, suggestion, sync, and brief controls.

Use `Popconfirm` for abort. `copyBrief` must call `api.gitBrief(intent)`, attempt `navigator.clipboard.writeText(result.text)`, and show an error while leaving the returned text visible in a read-only `Input.TextArea` when the clipboard is unavailable.

- [ ] **Step 4: Restore shell keyboard, notifications, and update status**

In `AppShell.tsx`, add:

```tsx
useEffect(() => {
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      navigate('/search');
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, [navigate]);
```

Replace the notification icon's immediate flush behavior with an Ant Design `Popover` that shows up to four pending items, “查看交付”, and a disabled-when-empty “立即重试” button. Retry calls `api.flushNotifications()`, shows success/error, then `runtime.reload()`.

If `health.updateManifestUrl` is present, call `api.checkUpdate(health.version || '0.0.0', health.updateManifestUrl)` after runtime load and render `可更新至 <version>` as text plus color. Render explicit “Git 只读” or “只读” text whenever `health.canWrite === false`.

- [ ] **Step 5: Add only required shared CSS**

Append styles for `.fl-git-checks`, `.fl-git-check`, `.fl-git-conflict`, `.fl-git-steps`, `.fl-notification-popover`, and `.fl-runtime-tags`. Use existing `--fl-*` tokens and existing spacing scale; do not introduce a new palette.

```css
.fl-git-checks, .fl-git-steps { display: grid; gap: var(--fl-s-2); }
.fl-git-check { display: flex; align-items: flex-start; gap: var(--fl-s-2); padding-block: var(--fl-s-2); }
.fl-git-conflict { margin-block: var(--fl-s-4); padding: var(--fl-s-3); border: 1px solid var(--fl-line); border-radius: var(--fl-r-2); }
.fl-notification-popover { width: min(360px, calc(100vw - 32px)); }
.fl-runtime-tags { display: flex; align-items: center; gap: var(--fl-s-2); flex-wrap: wrap; }
```

- [ ] **Step 6: Verify and close matrix rows**

```bash
node --test web/src/components/gitModel.test.js
cd web && npm run build
```

Expected: three tests pass and build exits 0. Change Shell and Git matrix rows to `verified` only after manually exercising all four Git states against fixtures or mocked responses.

- [ ] **Step 7: Commit the shell and Git workflow**

Stage only the six files listed in this task and commit:

```bash
git add web/src/components/gitModel.js web/src/components/gitModel.test.js web/src/components/AppShell.tsx web/src/components/GitDrawer.tsx web/src/styles/global.css docs/react-parity-matrix.md
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: restore React shell and Git workflows"
```

### Task 6: Restore Complete React Version Creation

**Files:**

- Create: `web/src/components/NewVersionDialog.tsx`
- Create: `web/src/components/newVersionModel.js`
- Create: `web/src/components/newVersionModel.test.js`
- Modify: `web/src/components/AppShell.tsx`
- Modify: `web/src/pages/ProjectVersions.tsx`
- Modify: `web/src/styles/global.css`
- Modify: `docs/react-parity-matrix.md`

- [ ] **Step 1: Test source validation and source summaries**

Create `web/src/components/newVersionModel.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceSummary, validateHtmlFile } from './newVersionModel.js'

test('accepts html and htm files within the configured limit', () => {
  assert.equal(validateHtmlFile({ name: 'demo.html', size: 100 }, 200), '')
  assert.equal(validateHtmlFile({ name: 'demo.htm', size: 100 }, 200), '')
})

test('rejects wrong extensions and oversized files', () => {
  assert.equal(validateHtmlFile({ name: 'demo.txt', size: 100 }, 200), '仅支持 .html 或 .htm 文件')
  assert.equal(validateHtmlFile({ name: 'demo.html', size: 201 }, 200), '文件超过 200 B 上限')
})

test('summarizes bytes and external dependencies', () => {
  assert.equal(sourceSummary('', []), '尚未读取 HTML')
  assert.equal(sourceSummary('1234', []), '4 B · 无外部依赖')
  assert.equal(sourceSummary('1234', ['https://cdn/a.css']), '4 B · 1 个外部依赖')
})
```

- [ ] **Step 2: Implement source helpers**

Create `web/src/components/newVersionModel.js`:

```js
export function validateHtmlFile(file, maxBytes) {
  if (!/\.html?$/i.test(String(file?.name || ''))) return '仅支持 .html 或 .htm 文件'
  if (Number(file?.size || 0) > Number(maxBytes || Infinity)) return `文件超过 ${formatBytes(maxBytes)} 上限`
  return ''
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function sourceSummary(html, externalRefs = []) {
  if (!html) return '尚未读取 HTML'
  const bytes = new TextEncoder().encode(html).byteLength
  return `${formatBytes(bytes)} · ${externalRefs.length ? `${externalRefs.length} 个外部依赖` : '无外部依赖'}`
}
```

- [ ] **Step 3: Build the React version dialog**

`NewVersionDialog.tsx` must accept:

```tsx
type NewVersionDialogProps = {
  open: boolean;
  slug?: string;
  projects?: any[];
  maxFileBytes: number;
  onClose: () => void;
  onCreated: (project: string, versionNo: string) => void;
};
```

Use an Ant Design `Segmented` with `file`, `paste`, and `url`. File mode uses `Upload.Dragger` with `beforeUpload`; paste mode inspects on blur; URL mode calls `api.importUrl`. All accepted HTML calls `api.inspectHtml` and stores `externalRefs`. Render dependency count and a collapsible list.

Use `ChangeEditor` and `RequirementEditor` from `@/pages/workbench/WorkbenchPrimitives`. Implement impact checking exactly as:

```tsx
const checkImpact = async () => {
  const changes = form.getFieldValue('changes') || [];
  setImpactLoading(true);
  try {
    setImpacts(await api.suggestImpact(changes));
  } catch (error) {
    message.error(errorText(error, '无法检查影响面'));
  } finally {
    setImpactLoading(false);
  }
};
```

Submit only after project, version number, title, and HTML are non-empty:

```tsx
await api.addVersion(project, {
  versionNo: values.versionNo.trim(),
  title: values.title.trim(),
  html,
  changes: (values.changes || []).filter((item: any) => item.content?.trim()),
  requirements: (values.requirements || []).filter((item: any) => item.code?.trim()),
});
onCreated(project, values.versionNo.trim());
```

Failed imports or saves keep the dialog and current draft open.

- [ ] **Step 4: Replace the shell's partial import modal**

Remove the inline version `Modal` and form from `AppShell.tsx`. Render `NewVersionDialog` and navigate on creation:

```tsx
<NewVersionDialog
  open={versionOpen}
  projects={projects}
  maxFileBytes={health?.maxFileBytes || 10 * 1024 * 1024}
  onClose={() => setVersionOpen(false)}
  onCreated={(project, versionNo) => {
    setVersionOpen(false);
    navigate(`/projects/${encodeURIComponent(project)}/versions/${encodeURIComponent(versionNo)}`);
  }}
/>
```

In `ProjectVersions.tsx`, add a “新建版本” action that opens the same dialog with the route `slug` fixed.

- [ ] **Step 5: Test, build, and close the Versions row**

```bash
node --test web/src/components/newVersionModel.test.js
cd web && npm run build
```

Expected: three tests pass; build exits 0. Verify file, paste, URL, oversized file, dependency warning, impact results, success, and failure retention. Mark Versions `verified`.

- [ ] **Step 6: Commit the version-import workflow**

```bash
git add web/src/components/NewVersionDialog.tsx web/src/components/newVersionModel.js web/src/components/newVersionModel.test.js web/src/components/AppShell.tsx web/src/pages/ProjectVersions.tsx web/src/styles/global.css docs/react-parity-matrix.md
git diff --cached --check
git commit -m "feat: restore React version import parity"
```

### Task 7: Restore Search and Requirement Workflows

**Files:**

- Create: `web/src/pages/searchModel.js`
- Create: `web/src/pages/searchModel.test.js`
- Modify: `web/src/pages/Search.tsx`
- Modify: `web/src/pages/Requirements.tsx`
- Modify: `web/src/pages/RequirementDetail.tsx`
- Modify: `web/src/styles/global.css`
- Modify: `docs/react-parity-matrix.md`

- [ ] **Step 1: Write search-result routing tests**

Create `web/src/pages/searchModel.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWorkspaceResults, resultRoute } from './searchModel.js'

test('normalizes cross-workspace results', () => {
  assert.deepEqual(normalizeWorkspaceResults([{ type: 'requirement', code: 'REQ-1', title: '需求', workspaceName: 'A' }])[0], {
    type: 'requirement', code: 'REQ-1', title: '需求', workspaceName: 'A', objectType: 'requirement', fieldLabel: 'A'
  })
})

test('routes every supported result type', () => {
  assert.equal(resultRoute({ objectType: 'requirement', requirementCode: 'REQ 1' }), '/requirements/REQ%201')
  assert.equal(resultRoute({ objectType: 'milestone', milestoneName: 'S 1' }), '/milestones/S%201')
  assert.equal(resultRoute({ objectType: 'version', project: 'orders', versionNo: 'v1' }), '/projects/orders/versions/v1')
  assert.equal(resultRoute({ objectType: 'project', project: 'orders' }), '/projects/orders')
})
```

- [ ] **Step 2: Implement search normalization**

Create `web/src/pages/searchModel.js`:

```js
export function normalizeWorkspaceResults(items = []) {
  return items.map(item => ({
    ...item,
    objectType: item.objectType || item.type,
    fieldLabel: item.fieldLabel || item.workspaceName || item.name || ''
  }))
}

export function resultRoute(item) {
  if (item.objectType === 'requirement') return `/requirements/${encodeURIComponent(item.requirementCode || item.code)}`
  if (item.objectType === 'milestone') return `/milestones/${encodeURIComponent(item.milestoneName || item.name)}`
  if (item.objectType === 'version') return `/projects/${encodeURIComponent(item.project)}/versions/${encodeURIComponent(item.versionNo)}`
  if (item.project) return `/projects/${encodeURIComponent(item.project)}`
  return ''
}
```

- [ ] **Step 3: Add all-workspace search and saved views**

In `Search.tsx`, load requirements, milestones, and views together. Add state for `scope`, structured filters, selected view, and a save-view modal. The Chinese UI label for all scope is `跨工作区`. Current scope uses `api.search`; all scope uses:

```tsx
const items = await api.searchWorkspaces(query, 100);
setResult({ total: items.length, results: normalizeWorkspaceResults(items) });
```

Use `resultRoute(item)` for navigation. If `item.workspace` differs from `health.repo`, do not navigate into the current repository; show `结果位于工作区：<name>`.

Save a view with:

```tsx
await api.saveView(values.id.trim(), {
  name: values.name.trim(),
  scope,
  query,
  filters: { ...filters },
});
```

The filter controls are scope, project, requirement, milestone, and field. Applying a saved view updates all controls and runs search.

- [ ] **Step 4: Restore requirement list integration controls**

In `Requirements.tsx`:

- add status, project, and source filters;
- expand the create form with project, module, type, priority, owner, URL, and description;
- add “从需求池导入” and “同步需求池” actions;
- use an external modal with provider `mcp`, token, query, results, save-token, search, and import actions.

Use these exact mutation handlers:

```tsx
const saveExternalToken = async () => {
  await api.setRequirementToken(external.provider, external.token);
  setExternal(current => ({ ...current, token: '' }));
  message.success('Token 已保存到钥匙串');
};

const searchExternal = async () => {
  if (!external.query.trim()) return message.warning('请输入搜索关键词');
  setExternalLoading(true);
  try {
    setExternalResults(await api.searchExternalRequirements(external.provider, external.query, { token: external.token }));
  } finally { setExternalLoading(false); }
};

const importExternal = async (code: string) => {
  setImportingCode(code);
  try {
    const item: any = await api.importExternalRequirement(external.provider, code, { token: external.token });
    message.success(`已导入 ${item.code}`);
    setExternalOpen(false);
    await load();
    navigate(`/requirements/${encodeURIComponent(item.code)}`);
  } finally { setImportingCode(''); }
};
```

Sync calls `api.syncRequirements` and reports updated/total/failed counts.

- [ ] **Step 5: Restore requirement editing and export**

In `RequirementDetail.tsx`, add Edit and Export actions. Seed the edit form from the loaded item. Save with `api.updateRequirement(code, values)` and replace the displayed item with the response. Export with `api.exportRequirement(code)` and show `已导出到 <outputDir>`. Link each related version to its React workbench route.

All operation failures call `message.error(errorText(error, fallback))` and keep the modal open.

- [ ] **Step 6: Verify all three requirement/search rows**

```bash
node --test web/src/pages/searchModel.test.js
cd web && npm run build
```

Expected: two tests pass; build exits 0. Exercise current/all search, saved view, external token/search/import/sync, requirement edit/export, and linked version navigation. Mark Search, Requirements, and Requirement detail `verified`.

- [ ] **Step 7: Commit the search and requirement workflows**

Stage only the seven listed files and commit:

```bash
git add web/src/pages/searchModel.js web/src/pages/searchModel.test.js web/src/pages/Search.tsx web/src/pages/Requirements.tsx web/src/pages/RequirementDetail.tsx web/src/styles/global.css docs/react-parity-matrix.md
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: restore React search and requirement parity"
```

### Task 8: Restore Milestone Planning and Synchronization

**Files:**

- Create: `web/src/pages/milestoneModel.js`
- Create: `web/src/pages/milestoneModel.test.js`
- Modify: `web/src/pages/Milestones.tsx`
- Modify: `web/src/pages/MilestoneDetail.tsx`
- Modify: `web/src/styles/global.css`
- Modify: `docs/react-parity-matrix.md`

- [ ] **Step 1: Test milestone item normalization**

Create `web/src/pages/milestoneModel.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { milestoneItems, withoutMilestoneItem } from './milestoneModel.js'

const source = [
  { requirement: 'REQ-1', project: 'orders', version: 'v1', title: 'ignored' },
  { requirement: 'REQ-2', project: 'orders', versionNo: 'v2' }
]

test('keeps only persisted milestone item fields', () => {
  assert.deepEqual(milestoneItems(source), [
    { requirement: 'REQ-1', project: 'orders', version: 'v1' },
    { requirement: 'REQ-2', project: 'orders', version: 'v2' }
  ])
})

test('removes one exact scope item', () => {
  assert.deepEqual(withoutMilestoneItem(source, source[0]), [{ requirement: 'REQ-2', project: 'orders', version: 'v2' }])
})
```

- [ ] **Step 2: Implement milestone normalization**

Create `web/src/pages/milestoneModel.js`:

```js
export function milestoneItems(items = []) {
  return items.map(item => ({
    requirement: item.requirement,
    project: item.project,
    version: item.version || item.versionNo
  }))
}

export function withoutMilestoneItem(items, removed) {
  return milestoneItems(items.filter(item => item !== removed))
}
```

- [ ] **Step 3: Restore list-level synchronization**

In `Milestones.tsx`, add `syncExternal` to the create form. After `createMilestone`, call `api.syncMilestone(item.name)` only when checked. Add “同步全部” calling `api.syncMilestones()` and report `created`, `updated`, and `failed.length`. Disable writes when runtime `health.canWrite === false`.

Keep the UI-only checkbox out of the persisted body:

```tsx
const { syncExternal, range, ...draft } = values;
let item: any = await api.createMilestone({
  ...draft,
  startAt: range?.[0]?.format('YYYY-MM-DD') || '',
  endAt: range?.[1]?.format('YYYY-MM-DD') || '',
  items: [],
});
if (syncExternal) item = await api.syncMilestone(item.name);
```

- [ ] **Step 4: Restore milestone scope editing, export, and sync**

In `MilestoneDetail.tsx`, load milestone, requirements, and projects. When a project is selected, call `api.listVersions(project, { includeDraft: true, includeVoid: false })` for the version selector.

Use these exact writes:

```tsx
const addItem = async () => {
  const values = await form.validateFields();
  const items = [...milestoneItems(item.items), values];
  setItem(await api.updateMilestone(name, { items }));
  form.resetFields();
};

const removeItem = async (entry: any) => {
  setItem(await api.updateMilestone(name, { items: withoutMilestoneItem(item.items, entry) }));
};

const exportPackage = async () => {
  const result: any = await api.exportMilestone(name);
  message.success(`已导出到 ${result.outputDir}`);
};

const syncExternal = async () => {
  setItem(await api.syncMilestone(name));
  message.success('已同步到任务平台');
};
```

Render warning text from `item.warnings`, add/remove controls, and links to every selected workbench version.

- [ ] **Step 5: Test, build, and close milestone rows**

```bash
node --test web/src/pages/milestoneModel.test.js
cd web && npm run build
```

Expected: two tests pass and build exits 0. Verify create with/without sync, bulk sync, add/remove item, export, and single sync. Mark both Milestone rows `verified`.

- [ ] **Step 6: Commit milestone parity**

```bash
git add web/src/pages/milestoneModel.js web/src/pages/milestoneModel.test.js web/src/pages/Milestones.tsx web/src/pages/MilestoneDetail.tsx web/src/styles/global.css docs/react-parity-matrix.md
git diff --cached --check
git commit -m "feat: restore React milestone parity"
```

### Task 9: Restore Delivery, Watch Inbox (草稿箱), and Trash (回收站) Actions

**Files:**

- Modify: `web/src/pages/Deliveries.tsx`
- Modify: `web/src/pages/WatchInbox.tsx`
- Modify: `web/src/pages/Trash.tsx`
- Modify: `web/src/styles/global.css`
- Modify: `docs/react-parity-matrix.md`

- [ ] **Step 1: Restore delivery notification configuration**

In `Deliveries.tsx`, add a “通知设置” modal with provider select (`wecom`, `dingtalk`, `feishu`) and password-style webhook input. Implement:

```tsx
const testNotification = async () => {
  const values = await notificationForm.validateFields();
  setTesting(true);
  try {
    await api.testNotification(values);
    message.success('测试通知已发送');
  } catch (error) {
    message.error(errorText(error, '测试通知失败'));
  } finally { setTesting(false); }
};

const saveWebhook = async () => {
  const values = await notificationForm.validateFields();
  await api.setNotificationWebhook(values.provider, values.webhookUrl);
  notificationForm.setFieldValue('webhookUrl', '');
  message.success('Webhook 已保存到钥匙串');
};
```

Keep snapshot creation and pending notification retry. Every async button catches errors and preserves inputs.

- [ ] **Step 2: Restore watch actions and error detail**

In `WatchInbox.tsx`, use `WATCH_STATUS` for label/color. Render filename, project, suggested version, error, and collected time. Archived items navigate to their version. Failed items show a write-permission-aware Retry button:

```tsx
const retry = async (item: any) => {
  setBusy(item.id);
  try {
    await api.retryWatchItem(item.id);
    message.success('已重新归档');
    await load();
  } catch (error) {
    message.error(errorText(error, '重新归档失败'));
  } finally { setBusy(''); }
};
```

- [ ] **Step 3: Restore deleted versions**

In `Trash.tsx`, add a restore button with tooltip “恢复后状态重置为编辑中，不会自动变回基线”. Confirm, call `api.restoreVersion(item.project, item.versionNo)`, show `<versionNo> 已恢复`, and reload. Disable in read-only mode.

- [ ] **Step 4: Build and exercise all mutations**

```bash
cd web && npm run build
```

Expected: build exits 0. Verify notification test/save, retry queue, archived navigation, failed retry, restore success, restore failure retention, and read-only disabled states. Mark Deliveries, Watch inbox, and Trash `verified`.

- [ ] **Step 5: Commit delivery and recovery parity**

```bash
git add web/src/pages/Deliveries.tsx web/src/pages/WatchInbox.tsx web/src/pages/Trash.tsx web/src/styles/global.css docs/react-parity-matrix.md
git diff --cached --check
git commit -m "feat: restore React delivery and recovery actions"
```

### Task 10: Restore Workspace, Software Update, and Operation Log Settings

**Files:**

- Create: `web/src/pages/settings/OperationLog.tsx`
- Create: `web/src/pages/settings/SoftwareUpdateSection.tsx`
- Modify: `web/src/pages/Settings.tsx`
- Modify: `web/src/pages/settings/SettingsSections.tsx`
- Modify: `web/src/pages/settings/settingsConfig.tsx`
- Modify: `web/src/styles/global.css`
- Modify: `docs/react-parity-matrix.md`

- [ ] **Step 1: Add the React operation log table**

Create `OperationLog.tsx` with prop `{ embedded?: boolean }`. Load `api.oplog(undefined, 300)` on mount, show a retryable error, and render an Ant Design `Table` with time (`fmtAbsolute`), actor, project, action, and detail. Use `operationMeta(action)` for action label and color. Use page size 20 and horizontal scroll 760.

The loader is:

```tsx
const load = useCallback(async () => {
  setLoading(true);
  setError('');
  try { setLogs(await api.oplog(undefined, 300)); }
  catch (error) { setError(errorText(error, '无法读取操作日志')); }
  finally { setLoading(false); }
}, []);
```

- [ ] **Step 2: Extend workspace management**

Expand `WorkspaceSection` props with `canWrite`, `busy`, `onRegister`, `onClone`, and `onRebuildIndex`. Add existing/clone tabs and a form containing URL (clone only), local path, display name, and mirror checkbox. Submit existing mode to `api.registerWorkspace`; submit clone mode to `api.cloneWorkspace`. Rebuild calls `api.buildWorkspaceIndex()` and reports the returned count/path without changing repositories.

Use these Settings handlers:

```tsx
const saveWorkspace = async (mode: 'existing' | 'clone', values: any) => {
  setBusy('workspaceSave');
  try {
    const body = { path: values.path.trim(), name: values.name?.trim(), mirror: Boolean(values.mirror) };
    if (mode === 'clone') await api.cloneWorkspace({ ...body, url: values.url.trim() });
    else await api.registerWorkspace(body);
    message.success(mode === 'clone' ? '仓库已克隆并注册' : '工作区已注册');
    await load();
  } finally { setBusy(''); }
};
```

- [ ] **Step 3: Add software update state and safety guard**

Create `SoftwareUpdateSection.tsx` with props `{ canWrite, version }`. On mount call `api.softwareUpdateStatus()`. “检测更新” calls with `{ fetchRemote: true }`. Render current/latest version, path, upstream, availability, dirty state, notes, and error.

Use this loader so initial and remote-refresh behavior cannot diverge:

```tsx
const load = useCallback(async (fetchRemote = false) => {
  setChecking(true);
  try {
    setStatus(await api.softwareUpdateStatus({ fetchRemote }));
  } catch (error) {
    setStatus((current: any) => ({ ...current, error: errorText(error, '检测软件更新失败') }));
  } finally { setChecking(false); }
}, []);
```

Update only after an Ant Design confirmation:

```tsx
modal.confirm({
  title: '拉取并更新 Flowlark？',
  content: '更新完成后需要重启服务。未提交的软件目录改动会阻止更新。',
  okText: '拉取并更新',
  onOk: async () => {
    setApplying(true);
    try {
      const result: any = await api.pullSoftwareUpdate();
      message.success(result.message || '软件已更新，请重启 Flowlark');
      await load(true);
    } finally { setApplying(false); }
  },
});
```

Disable the update button when unavailable, dirty, read-only, or applying.

- [ ] **Step 4: Wire settings navigation**

Add section descriptions and icons:

Insert these exact properties inside the existing `SECTION_DESCRIPTIONS` object:

```tsx
softwareUpdate: '检测并安全拉取 Flowlark 软件仓库更新。',
oplog: '查看随 Git 保存的语义操作记录。',
mcp: '连接外部需求、迭代和扩展能力。',
```

Insert these exact properties inside the existing `SETTING_ICONS` object:

```tsx
softwareUpdate: <CloudDownloadOutlined />,
oplog: <HistoryOutlined />,
mcp: <ApiOutlined />,
```

Insert these fixed sections after `gitRemote` and before schema-derived groups in `Settings.tsx`:

```tsx
{ key: 'softwareUpdate', label: '软件更新', description: SECTION_DESCRIPTIONS.softwareUpdate, modified: 0 },
{ key: 'oplog', label: '操作日志', description: SECTION_DESCRIPTIONS.oplog, modified: 0 },
{ key: 'mcp', label: 'MCP 中心', description: SECTION_DESCRIPTIONS.mcp, modified: 0 },
```

Add icons using only `@ant-design/icons`. Render `OperationLog embedded` for `oplog` and `SoftwareUpdateSection` for `softwareUpdate`. Preserve `/settings/:section` URL behavior and `/oplog` redirect.

- [ ] **Step 5: Build and close three matrix rows**

```bash
cd web && npm run build
```

Expected: build exits 0. Verify register, clone, remove, index, update check, dirty guard, pull confirmation, and operation-log pagination. Mark Workspaces, Software update, and Operation log `verified`.

- [ ] **Step 6: Commit system settings parity**

Stage only the seven listed files and commit:

```bash
git add web/src/pages/settings/OperationLog.tsx web/src/pages/settings/SoftwareUpdateSection.tsx web/src/pages/Settings.tsx web/src/pages/settings/SettingsSections.tsx web/src/pages/settings/settingsConfig.tsx web/src/styles/global.css docs/react-parity-matrix.md
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: restore React workspace and system settings"
```

### Task 11: Restore the MCP Center

**Files:**

- Create: `web/src/pages/settings/mcpModel.js`
- Create: `web/src/pages/settings/mcpModel.test.js`
- Create: `web/src/pages/settings/McpSection.tsx`
- Modify: `web/src/pages/Settings.tsx`
- Modify: `web/src/styles/global.css`
- Modify: `docs/react-parity-matrix.md`

- [ ] **Step 1: Write MCP form-model tests**

Create `web/src/pages/settings/mcpModel.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { capabilityPayload, parseHeaders, serverForm, serverPayload } from './mcpModel.js'

test('round-trips server fields and headers', () => {
  const form = serverForm({ id: 'req', name: '需求', url: 'https://mcp.test', enabled: false, timeoutMs: 5000, headers: { Authorization: 'Bearer ${secret}' } })
  assert.equal(form.headersText, '{\n  "Authorization": "Bearer ${secret}"\n}')
  assert.deepEqual(serverPayload(form), {
    name: '需求', type: 'http', enabled: false, url: 'https://mcp.test', timeoutMs: 5000,
    headers: { Authorization: 'Bearer ${secret}' }
  })
})

test('rejects non-object header JSON', () => {
  assert.throws(() => parseHeaders('[]'), /请求头必须是 JSON 对象/)
})

test('normalizes capability tools', () => {
  assert.deepEqual(capabilityPayload({ enabled: true, server: 'req', label: '需求', category: 'product', description: '', project: 'safe', toolsText: '{"test":"requirements.test"}' }), {
    enabled: true, server: 'req', label: '需求', category: 'product', description: '', project: 'safe', tools: { test: 'requirements.test' }
  })
})
```

- [ ] **Step 2: Implement MCP form normalization**

Create `web/src/pages/settings/mcpModel.js`:

```js
function parseObjectJson(text, label) {
  if (!String(text || '').trim()) return {}
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是 JSON 对象`)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(key).trim(), String(item)]).filter(([key]) => key))
}

export function parseHeaders(text) {
  return parseObjectJson(text, '请求头')
}

export function serverForm(server = {}) {
  return {
    id: server.id || '', name: server.name || '', type: server.type || 'http', enabled: server.enabled !== false,
    url: server.url || '', timeoutMs: Number(server.timeoutMs || 10000),
    headersText: JSON.stringify(server.headers || { Authorization: 'Bearer ${secret}' }, null, 2)
  }
}

export function serverPayload(form) {
  return {
    name: form.name.trim(), type: form.type || 'http', enabled: form.enabled !== false,
    url: form.url.trim(), timeoutMs: Number(form.timeoutMs || 10000), headers: parseHeaders(form.headersText)
  }
}

export function capabilityPayload(form) {
  const tools = parseObjectJson(form.toolsText, '工具映射')
  return {
    enabled: Boolean(form.enabled), server: form.server || '', label: form.label.trim(),
    category: form.category.trim(), description: form.description.trim(), project: form.project.trim(), tools
  }
}
```

- [ ] **Step 3: Build the MCP service editor**

Create `McpSection.tsx` with props `{ canWrite: boolean }`. Load `api.getMcpConfig()` and render problems, service count, enabled capability count, file name, and existence state.

The service form must include ID, name, URL, type, enabled, timeout, request-header JSON, and local secret. ID is disabled while editing an existing service. Implement save/remove/secret operations:

```tsx
const saveServer = async () => {
  const values = await serverAntForm.validateFields();
  setSaving('server');
  try {
    const next = await api.saveMcpServer(values.id.trim(), serverPayload(values));
    if (secret) await api.setMcpServerSecret(values.id.trim(), secret);
    setSecret('');
    setInfo(next);
    message.success('MCP 服务已保存');
  } catch (error) {
    message.error(errorText(error, 'MCP 服务保存失败'));
  } finally { setSaving(''); }
};
```

Removal uses confirmation and `api.removeMcpServer(id)`. Secret save and delete use `setMcpServerSecret` and `deleteMcpServerSecret`; never display a stored value.

- [ ] **Step 4: Build built-in and extension capability editors**

Render `requirements` and `milestones` capability forms plus a generic extension form. Every form includes enabled, server, project, label/category/description where applicable, and JSON tool mapping. Save with `api.saveMcpCapability(name, capabilityPayload(values))`; test with `api.testMcpCapability(name)` and display returned identity/result; extension removal calls `api.removeMcpCapability(name)` after confirmation. Built-in capabilities have no delete action.

Use the accessible field label `需求绑定服务` for the requirement server selector and `迭代绑定服务` for the milestone selector. Use stable action names: `保存需求能力`, `测试需求能力`, `保存迭代能力`, `测试迭代能力`, and for an extension `保存扩展能力`, `测试 工单`, `删除 工单` when the example extension label is “工单”.

Use server options from `info.config.servers`; enabling without a server remains a backend-validated error and preserves the form.

- [ ] **Step 5: Wire and verify the MCP settings route**

Render `<McpSection canWrite={canWrite} />` when `activeMeta.key === 'mcp'` in `Settings.tsx`.

Run:

```bash
node --test web/src/pages/settings/mcpModel.test.js
cd web && npm run build
```

Expected: three tests pass; build exits 0. Exercise service add/edit/delete, secret set/delete, built-in mapping save/test, extension add/test/delete, invalid JSON, disabled server, and read-only mode. Mark MCP `verified`.

- [ ] **Step 6: Commit MCP parity**

```bash
git add web/src/pages/settings/mcpModel.js web/src/pages/settings/mcpModel.test.js web/src/pages/settings/McpSection.tsx web/src/pages/Settings.tsx web/src/styles/global.css docs/react-parity-matrix.md
git diff --cached --check
git commit -m "feat: restore React MCP center"
```

### Task 12: Delete the Legacy Framework and Add a Permanent Guard

**Prerequisite:** Every reachable matrix row is `verified`; Setup wizard is `delete-unreachable`.

**Files:**

- Create: `web/src/frameworkGuard.test.js`
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `design-system/flowlark/MASTER.md`
- Modify: `assets/brand/README.md`
- Modify: `web/vite.config.js`
- Modify: `docs/react-parity-matrix.md`
- Delete: all legacy files listed in the File Map.

- [ ] **Step 1: Write the final framework guard before deletion**

Create `web/src/frameworkGuard.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(webRoot, 'src')

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(absolute) : [absolute]
  })
}

test('ships only the React frontend framework', () => {
  const files = filesUnder(sourceRoot)
  assert.deepEqual(files.filter(file => file.endsWith('.' + 'v' + 'ue')), [])

  const active = files.filter(file => !file.endsWith('.test.js')).map(file => fs.readFileSync(file, 'utf8')).join('\n')
  const banned = ['v' + 'ue-router', 'p' + 'inia', '@arco-design/web-' + 'vue', '@umijs/' + 'max']
  for (const value of banned) assert.equal(active.includes(value), false, `legacy reference: ${value}`)

  const pkg = JSON.parse(fs.readFileSync(path.join(webRoot, 'package.json'), 'utf8'))
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const value of ['v' + 'ue', 'v' + 'ue-router', 'p' + 'inia', '@arco-design/web-' + 'vue']) {
    assert.equal(value in dependencies, false, `legacy dependency: ${value}`)
  }

  const index = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8')
  assert.match(index, /src="\/src\/main\.tsx"/)
  assert.doesNotMatch(index, /src="\/src\/main\.js"/)
})
```

- [ ] **Step 2: Run the guard and verify it fails on legacy files**

```bash
node --test web/src/frameworkGuard.test.js
```

Expected: FAIL listing `.vue` files and/or legacy references.

- [ ] **Step 3: Prove every legacy file is unreachable, then delete it**

Run:

```bash
rg -n "from ['\"].*(App\.vue|main\.js|router\.js|store\.js|api\.js|style\.css|brand\.js|ui/feedback|ui/status)|import\(.*\.vue" web/src --glob '!*.vue' --glob '!main.js' --glob '!router.js' --glob '!store.js' --glob '!api.js'
```

Expected: no React consumer.

Delete every `.vue` file and these exact legacy modules using `apply_patch`: `main.js`, `router.js`, `store.js`, `api.js`, `utils.js`, `style.css`, `brand.js`, `ui/feedback.js`, `ui/status.js`, and `umi-shim.ts` if it was not already deleted.

Do not delete `services/api.ts`, `utils/format.ts`, React `.js` model files, or prototype HTML support.

- [ ] **Step 4: Update current-stack documentation**

Make these exact semantic replacements:

- `DESIGN.md`: current stack becomes React 19 + React Router 7 + Ant Design 6 + existing `--fl-*` tokens; icons become `@ant-design/icons`.
- `design-system/flowlark/MASTER.md`: implementation becomes React/TSX + Ant Design + Vite; token source becomes `web/src/styles/global.css` plus `ConfigProvider` in `main.tsx`.
- `README.md`: repository tree says React 19 workbench; runtime paragraph says React/Ant Design are build-time web dependencies; remove the Vue `unplugin-vue-components` optimization suggestion and describe the existing non-blocking bundle warning accurately.
- `assets/brand/README.md`: replace the deleted `BrandMark.vue` instruction with `/logo.svg` or the React shell's brand mark implementation.

Historical files under `docs/superpowers/specs/` and `docs/superpowers/plans/` keep historical Vue/Arco wording.

- [ ] **Step 5: Pass the guard and static audits**

```bash
node --test web/src/frameworkGuard.test.js
find web/src -type f -name '*.vue'
rg -n "@umijs/max|@arco-design/web-vue|from ['\"]vue['\"]|from ['\"]vue-router['\"]|from ['\"]pinia['\"]" web/src web/vite.config.js web/package.json
rg -n "Vue 3|Arco Design Vue|Vue / Ant Design Vue|web/ +Vue" README.md DESIGN.md design-system/flowlark/MASTER.md assets/brand/README.md
```

Expected: one framework-guard test passes; all four audit commands after it produce no matches.

- [ ] **Step 6: Build and run all Node tests after deletion**

```bash
cd web && npm run build
cd .. && npm test
```

Expected: build exits 0; at least 268 tests pass plus all new model and guard tests; 0 fail.

- [ ] **Step 7: Mark the matrix complete and commit deletion**

Add a final note to `docs/react-parity-matrix.md` using the exact observed test count from Step 6, followed by `production build passed; zero active Vue/Pinia/Arco/Umi references.` Record the observed count directly.

Stage only the documented current-stack files, guard, matrix, and exact deletions. Inspect `git diff --cached --name-status` before committing:

```bash
git commit -m "chore: remove legacy Vue frontend"
```

### Task 13: Run Full UI Regression and Final Acceptance

**Files:**

- Modify: `.codex-ui-regression/ui-regression.spec.js`
- Modify: `docs/react-parity-matrix.md`

- [ ] **Step 1: Extend route coverage**

Add these routes to the existing route table:

```js
['search', '/search'],
['settings-oplog', '/settings/oplog'],
['settings-mcp', '/settings/mcp'],
['settings-update', '/settings/softwareUpdate']
```

Keep desktop 1280×900, wide 1920×1080, and mobile 390×844 coverage. Every route must assert HTTP status below 400, no page error, no unexpected console error, no empty visible alert, and no page-level horizontal overflow.

Add this preview isolation assertion to the existing workbench route check:

```js
const preview = page.locator('iframe').first()
await expect(preview).toBeVisible()
const previewSrc = await preview.getAttribute('src')
expect(new URL(previewSrc).port).not.toBe(new URL(baseUrl).port)
expect(await preview.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-popups allow-modals')
```

- [ ] **Step 2: Add mocked workflow assertions for newly restored actions**

Add Playwright route mocks and tests for:

```js
test('restored mutation actions remain reachable', async ({ page }) => {
  const calls = []
  await page.route('**/api/watch/inbox', route => route.fulfill({ json: [{ id: 'failed-1', title: '失败原型', status: 'failed', error: '解析失败' }] }))
  await page.route('**/api/watch/inbox/failed-1/retry', route => { calls.push('watch-retry'); return route.fulfill({ json: { ok: true } }) })
  await page.goto(new URL('/#/watch', baseUrl).toString(), { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '重试' }).click()
  expect(calls).toContain('watch-retry')

  await page.route('**/api/trash', route => route.fulfill({ json: [{ project: 'orders', versionNo: 'v1', deletedAt: '2026-08-25T00:00:00Z' }] }))
  await page.route('**/api/versions/orders/v1/restore', route => { calls.push('trash-restore'); return route.fulfill({ json: { ok: true } }) })
  await page.goto(new URL('/#/trash', baseUrl).toString(), { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '恢复' }).click()
  await page.getByRole('button', { name: /确定|恢复/ }).last().click()
  expect(calls).toContain('trash-restore')
})
```

Add these explicit tests after the watch/trash test. Keep role/name selectors for interactive controls:

```js
test('requirement edit and export call the React APIs', async ({ page }) => {
  const calls = []
  await page.route('**/api/requirements/REQ-1', async route => {
    if (route.request().method() === 'PUT') {
      calls.push('requirement-edit')
      return route.fulfill({ json: { code: 'REQ-1', title: '更新标题', description: '说明', owner: 'PM', versions: [] } })
    }
    return route.fulfill({ json: { code: 'REQ-1', title: '旧标题', description: '说明', owner: 'PM', versions: [] } })
  })
  await page.route('**/api/export/requirement/REQ-1', route => {
    calls.push('requirement-export')
    return route.fulfill({ json: { outputDir: '/tmp/req-export' } })
  })
  await page.goto(new URL('/#/requirements/REQ-1', baseUrl).toString(), { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '编辑' }).click()
  await page.getByLabel('标题').fill('更新标题')
  await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
  await expect.poll(() => calls).toContain('requirement-edit')
  await page.getByRole('button', { name: '导出需求包' }).click()
  await expect.poll(() => calls).toContain('requirement-export')
})

test('milestone sync and export remain reachable', async ({ page }) => {
  const calls = []
  const milestone = { name: 'S1', title: '迭代一', ready: false, warnings: [], items: [] }
  await page.route('**/api/milestones/S1', route => route.fulfill({ json: milestone }))
  await page.route('**/api/milestones/S1/sync', route => {
    calls.push('milestone-sync')
    return route.fulfill({ json: { ...milestone, external: { status: 'synced' } } })
  })
  await page.route('**/api/export/milestone/S1', route => {
    calls.push('milestone-export')
    return route.fulfill({ json: { outputDir: '/tmp/milestone-export' } })
  })
  await page.goto(new URL('/#/milestones/S1', baseUrl).toString(), { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '同步到任务平台' }).click()
  await expect.poll(() => calls).toContain('milestone-sync')
  await page.getByRole('button', { name: '导出迭代包' }).click()
  await expect.poll(() => calls).toContain('milestone-export')
})

test('delivery webhook can be tested and saved without exposing the value', async ({ page }) => {
  const calls = []
  await page.route('**/api/notifications/test', route => {
    calls.push('notification-test')
    return route.fulfill({ json: { ok: true } })
  })
  await page.route('**/api/notifications/wecom/webhook', route => {
    calls.push('notification-save')
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto(new URL('/#/deliveries', baseUrl).toString(), { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '通知设置' }).click()
  await page.getByLabel('Webhook').fill('https://hooks.example.test/demo')
  await page.getByRole('button', { name: '发送测试' }).click()
  await expect.poll(() => calls).toContain('notification-test')
  await page.getByRole('button', { name: '保存 Webhook' }).click()
  await expect.poll(() => calls).toContain('notification-save')
  await expect(page.getByLabel('Webhook')).toHaveValue('')
})

test('workspace index and software dirty guard are visible', async ({ page }) => {
  const calls = []
  await page.route('**/api/workspace-index', route => {
    calls.push('workspace-index')
    return route.fulfill({ json: { count: 3, path: '/tmp/index.json' } })
  })
  await page.goto(new URL('/#/settings', baseUrl).toString(), { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '重建索引' }).click()
  await expect.poll(() => calls).toContain('workspace-index')

  await page.route('**/api/update/software*', route => route.fulfill({ json: {
    currentVersion: '0.7.0', latestVersion: '0.8.0', available: true, dirty: true,
    path: '/tmp/flowlark', upstream: 'origin/main'
  } }))
  await page.goto(new URL('/#/settings/softwareUpdate', baseUrl).toString(), { waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: '拉取并更新' })).toBeDisabled()
  await expect(page.getByText(/未提交的软件目录改动|软件目录有未提交改动/)).toBeVisible()
})

test('MCP service and requirement capability can be saved and tested', async ({ page }) => {
  const calls = []
  const info = {
    file: 'mcp.json', exists: false, problems: [],
    config: {
      servers: [],
      capabilities: {
        requirements: { enabled: false, server: '', label: '需求', category: 'product', description: '', project: '', tools: { test: 'requirements.test' } },
        milestones: { enabled: false, server: '', label: '迭代', category: 'delivery', description: '', project: '', tools: { test: 'milestones.test' } }
      }
    }
  }
  await page.route('**/api/mcp', route => route.fulfill({ json: info }))
  await page.route('**/api/mcp/servers/requirements-mcp', route => {
    calls.push('mcp-server-save')
    return route.fulfill({ json: { ...info, exists: true, config: { ...info.config, servers: [{ id: 'requirements-mcp', name: '需求 MCP', url: 'https://mcp.test', enabled: true }] } } })
  })
  await page.route('**/api/mcp/capabilities/requirements', route => {
    calls.push(route.request().method() === 'POST' ? 'mcp-requirement-test' : 'mcp-requirement-save')
    return route.fulfill({ json: route.request().method() === 'POST' ? { identity: 'MCP User' } : info })
  })
  await page.goto(new URL('/#/settings/mcp', baseUrl).toString(), { waitUntil: 'networkidle' })
  await page.getByLabel('服务标识').fill('requirements-mcp')
  await page.getByLabel('显示名称').fill('需求 MCP')
  await page.getByLabel('MCP URL').fill('https://mcp.test')
  await page.getByRole('button', { name: '保存服务' }).click()
  await expect.poll(() => calls).toContain('mcp-server-save')
  await page.getByLabel('需求绑定服务').click()
  await page.getByRole('option', { name: /需求 MCP|requirements-mcp/ }).click()
  await page.getByRole('button', { name: '保存需求能力' }).click()
  await expect.poll(() => calls).toContain('mcp-requirement-save')
  await page.getByRole('button', { name: '测试需求能力' }).click()
  await expect.poll(() => calls).toContain('mcp-requirement-test')
})
```

- [ ] **Step 3: Start a disposable real Flowlark fixture**

Use a temporary directory, initialize a project, add two HTML versions, baseline one, and start the backend plus Vite:

```bash
FIXTURE=$(mktemp -d)
cd "$FIXTURE"
node /Users/beluga/Flowlark/bin/flowlark.js init
node /Users/beluga/Flowlark/bin/flowlark.js new "订单中心" --code orders
node -e "require('node:fs').writeFileSync('v1.html', '<!doctype html><html><body>v1</body></html>')"
node -e "require('node:fs').writeFileSync('v2.html', '<!doctype html><html><body>v2</body></html>')"
node /Users/beluga/Flowlark/bin/flowlark.js add v1.html -p orders -n v1 -t "首版" -m "新增:首页:建立首页"
node /Users/beluga/Flowlark/bin/flowlark.js add v2.html -p orders -n v2 -t "二版" -m "修改:首页:调整首页"
node /Users/beluga/Flowlark/bin/flowlark.js baseline orders v1
node /Users/beluga/Flowlark/bin/flowlark.js serve --port 7788
```

In a second terminal/session:

```bash
cd /Users/beluga/Flowlark/web
npm run dev -- --host 127.0.0.1
```

- [ ] **Step 4: Run Playwright regression**

Run the existing Playwright test using the installed workspace runtime or local Playwright package available in the environment. If using the bundled runtime:

```bash
BASE_URL=http://127.0.0.1:5173 /Users/beluga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.bin/playwright test /Users/beluga/Flowlark/.codex-ui-regression/ui-regression.spec.js --workers=1
```

Expected: all route, layout, timeline, workbench, and restored-action tests pass at the declared viewports; screenshots and JSON report are written under `.codex-ui-regression/`.

- [ ] **Step 5: Run final static, unit, build, and working-tree checks**

```bash
cd /Users/beluga/Flowlark
node --test web/src/**/*.test.js
npm test
cd web && npm run build
cd ..
git diff --check
git status --short
```

Expected: all new frontend model/guard tests pass; complete root suite passes; Vite build exits 0; no whitespace errors; only known user changes and this task's intended files remain.

- [ ] **Step 6: Record final evidence and commit the regression update**

Append exact test count, build result, Playwright pass count, viewports, and zero-legacy audit result to `docs/react-parity-matrix.md`.

```bash
git add .codex-ui-regression/ui-regression.spec.js docs/react-parity-matrix.md
git diff --cached --name-only
git diff --cached --check
git commit -m "test: verify React framework consolidation"
```

## Final Self-Check

- [ ] Every approved design requirement maps to a task above.
- [ ] Every reachable matrix row is `verified` before Vue deletion.
- [ ] `SetupWizard.vue` is documented as unreachable before deletion.
- [ ] No backend storage, API route, CLI, or preview-sandbox contract changed.
- [ ] No new state framework or component library was added.
- [ ] Existing user changes were never reset, broadly staged, or silently overwritten.
- [ ] Production build, complete tests, Playwright regression, and no-legacy audits pass.
