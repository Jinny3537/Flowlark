# Flowlark v0.7.2 Sync Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `v0.7.2` synchronization and migration foundation: schema 3, project-level sync policy, deterministic persisted sync previews, a resumable global queue, redacted team audit records, and a Sync Center UI without enabling unattended remote writes.

**Architecture:** Keep the existing milestone sync planner and executor as the only remote mutation path. Add small domain modules for policy, schema backup/migration, queue records, and append-only audit; adapt the existing milestone journal to those modules instead of creating a second execution engine. Expose only fixed server-owned sync actions through the HTTP API, then add a read-focused Sync Center and per-project synchronization settings in React.

**Tech Stack:** Node.js 20 ESM, `node:test`, Hono-based local HTTP routes, React 19, React Router 7, Ant Design 6, Vite 5, JSON/NDJSON file storage, Git.

---

## Scope Guard

Implement only the `v0.7.2` foundation approved in the product design:

- schema 3 migration, backup, validation, and rollback;
- project-level sync policy and managed-field declaration;
- persisted manual sync previews;
- one global view over sync records;
- step-level redacted audit records;
- fixed execute, resume, and cancel actions for known milestone sync records;
- Sync Center and project sync settings;
- local-only degradation when MCP is unavailable.

Do not implement:

- explicit requirement lifecycle states;
- new requirement-to-task or milestone-to-Sprint mapping behavior;
- configurable acceptance roles or acceptance records;
- feedback severity gates;
- automatic remote execution;
- automatic external task completion, Sprint ending, or milestone archival;
- multiple active remote platforms per project;
- a generic workflow engine or browser-selectable MCP tool calls.

The existing `v0.7.1` recent-work changes remain intact. Before the first code change, verify the current branch still builds and record the full baseline test result. Do not tag or publish a release as part of this plan.

## Success Criteria

1. A schema 2 repository upgrades to schema 3 after a recoverable metadata backup.
2. A forced migration failure restores all touched metadata byte-for-byte.
3. Every milestone sync preview is persisted as `pending-confirmation` and appears in the global Sync Center.
4. Execute and retry requests can only dispatch a server-recognized milestone record; a browser cannot choose an MCP tool name.
5. Every queue and step transition emits a redacted audit entry without secrets or runtime environment values.
6. Reusing the same plan hash does not create a duplicate queue record or duplicate remote operation.
7. MCP failure leaves local data usable and exposes an actionable failed or paused state.
8. `npm test` and `npm run build:web` pass after the change.

## File Map

| File | Responsibility |
|---|---|
| `src/core/sync-policy.js` | Normalize and validate project sync policy and trusted-mode readiness |
| `test/sync-policy.test.js` | Policy defaults, normalization, managed fields, and readiness tests |
| `src/core/metadata-backup.js` | Create, validate, and restore schema migration backups |
| `test/metadata-backup.test.js` | Byte-for-byte restore and missing-file restore tests |
| `src/core/migrate.js` | Orchestrate schema 1 → 2 → 3 migrations and rollback |
| `src/core/repo.js` | Raise repository schema to 3 and initialize ignore/merge rules |
| `src/core/json.js` | Stable serialization order for new project sync fields |
| `src/core/service.js` | Trigger latest migration and persist normalized project policy |
| `test/migrate.test.js` | Schema 3 migration, validation failure, and rollback coverage |
| `src/core/sync-audit.js` | Append and read redacted team-visible NDJSON audit entries |
| `test/sync-audit.test.js` | Redaction, stable entries, limit, and malformed-tail coverage |
| `src/core/sync-queue.js` | Persist current sync records and enforce queue transitions |
| `test/sync-queue.test.js` | Idempotency, transition, cancellation, and atomic-write tests |
| `src/core/milestone-sync-journal.js` | Compatibility wrapper from milestone journal calls to the global queue |
| `src/core/milestone-sync.js` | Emit queue and audit transitions around existing remote operations |
| `test/milestone-sync.test.js` | Preserve executor behavior and add audit/queue assertions |
| `src/server/routes.js` | Fixed global sync and audit endpoints |
| `test/sync-center-api.test.js` | API list, execute, retry, cancel, validation, and read-only tests |
| `web/src/services/api.ts` | Typed Sync Center and project sync policy API calls |
| `web/src/pages/syncCenterModel.js` | Pure filtering, counts, labels, and safe action decisions |
| `web/src/pages/syncCenterModel.test.js` | Deterministic UI model tests |
| `web/src/pages/SyncCenter.tsx` | Global synchronization work queue UI |
| `web/src/pages/projectSyncModel.js` | Project sync form defaults, payload, and readiness copy |
| `web/src/pages/projectSyncModel.test.js` | Project sync form and payload tests |
| `web/src/pages/ProjectSyncSettings.tsx` | Per-project service, mapping, policy, and readiness page |
| `web/src/pages/Projects.tsx` | Add a project-menu route to synchronization settings |
| `web/src/main.tsx` | Register `/sync` and `/projects/:slug/sync` routes |
| `web/src/runtime/AppRuntime.tsx` | Load a non-blocking global sync-attention count with existing runtime data |
| `web/src/components/AppShell.tsx` | Add Sync Center navigation and pending-count badge |
| `web/src/styles/global.css` | Responsive Sync Center and project sync settings styles |
| `docs/STORAGE.md` | Document schema 3 files, cache, backup, and audit behavior |
| `docs/ASSESS-TASK-MCP.md` | Document manual policy, persisted previews, and recovery |
| `CHANGELOG.md` | Describe the `v0.7.2` sync foundation under Unreleased |

## Task 0: Confirm the Development Baseline

**Files:**

- Inspect: `package.json`
- Inspect: `web/package.json`
- Inspect: `CHANGELOG.md`
- Inspect: `docs/superpowers/specs/2026-09-03-v0-7-1-recent-work-continuity-design.md`

- [x] **Step 1: Confirm the working tree boundary**

Run:

```bash
git status --short
git log --oneline --decorate -5
```

Expected: the existing `.codex-ui-regression/` and `test-results/` paths may remain untracked; no tracked source file should be unexpectedly modified. Do not add or remove those user-owned artifacts.

- [x] **Step 2: Run the complete baseline tests**

Run:

```bash
npm test
```

Expected: exit code `0` and a final TAP summary with zero failures. If the baseline fails, stop implementation and report the failing test before modifying code.

- [x] **Step 3: Run the baseline Web build**

Run:

```bash
npm run build:web
```

Expected: exit code `0`. Record the existing Vite bundle-size warning and npm vulnerability count as baseline warnings; do not change dependencies in this feature.

- [x] **Step 4: Record the starting commit without changing release metadata**

Run:

```bash
git rev-parse --short HEAD
git diff --check
```

Expected: a short commit ID and no whitespace errors. Do not create a tag or change package versions.

## Task 1: Add the Project Sync Policy Domain

**Files:**

- Create: `src/core/sync-policy.js`
- Create: `test/sync-policy.test.js`
- Modify: `src/core/json.js`
- Modify: `src/core/service.js`
- Modify: `test/project-edit-api.test.js`

- [x] **Step 1: Write failing policy tests**

Create `test/sync-policy.test.js` with these tests:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_MANAGED_FIELDS,
  normalizeSyncPolicy,
  trustedModeReadiness
} from '../src/core/sync-policy.js'

test('defaults every project to manual synchronization', () => {
  assert.deepEqual(normalizeSyncPolicy(), {
    mode: 'manual',
    server: '',
    projectId: '',
    managedFields: [...DEFAULT_MANAGED_FIELDS]
  })
})

test('normalizes identifiers and drops unknown managed fields', () => {
  assert.deepEqual(normalizeSyncPolicy({
    mode: 'trusted-auto', server: ' assess-task-local ', projectId: 42,
    managedFields: ['title', 'status', 'title', 'unknown']
  }), {
    mode: 'trusted-auto', server: 'assess-task-local', projectId: '42',
    managedFields: ['title', 'status']
  })
})

test('trusted mode remains ineligible until every required probe passes', () => {
  const result = trustedModeReadiness(normalizeSyncPolicy({ mode: 'trusted-auto' }), {
    connection: true, permission: true, createUpdate: false, statusWrite: true, idempotency: true
  })
  assert.equal(result.ready, false)
  assert.ok(result.blockers.some((item) => item.code === 'SYNC_CREATE_UPDATE_UNVERIFIED'))
})
```

- [x] **Step 2: Run the policy tests and verify failure**

Run:

```bash
node --test test/sync-policy.test.js
```

Expected: FAIL because `src/core/sync-policy.js` does not exist.

- [x] **Step 3: Implement the minimal policy module**

Create `src/core/sync-policy.js` with these public contracts:

```js
import { err } from './errors.js'

export const SYNC_MODES = new Set(['manual', 'trusted-auto'])
export const DEFAULT_MANAGED_FIELDS = Object.freeze([
  'title', 'description', 'acceptance', 'priority', 'assignee', 'sprint', 'status', 'delivery'
])
const MANAGED_FIELDS = new Set(DEFAULT_MANAGED_FIELDS)

export function normalizeSyncPolicy(input = {}) {
  const mode = SYNC_MODES.has(input.mode) ? input.mode : 'manual'
  const source = Array.isArray(input.managedFields) ? input.managedFields : DEFAULT_MANAGED_FIELDS
  const managedFields = [...new Set(source.map((value) => String(value).trim()))]
    .filter((value) => MANAGED_FIELDS.has(value))
  return {
    mode,
    server: String(input.server || '').trim(),
    projectId: String(input.projectId || '').trim(),
    managedFields
  }
}

export function assertSyncPolicy(input) {
  if (input?.mode && !SYNC_MODES.has(input.mode)) {
    throw err.bad('SYNC_MODE_INVALID', '同步模式只支持 manual 或 trusted-auto')
  }
  const value = normalizeSyncPolicy(input)
  if (value.server && !/^[a-z0-9][a-z0-9._-]*$/.test(value.server)) {
    throw err.bad('SYNC_SERVER_INVALID', '同步服务标识不合法')
  }
  return value
}

export function trustedModeReadiness(policy, probes = {}) {
  const value = normalizeSyncPolicy(policy)
  const required = [
    ['connection', 'SYNC_CONNECTION_UNVERIFIED', '尚未验证 MCP 连接'],
    ['permission', 'SYNC_PERMISSION_UNVERIFIED', '尚未验证写权限'],
    ['createUpdate', 'SYNC_CREATE_UPDATE_UNVERIFIED', '尚未验证创建和更新'],
    ['statusWrite', 'SYNC_STATUS_WRITE_UNVERIFIED', '尚未验证状态回写'],
    ['idempotency', 'SYNC_IDEMPOTENCY_UNVERIFIED', '尚未验证幂等行为']
  ]
  const blockers = value.mode === 'trusted-auto'
    ? required.filter(([key]) => probes[key] !== true).map(([, code, message]) => ({ code, message }))
    : []
  return { ready: value.mode === 'trusted-auto' && blockers.length === 0, blockers }
}
```

- [x] **Step 4: Persist normalized policy on projects**

Update `src/core/service.js` so project detail, creation, and update all use the same normalizer:

```js
import { assertSyncPolicy, normalizeSyncPolicy } from './sync-policy.js'
```

In `#projectDetail`, return `sync: normalizeSyncPolicy(project.sync)`. In `createProject`, add `sync: normalizeSyncPolicy()`. In `updateProject`, use:

```js
if (patch.sync !== undefined) next.sync = assertSyncPolicy(patch.sync)
if (next.sync === undefined) next.sync = normalizeSyncPolicy()
```

Add `sync` after `releaseMail` in the stable `project` key order in `src/core/json.js`.

- [x] **Step 5: Add project API regression coverage**

Extend `test/project-edit-api.test.js` to assert that a project defaults to `manual`, accepts a normalized `trusted-auto` configuration, and rejects an invalid mode with `SYNC_MODE_INVALID`.

- [x] **Step 6: Run focused tests**

Run:

```bash
node --test test/sync-policy.test.js test/project-edit-api.test.js test/projects.test.js
```

Expected: PASS.

- [x] **Step 7: Commit the policy domain**

```bash
git add src/core/sync-policy.js src/core/json.js src/core/service.js test/sync-policy.test.js test/project-edit-api.test.js
git commit -m "feat: add project synchronization policy"
```

## Task 2: Upgrade Repositories Safely to Schema 3

**Files:**

- Create: `src/core/metadata-backup.js`
- Create: `test/metadata-backup.test.js`
- Modify: `src/core/migrate.js`
- Modify: `src/core/repo.js`
- Modify: `src/core/service.js`
- Modify: `test/migrate.test.js`

- [ ] **Step 1: Write failing metadata backup tests**

Create `test/metadata-backup.test.js` covering this contract:

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createMetadataBackup, restoreMetadataBackup } from '../src/core/metadata-backup.js'

test('restores touched metadata and removes files created after backup', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-backup-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'projects', 'orders'), { recursive: true })
  fs.writeFileSync(path.join(root, 'flowlark.json'), '{"schemaVersion":2}\n')
  fs.writeFileSync(path.join(root, 'projects', 'orders', 'project.json'), '{"name":"before"}\n')

  const backup = createMetadataBackup(root, { from: 2, to: 3, now: new Date('2026-09-04T00:00:00Z') })
  fs.writeFileSync(path.join(root, 'projects', 'orders', 'project.json'), '{"name":"after"}\n')
  fs.mkdirSync(path.join(root, 'acceptances'), { recursive: true })
  fs.writeFileSync(path.join(root, 'acceptances', 'new.json'), '{}\n')

  restoreMetadataBackup(root, backup)
  assert.equal(fs.readFileSync(path.join(root, 'projects', 'orders', 'project.json'), 'utf8'), '{"name":"before"}\n')
  assert.equal(fs.existsSync(path.join(root, 'acceptances', 'new.json')), false)
})
```

- [ ] **Step 2: Verify the backup test fails**

Run:

```bash
node --test test/metadata-backup.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement scoped metadata backup and restore**

Create `src/core/metadata-backup.js`. It must:

- operate only on `flowlark.json`, `mcp.json`, `.gitignore`, `.gitattributes`, `projects/*/project.json`, `projects/*/versions/*.json`, `requirements/*/requirement.json`, `milestones/*.json`, `snapshots/*.json`, `acceptances/**/*.json`, and `.flowlark/sync-audit.ndjson`;
- write `manifest.json` with `from`, `to`, `createdAt`, and the exact relative paths that existed;
- copy files without following symlinks;
- reject a backup path outside `<root>/.flowlark/backup/`;
- restore the scoped paths to their manifest state and remove only scoped files created after backup;
- never copy, restore, remove, or rewrite version HTML, specification Markdown, attachments, `.git`, or unrelated workspace files.

Use exported signatures:

```js
export function createMetadataBackup(root, { from, to, now = new Date() } = {})
export function validateMetadataBackup(root, backup)
export function restoreMetadataBackup(root, backup)
```

The implementation must use `fs.cpSync`/`fs.copyFileSync` with explicit paths and must not shell out to `cp` or `rm`.

- [ ] **Step 4: Write schema 3 migration tests**

Update the migration import to include `migrateToLatest`, then append these three cases to `test/migrate.test.js`:

```js
test('schema 2 projects gain normalized manual sync policy', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  const configFile = path.join(root, 'flowlark.json')
  const projectFile = path.join(root, 'projects', 'orders', 'project.json')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  config.schemaVersion = 2
  delete project.sync
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2) + '\n')

  const report = migrateToLatest(root)
  t.assert.strictEqual(report.migrated, true)
  t.assert.strictEqual(report.to, 3)
  t.assert.strictEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')).schemaVersion, 3)
  t.assert.strictEqual(store.readProject(root, 'orders').sync.mode, 'manual')
})

test('schema 1 migrates through schema 2 and schema 3', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  hub.addVersion('orders', {
    versionNo: 'v1', title: '一版', html: html(),
    requirements: [{ code: 'REQ-1', title: '批量关闭' }]
  })
  const configFile = path.join(root, 'flowlark.json')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  config.schemaVersion = 1
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  const version = store.readVersion(root, 'orders', 'v1')
  version.requirements = [{ code: 'REQ-1', title: '批量关闭', url: '' }]
  delete version.reviewStatus
  store.writeVersion(root, 'orders', version)

  const report = migrateToLatest(root)
  t.assert.strictEqual(report.to, 3)
  t.assert.deepStrictEqual(store.readVersion(root, 'orders', 'v1').requirements, ['REQ-1'])
  t.assert.strictEqual(store.readProject(root, 'orders').sync.mode, 'manual')
})

test('schema 3 validation failure restores every touched metadata file', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  const configFile = path.join(root, 'flowlark.json')
  const projectFile = path.join(root, 'projects', 'orders', 'project.json')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  config.schemaVersion = 2
  delete project.sync
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2) + '\n')
  const beforeConfig = fs.readFileSync(configFile)
  const beforeProject = fs.readFileSync(projectFile)

  t.assert.throws(() => migrateToLatest(root, {
    afterProjectWrite() { throw new Error('injected schema 3 failure') }
  }), /injected schema 3 failure/)
  t.assert.deepStrictEqual(fs.readFileSync(configFile), beforeConfig)
  t.assert.deepStrictEqual(fs.readFileSync(projectFile), beforeProject)
})
```

Add `import path from 'node:path'` at the top of the test file. The test callbacks must accept `(t)` where `t.assert` is used.

- [ ] **Step 5: Refactor migration orchestration**

Update `src/core/migrate.js` to export:

```js
export function migrateToLatest(root, options = {}) {
  let from = preflightMigration(root).from
  const reports = []
  if (from < 2) {
    reports.push(migrateToSchema2(root, options))
    from = 2
  }
  if (from < 3) reports.push(migrateToSchema3(root, options))
  return { migrated: reports.some((item) => item.migrated), from: reports[0]?.from ?? from, to: 3, reports }
}
```

Keep `migrateToSchema2` exported for existing tests, return without changes when `from >= 2`, and make it write schema `2` explicitly rather than the latest constant. Add `migrateToSchema3`, which returns without changes when `from >= 3`, then:

1. requires Flowlark-owned tracked paths to be clean;
2. creates a schema 2 → 3 metadata backup;
3. normalizes and writes `project.sync` for every project;
4. ensures `.flowlark/backup/` is ignored and `.flowlark/sync-audit.ndjson` uses `merge=union`;
5. creates an empty `acceptances/` directory only when needed by future writes;
6. validates all project files can be read and normalized;
7. writes `schemaVersion: 3` last;
8. calls the optional `afterProjectWrite` test hook after project writes and before validation;
9. restores the backup on any exception.

Change the `Hub` constructor in `src/core/service.js` to call `migrate.migrateToLatest(root)` whenever `initial.schemaVersion < SCHEMA_VERSION` and import `SCHEMA_VERSION` from `src/core/repo.js`.

- [ ] **Step 6: Update repository defaults**

In `src/core/repo.js`:

```js
export const SCHEMA_VERSION = 3
```

Add `.flowlark/backup/` to `GITIGNORE` and `.flowlark/sync-audit.ndjson merge=union` to `GITATTRIBUTES`. Keep `.flowlark/cache/` ignored.

- [ ] **Step 7: Run migration tests**

Run:

```bash
node --test test/metadata-backup.test.js test/migrate.test.js test/admin.test.js
```

Expected: PASS, including schema 1 → 3 and injected rollback.

- [ ] **Step 8: Commit schema 3 migration**

```bash
git add src/core/metadata-backup.js src/core/migrate.js src/core/repo.js src/core/service.js test/metadata-backup.test.js test/migrate.test.js
git commit -m "feat: add recoverable schema 3 migration"
```

## Task 3: Add Redacted Team Sync Audit

**Files:**

- Create: `src/core/sync-audit.js`
- Create: `test/sync-audit.test.js`
- Modify: `src/core/store.js`

- [x] **Step 1: Write failing audit tests**

Create `test/sync-audit.test.js` with imports and a fixture, then verify append order, limits, malformed final lines, and recursive redaction:

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { appendSyncAudit, listSyncAudit } from '../src/core/sync-audit.js'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-sync-audit-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('redacts secrets before appending audit data', (t) => {
  const root = fixture(t)
  appendSyncAudit(root, {
    syncId: 'sync-1', action: 'step.failed', entityType: 'milestone', entityKey: 'S1',
    before: { title: 'before', Authorization: 'Bearer private' },
    after: { title: 'after', nested: { password: 'private' } },
    environment: { ASSESS_PASSWORD: 'private' }
  }, new Date('2026-09-04T00:00:00Z'))
  const raw = fs.readFileSync(path.join(root, '.flowlark', 'sync-audit.ndjson'), 'utf8')
  assert.doesNotMatch(raw, /Bearer private|ASSESS_PASSWORD|"private"/)
  assert.equal(listSyncAudit(root, { limit: 10 })[0].syncId, 'sync-1')
})
```

- [x] **Step 2: Verify the audit tests fail**

Run:

```bash
node --test test/sync-audit.test.js
```

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement audit append and read**

Add `paths.syncAudit` to `src/core/store.js` and create `src/core/sync-audit.js` with:

```js
export function sanitizeSyncValue(value, key = '')
export function appendSyncAudit(root, input, now = new Date())
export function listSyncAudit(root, { limit = 100, syncId = '' } = {})
```

Every entry must contain only:

```js
{
  schemaVersion: 1,
  id,
  at,
  actor,
  syncId,
  action,
  status,
  entityType,
  entityKey,
  operationKey,
  before,
  after,
  error
}
```

Use `currentUser()` for `actor`, append exactly one JSON object per line, cap reads at 500 entries, ignore one malformed trailing line, and reject malformed entries in the middle of the file. Redact keys matching `password`, `authorization`, `token`, `secret`, `environment`, or `env` recursively.

- [x] **Step 4: Run audit tests**

Run:

```bash
node --test test/sync-audit.test.js
```

Expected: PASS.

- [x] **Step 5: Commit the audit module**

```bash
git add src/core/store.js src/core/sync-audit.js test/sync-audit.test.js
git commit -m "feat: add redacted synchronization audit"
```

## Task 4: Add the Global Sync Queue

**Files:**

- Create: `src/core/sync-queue.js`
- Create: `test/sync-queue.test.js`
- Modify: `src/core/store.js`

- [ ] **Step 1: Write failing queue tests**

Create `test/sync-queue.test.js` with fixtures that assert:

```js
const saved = savePendingSync(root, {
  entityType: 'milestone', entityKey: 'S1', route: '/milestones/S1',
  mode: 'manual', plan
})
assert.equal(saved.status, 'pending-confirmation')
assert.equal(saved.planHash, plan.hash)
assert.equal(listSyncRecords(root).length, 1)

const same = savePendingSync(root, {
  entityType: 'milestone', entityKey: 'S1', route: '/milestones/S1',
  mode: 'manual', plan
})
assert.equal(same.id, saved.id)
assert.equal(listSyncRecords(root).length, 1)
```

Also cover:

- `pending-confirmation → running → failed → running → completed`;
- cancel allowed only from pending, failed, or paused;
- completed records cannot be canceled or restarted;
- an invalid transition returns `SYNC_TRANSITION_INVALID`;
- writes are atomic and never leave a partial JSON file;
- saved plans are passed through `sanitizeSyncValue`.

- [ ] **Step 2: Verify the queue tests fail**

Run:

```bash
node --test test/sync-queue.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement queue persistence and transitions**

Add queue paths to `src/core/store.js`, then create `src/core/sync-queue.js` with these exports:

```js
export const SYNC_STATUSES = new Set([
  'pending-confirmation', 'running', 'failed', 'paused', 'completed', 'canceled'
])

export function syncRecordId(entityType, entityKey)
export function savePendingSync(root, input, now = new Date())
export function writeKnownSyncRecord(root, input)
export function readSyncRecord(root, id)
export function findSyncRecord(root, entityType, entityKey)
export function listSyncRecords(root, { status = '', limit = 200 } = {})
export function transitionSyncRecord(root, id, target, patch = {}, now = new Date())
export function cancelSyncRecord(root, id, reason, now = new Date())
```

Use a deterministic SHA-256-derived ID from `entityType:entityKey`, one file per active entity under `.flowlark/cache/sync-queue/`, and atomic temporary-file rename. Preserve `createdAt` when replacing an expired or changed plan. Store `planHash`, sanitized `plan`, operation states, route, mode, timestamps, and the latest safe error.

Do not execute any remote operation from this module.

- [ ] **Step 4: Run queue tests**

Run:

```bash
node --test test/sync-queue.test.js test/sync-audit.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the queue module**

```bash
git add src/core/store.js src/core/sync-queue.js test/sync-queue.test.js
git commit -m "feat: add global synchronization queue"
```

## Task 5: Adapt Milestone Sync to the Queue and Audit

**Files:**

- Modify: `src/core/milestone-sync-journal.js`
- Modify: `src/core/milestone-sync.js`
- Modify: `src/core/service.js`
- Modify: `test/milestone-sync.test.js`
- Modify: `test/milestone-sync-api.test.js`

- [ ] **Step 1: Add failing persisted-preview tests**

Extend `test/milestone-sync-api.test.js` so `POST /api/milestones/:name/sync-plan` is expected to create a global record with:

```js
{
  entityType: 'milestone',
  entityKey: 'S1',
  route: '/milestones/S1',
  status: 'pending-confirmation',
  planHash: plan.hash,
  mode: 'manual'
}
```

Extend `test/milestone-sync.test.js` to assert that a successful execution records `running`, `step.executing`, `step.completed`, and `completed` audit actions; a thrown adapter error records `step.failed` without secrets.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
node --test test/milestone-sync.test.js test/milestone-sync-api.test.js
```

Expected: FAIL because plans are not persisted and audits are absent.

- [ ] **Step 3: Turn the milestone journal into a compatibility wrapper**

Keep the existing exports in `src/core/milestone-sync-journal.js`, but implement them through `sync-queue.js`:

```js
import fs from 'node:fs'
import path from 'node:path'
import { parse } from './json.js'
import { findSyncRecord, writeKnownSyncRecord } from './sync-queue.js'

export function readMilestoneSyncJournal(root, name) {
  return findSyncRecord(root, 'milestone', name) || readLegacyJournal(root, name)
}

export function writeMilestoneSyncJournal(root, name, input) {
  return writeKnownSyncRecord(root, {
    ...input,
    entityType: 'milestone',
    entityKey: name,
    route: `/milestones/${encodeURIComponent(name)}`
  })
}

function readLegacyJournal(root, name) {
  const file = path.join(root, '.flowlark', 'cache', 'mcp-sync', `${name}.json`)
  return fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8'), `迭代 ${name} 同步记录`) : null
}
```

Retain a read-only fallback for `.flowlark/cache/mcp-sync/<name>.json`; do not delete legacy cache files. New writes go only to the global queue.

- [ ] **Step 4: Persist previews in the service facade**

Update `Hub.planMilestoneSync` to await the current planner, save the returned plan with `savePendingSync`, and return `{ ...plan, syncId, syncStatus }`. Determine the project policy conservatively: if a milestone includes several projects or policies disagree, store mode `manual`. In `v0.7.2`, `trusted-auto` is descriptive only and never starts execution by itself.

- [ ] **Step 5: Emit step-level audit events**

In `src/core/milestone-sync.js`, append audit entries immediately after every persisted transition:

```js
appendSyncAudit(root, {
  syncId: journal.id,
  action: 'step.completed',
  status: 'completed',
  entityType: 'milestone',
  entityKey: milestoneName,
  operationKey: step.key,
  before: step.operation.before ?? null,
  after: step.operation.after ?? step.remoteResult ?? null,
  error: null
})
```

Add corresponding `sync.running`, `step.executing`, `step.failed`, and `sync.completed` entries. Audit writes occur after the queue state write; if audit append itself fails, mark the sync record `paused` with `SYNC_AUDIT_WRITE_FAILED` and stop before the next remote operation.

- [ ] **Step 6: Preserve idempotency and resume behavior**

Keep the existing plan-hash, expiry, impact confirmation, unknown-create-result, remote verification, and local finalization checks. A matching completed queue record must return without calling the adapter. A changed plan hash replaces the pending plan only before execution; it must not overwrite a running record.

- [ ] **Step 7: Run milestone synchronization tests**

Run:

```bash
node --test test/milestone-sync-plan.test.js test/milestone-sync.test.js test/milestone-sync-api.test.js
```

Expected: PASS with existing behavior preserved and new queue/audit assertions passing.

- [ ] **Step 8: Commit the milestone integration**

```bash
git add src/core/milestone-sync-journal.js src/core/milestone-sync.js src/core/service.js test/milestone-sync.test.js test/milestone-sync-api.test.js
git commit -m "feat: register milestone synchronization runs"
```

## Task 6: Expose Fixed Sync Center APIs

**Files:**

- Modify: `src/core/service.js`
- Modify: `src/server/routes.js`
- Create: `test/sync-center-api.test.js`

- [ ] **Step 1: Write failing API tests**

Create `test/sync-center-api.test.js` covering:

- `GET /api/sync` returns newest-first records and status counts;
- `GET /api/sync/audit?limit=20&syncId=<id>` returns redacted entries;
- `GET /api/sync/:id` returns one record or 404;
- `POST /api/sync/:id/execute` dispatches only a pending milestone record;
- `POST /api/sync/:id/retry` dispatches only a failed or paused milestone record;
- `POST /api/sync/:id/cancel` requires a non-empty reason;
- an unknown `entityType` returns `SYNC_ENTITY_UNSUPPORTED` and never calls an adapter;
- writes are rejected in read-only LAN mode.

The execute body is fixed:

```js
{
  planHash: record.planHash,
  reason: '确认同步迭代范围',
  confirmUnfinished: false
}
```

It must not accept `tool`, `toolName`, `server`, `command`, or arbitrary operation data.

- [ ] **Step 2: Run the API test and verify failure**

Run:

```bash
node --test test/sync-center-api.test.js
```

Expected: FAIL with 404 routes or missing Hub methods.

- [ ] **Step 3: Add Hub methods**

Add these fixed methods to `src/core/service.js`:

```js
listSyncRecords(filters = {})
getSyncRecord(id)
listSyncAudit(filters = {})
executeSyncRecord(id, input = {})
retrySyncRecord(id, input = {})
cancelSyncRecord(id, reason)
```

`executeSyncRecord` and `retrySyncRecord` must switch on the stored `entityType`. The only accepted type in `v0.7.2` is `milestone`. Execution delegates to `executeMilestoneSync` with the stored entity key and client-confirmed plan hash so the server rebuilds and revalidates the plan; retry delegates to `resumeMilestoneSync`. Reject every other type before resolving an MCP adapter.

`listSyncRecords` must return this stable response shape so the shell can load counts without interpreting queue files:

```js
{
  items: records,
  counts: {
    attention: records.filter((item) => ['pending-confirmation', 'failed', 'paused'].includes(item.status)).length,
    running: records.filter((item) => item.status === 'running').length,
    completed: records.filter((item) => item.status === 'completed').length
  }
}
```

- [ ] **Step 4: Register HTTP routes in collision-safe order**

Add before `GET /api/sync/:id`:

```js
r.get('/api/sync', async (req, res, p, url) => sendJson(res, 200,
  hub.listSyncRecords({ status: url.searchParams.get('status') || '' })))
r.get('/api/sync/audit', async (req, res, p, url) => sendJson(res, 200,
  hub.listSyncAudit({ limit: Number(url.searchParams.get('limit')) || 100, syncId: url.searchParams.get('syncId') || '' })))
r.get('/api/sync/:id', async (req, res, p) => sendJson(res, 200, hub.getSyncRecord(p.id)))
r.post('/api/sync/:id/execute', async (req, res, p) =>
  sendJson(res, 200, await hub.executeSyncRecord(p.id, await readJson(req, maxBody))))
r.post('/api/sync/:id/retry', async (req, res, p) =>
  sendJson(res, 200, await hub.retrySyncRecord(p.id, await readJson(req, maxBody))))
r.post('/api/sync/:id/cancel', async (req, res, p) => {
  const body = await readJson(req, maxBody)
  sendJson(res, 200, hub.cancelSyncRecord(p.id, body.reason))
})
```

- [ ] **Step 5: Run API and permission tests**

Run:

```bash
node --test test/sync-center-api.test.js test/milestone-sync-api.test.js test/v04-api.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the APIs**

```bash
git add src/core/service.js src/server/routes.js test/sync-center-api.test.js
git commit -m "feat: expose synchronization center APIs"
```

## Task 7: Add the Pure Sync Center UI Model

**Files:**

- Create: `web/src/pages/syncCenterModel.js`
- Create: `web/src/pages/syncCenterModel.test.js`
- Modify: `web/src/services/api.ts`

- [ ] **Step 1: Write failing model tests**

Create `web/src/pages/syncCenterModel.test.js`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countSyncStatuses,
  filterSyncRecords,
  syncPrimaryAction,
  syncStatusMeta
} from './syncCenterModel.js'

const records = [
  { id: '1', status: 'failed', entityType: 'milestone', entityKey: 'S1', updatedAt: '2026-09-04T10:00:00Z' },
  { id: '2', status: 'pending-confirmation', entityType: 'milestone', entityKey: 'S2', updatedAt: '2026-09-04T11:00:00Z' },
  { id: '3', status: 'completed', entityType: 'milestone', entityKey: 'S3', updatedAt: '2026-09-03T11:00:00Z' }
]

test('sorts newest first and filters by state', () => {
  assert.deepEqual(filterSyncRecords(records, 'attention').map((item) => item.id), ['2', '1'])
})

test('maps only safe server-owned actions', () => {
  assert.equal(syncPrimaryAction(records[0]), 'retry')
  assert.equal(syncPrimaryAction(records[1]), 'execute')
  assert.equal(syncPrimaryAction(records[2]), 'open')
})

test('returns text labels in addition to colors', () => {
  assert.equal(syncStatusMeta('failed').label, '同步失败')
  assert.deepEqual(countSyncStatuses(records), { attention: 2, running: 0, completed: 1 })
})
```

- [ ] **Step 2: Run the model test and verify failure**

Run:

```bash
node --test web/src/pages/syncCenterModel.test.js
```

Expected: FAIL because the model does not exist.

- [ ] **Step 3: Implement the pure model**

Create `web/src/pages/syncCenterModel.js` with fixed status metadata, newest-first stable sorting, `attention` grouping for pending/failed/paused, and primary action mapping. Unknown statuses must use a neutral label and never produce execute or retry actions.

- [ ] **Step 4: Add typed API calls**

Add to `web/src/services/api.ts`:

```ts
listSyncRecords: (status = '') => get<any>(`/api/sync${status ? `?status=${enc(status)}` : ''}`),
getSyncRecord: (id: string) => get<any>(`/api/sync/${enc(id)}`),
listSyncAudit: (syncId = '', limit = 100) =>
  get<any[]>(`/api/sync/audit?limit=${limit}${syncId ? `&syncId=${enc(syncId)}` : ''}`),
executeSyncRecord: (id: string, body: unknown) => post<any>(`/api/sync/${enc(id)}/execute`, body),
retrySyncRecord: (id: string, body: unknown) => post<any>(`/api/sync/${enc(id)}/retry`, body),
cancelSyncRecord: (id: string, reason: string) => post<any>(`/api/sync/${enc(id)}/cancel`, { reason }),
```

- [ ] **Step 5: Run model and request tests**

Run:

```bash
node --test web/src/pages/syncCenterModel.test.js web/src/services/requestModel.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the frontend model**

```bash
git add web/src/pages/syncCenterModel.js web/src/pages/syncCenterModel.test.js web/src/services/api.ts
git commit -m "feat: add synchronization center model"
```

## Task 8: Build the Sync Center Page and Navigation

**Files:**

- Create: `web/src/pages/SyncCenter.tsx`
- Modify: `web/src/main.tsx`
- Modify: `web/src/runtime/AppRuntime.tsx`
- Modify: `web/src/components/AppShell.tsx`
- Modify: `web/src/styles/global.css`

- [ ] **Step 1: Create the Sync Center page**

Implement `web/src/pages/SyncCenter.tsx` with:

- a `PageHeader` titled “同步中心”;
- status summary for attention, running, and completed records;
- filters for all, attention, running, and completed;
- one flat table or list showing entity, plan summary, status text, update time, and latest error;
- a detail drawer containing the persisted operation list and redacted audit timeline;
- execute confirmation requiring `planHash` and a reason only when the plan contains high-risk operations;
- retry confirmation for failed or paused records;
- cancel confirmation requiring a non-empty reason;
- partial loading failure that leaves already-loaded records visible;
- read-only mode that keeps inspection available and disables write actions.

Use only `api.executeSyncRecord`, `api.retrySyncRecord`, and `api.cancelSyncRecord`; do not send operation arrays or MCP tool names from the browser.

- [ ] **Step 2: Register the route**

In `web/src/main.tsx`:

```tsx
import SyncCenter from './pages/SyncCenter';
<Route path="/sync" element={<SyncCenter />} />
```

- [ ] **Step 3: Add navigation with a text-accessible badge**

In `web/src/runtime/AppRuntime.tsx`, add `syncSummary` to `RuntimeValue`, default it to `{ attention: 0, running: 0, completed: 0 }`, and load it without blocking other runtime data:

```tsx
const [syncSummary, setSyncSummary] = useState({ attention: 0, running: 0, completed: 0 });

const [nextHealth, nextGit, nextNotifications, nextSync] = await Promise.all([
  api.health().catch(() => null),
  api.gitStatus({ fast: true, cache: true }).catch(() => null),
  api.listNotifications().catch(() => []),
  api.listSyncRecords().catch(() => ({ counts: { attention: 0, running: 0, completed: 0 } })),
]);
setSyncSummary(nextSync.counts);
```

Include `syncSummary` in the memoized context value and dependency list.

In `web/src/components/AppShell.tsx`, add `SyncOutlined`, the `sync` navigation item after milestones, and `sync: '同步中心'` to `pageNames`. Read `syncSummary` from `useAppRuntime()` and render `syncSummary.attention` through `Badge` while retaining the visible “同步中心” label.

Do not poll more often than the existing runtime refresh cadence. A sync-summary failure must not break the shell.

- [ ] **Step 4: Add focused responsive styles**

Add `fl-sync-*` styles to `web/src/styles/global.css` for:

- a three-column summary on desktop and one column below 768px;
- a scroll-safe operation table;
- wrapped error text;
- 44px minimum touch targets;
- no nested card stacks deeper than one level;
- status text displayed next to every color indicator.

- [ ] **Step 5: Build the Web app**

Run:

```bash
npm run build:web
```

Expected: PASS. Existing bundle-size warnings may remain; no new TypeScript error is allowed.

- [ ] **Step 6: Commit the Sync Center page**

```bash
git add web/src/pages/SyncCenter.tsx web/src/main.tsx web/src/runtime/AppRuntime.tsx web/src/components/AppShell.tsx web/src/styles/global.css
git commit -m "feat: add synchronization center"
```

## Task 9: Add Project Synchronization Settings

**Files:**

- Create: `web/src/pages/projectSyncModel.js`
- Create: `web/src/pages/projectSyncModel.test.js`
- Create: `web/src/pages/ProjectSyncSettings.tsx`
- Modify: `web/src/pages/Projects.tsx`
- Modify: `web/src/main.tsx`
- Modify: `web/src/styles/global.css`

- [ ] **Step 1: Write failing project sync model tests**

Create `web/src/pages/projectSyncModel.test.js`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { projectSyncForm, projectSyncPayload, trustedModeMessage } from './projectSyncModel.js'

test('uses manual defaults for old projects', () => {
  assert.deepEqual(projectSyncForm({}), {
    mode: 'manual', server: '', projectId: '', managedFields: [
      'title', 'description', 'acceptance', 'priority', 'assignee', 'sprint', 'status', 'delivery'
    ]
  })
})

test('builds a nested project update payload', () => {
  assert.deepEqual(projectSyncPayload({ mode: 'manual', server: 'local', projectId: '42', managedFields: ['title'] }), {
    sync: { mode: 'manual', server: 'local', projectId: '42', managedFields: ['title'] }
  })
})

test('explains that trusted mode is not active in v0.7.2', () => {
  assert.match(trustedModeMessage({ ready: true }), /v0\.7\.5/)
})
```

- [ ] **Step 2: Verify the model tests fail**

Run:

```bash
node --test web/src/pages/projectSyncModel.test.js
```

Expected: FAIL because the model does not exist.

- [ ] **Step 3: Implement the form model**

Create `web/src/pages/projectSyncModel.js` with deterministic defaults, nested payload generation, managed-field labels, and trusted-mode explanatory copy. It must never label trusted mode as active in `v0.7.2`, even when readiness probes pass.

- [ ] **Step 4: Build the project settings page**

Create `web/src/pages/ProjectSyncSettings.tsx` at `/projects/:slug/sync`. It must:

- load the project and MCP configuration in parallel;
- list only enabled MCP servers from repository configuration;
- edit mode, one server, external project ID, and managed fields;
- link to `/settings/mcp` for server creation and capability testing;
- show trusted-mode readiness requirements and the `v0.7.5` activation boundary;
- save only through `api.updateProject(slug, projectSyncPayload(values))`;
- disable save in read-only mode;
- preserve the current project data when MCP configuration fails to load.

- [ ] **Step 5: Register and link the settings page**

In `web/src/main.tsx` add:

```tsx
<Route path="/projects/:slug/sync" element={<ProjectSyncSettings />} />
```

In the project card menu in `web/src/pages/Projects.tsx`, add “同步设置” and route to `/projects/<slug>/sync`. Keep the existing edit action unchanged.

- [ ] **Step 6: Add responsive styles and run tests**

Run:

```bash
node --test web/src/pages/projectSyncModel.test.js web/src/pages/projectsModel.test.js
npm run build:web
```

Expected: PASS.

- [ ] **Step 7: Commit project settings**

```bash
git add web/src/pages/projectSyncModel.js web/src/pages/projectSyncModel.test.js web/src/pages/ProjectSyncSettings.tsx web/src/pages/Projects.tsx web/src/main.tsx web/src/styles/global.css
git commit -m "feat: add project synchronization settings"
```

## Task 10: Document, Verify, and Prepare v0.7.2 for Review

**Files:**

- Modify: `docs/STORAGE.md`
- Modify: `docs/ASSESS-TASK-MCP.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update storage documentation**

Document:

- schema version 3;
- `project.sync` fields and manual default;
- `.flowlark/sync-audit.ndjson` as tracked append-only redacted history;
- `.flowlark/cache/sync-queue/` as local recoverable execution state;
- `.flowlark/backup/` as local migration recovery data;
- the rule that backups, queue records, and external caches do not enter Git.

- [ ] **Step 2: Update MCP documentation**

Document the exact user flow:

```text
生成同步预览 → 在同步中心检查差异 → 确认执行 → 查看步骤和审计 → 失败后重试
```

State explicitly that `trusted-auto` is preparatory metadata in `v0.7.2`; unattended execution remains disabled until `v0.7.5`.

- [ ] **Step 3: Update the changelog**

Under `Unreleased`, add concise entries for schema 3 migration/recovery, project sync policy, persisted previews, Sync Center, redacted audit, and fixed server-owned actions. Do not claim automatic synchronization.

- [ ] **Step 4: Run all focused tests together**

Run:

```bash
node --test \
  test/sync-policy.test.js \
  test/metadata-backup.test.js \
  test/migrate.test.js \
  test/sync-audit.test.js \
  test/sync-queue.test.js \
  test/milestone-sync-plan.test.js \
  test/milestone-sync.test.js \
  test/milestone-sync-api.test.js \
  test/sync-center-api.test.js \
  test/project-edit-api.test.js \
  web/src/pages/syncCenterModel.test.js \
  web/src/pages/projectSyncModel.test.js
```

Expected: PASS with zero failed tests.

- [ ] **Step 5: Run the complete regression suite**

Run:

```bash
npm test
```

Expected: exit code `0` and zero failures.

- [ ] **Step 6: Build the production Web app**

Run:

```bash
npm run build:web
```

Expected: exit code `0`. Compare bundle output with the baseline; investigate any new warning other than the already-recorded size warning.

- [ ] **Step 7: Perform three manual smoke tests**

Test these flows in a temporary repository and test MCP environment:

1. Schema 2 repository opens, backs up, migrates to schema 3, and retains all existing projects and milestone mappings.
2. A milestone preview appears in Sync Center, executes once, and shows completed step and audit history.
3. MCP is stopped mid-operation; the record becomes failed or paused, local pages remain usable, and retry resumes without duplicate remote objects.

Also verify 1440×900 and 390×844 layouts, read-only mode, long project names, long error messages, and empty Sync Center state.

- [ ] **Step 8: Check scope and secrets**

Run:

```bash
git diff --check
git status --short
git diff --name-only
rg -n "Bearer private|private-password|ASSESS_PASSWORD=" .flowlark/sync-audit.ndjson 2>/dev/null || true
```

Expected: no whitespace errors; only planned files changed; audit search returns no sensitive values. Existing user-owned untracked regression artifacts remain untouched.

- [ ] **Step 9: Commit documentation and verification notes**

```bash
git add docs/STORAGE.md docs/ASSESS-TASK-MCP.md CHANGELOG.md
git commit -m "docs: describe v0.7.2 synchronization foundation"
```

## Final Review Checklist

- [ ] Only `v0.7.2` scope was implemented.
- [ ] Existing milestone synchronization behavior and tests remain intact.
- [ ] Browser requests cannot choose an MCP tool or arbitrary remote operation.
- [ ] `trusted-auto` cannot execute unattended in this release.
- [ ] Queue and audit writes are atomic or append-only as designed.
- [ ] All audit paths redact secret-bearing keys recursively.
- [ ] Schema 1 and schema 2 repositories both reach schema 3 safely.
- [ ] Migration rollback restores every touched metadata path.
- [ ] MCP failure does not break local read and ordinary edit flows.
- [ ] Read-only users can inspect but cannot execute, retry, cancel, or change policy.
- [ ] Full tests and the production Web build pass.
- [ ] No user-owned untracked artifacts were staged or committed.
