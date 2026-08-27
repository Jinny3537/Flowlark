# Draft and Trash Queue Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing watch inbox and version trash pages into filterable task queues with safe batch retry, archived-record cleanup, restore preflight, and partial-failure results.

**Architecture:** Keep the existing watch inbox JSON and trash directory layout unchanged. Add single-item core and HTTP operations, derive restore eligibility at read time, and let the React pages orchestrate bounded-concurrency batches through a tested pure queue model. Existing CLI and version-based restore routes remain compatible.

**Tech Stack:** Node.js ESM, `node:test`, filesystem-backed storage, React 19, TypeScript, Ant Design 6, React Router 7, Vite.

---

## File map

- Modify `src/core/watch-inbox.js`: remove one archived watch record while preserving pending and failed diagnostics.
- Modify `src/core/store.js`: create route-safe trash entry IDs and resolve one exact trash directory without changing on-disk data.
- Modify `src/core/service.js`: enforce permissions, derive restore eligibility, clear archived watch records, and restore a trash entry by ID.
- Modify `src/server/routes.js`: expose watch cleanup and trash-entry restore routes.
- Modify `test/watch.test.js`: core watch cleanup coverage.
- Modify `test/rules.test.js`: trash ID, eligibility, duplicate deletion, and exact restore coverage.
- Modify `test/server.test.js`: HTTP contract coverage for both new write routes.
- Modify `web/src/services/api.ts`: wrappers for the new routes.
- Modify `web/src/domain/status.js`: label archived watch-record cleanup in the operation log.
- Rename `web/src/pages/watchInboxModel.js` to `web/src/pages/draftTrashModel.js`: replace the single project filter with counts, combined filters, sorting, selection, reason labels, query updates, and bounded batch execution.
- Rename `web/src/pages/watchInboxModel.test.js` to `web/src/pages/draftTrashModel.test.js`: retain project-scope coverage through the combined-filter test and add deterministic queue-model coverage.
- Modify `web/src/pages/WatchInbox.tsx`: queue counts, URL filters, responsive rows, batch retry, cleanup, and result details.
- Modify `web/src/pages/Trash.tsx`: URL filters, eligibility labels, responsive rows, batch restore, and result details.
- Modify `web/src/styles/global.css`: shared queue layout, responsive table/list switch, batch bar, and result styles.

### Task 1: Archived watch-record cleanup in core

**Files:**
- Modify: `src/core/watch-inbox.js`
- Modify: `test/watch.test.js`

- [ ] **Step 1: Write failing cleanup tests**

Add `throwsCode` to the helper import and `removeWatchItem` to the watch-inbox import, then append this test inside `describe('watch 自动归档', ...)`:

```js
test('只清理已归档记录，不丢失失败诊断', (t) => {
  const { root } = newHub()
  dirs.push(root)
  const archivedFile = path.join(root, 'archived_v4.html')
  fs.writeFileSync(archivedFile, html('已归档'))
  const archived = collectWatchFile(root, 'ord', archivedFile)
  updateWatchItem(root, archived.id, { status: 'archived', versionNo: 'v4' })

  const failedFile = path.join(root, 'failed_v5.html')
  fs.writeFileSync(failedFile, html('失败'))
  const failed = collectWatchFile(root, 'ord', failedFile)
  updateWatchItem(root, failed.id, { status: 'failed', error: '版本冲突' })

  const removed = removeWatchItem(root, archived.id)
  t.assert.strictEqual(removed.id, archived.id)
  t.assert.deepStrictEqual(listWatchInbox(root).map((item) => item.id), [failed.id])
  throwsCode(t, 'WATCH_ITEM_NOT_ARCHIVED', () => removeWatchItem(root, failed.id))
  throwsCode(t, 'NOT_FOUND', () => removeWatchItem(root, archived.id))
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/watch.test.js`

Expected: FAIL because `removeWatchItem` is not exported.

- [ ] **Step 3: Implement the minimal core operation**

Add after `updateWatchItem` in `src/core/watch-inbox.js`:

```js
export function removeWatchItem(root, id) {
  const safeId = assertItemId(id)
  const items = readItems(root)
  const index = items.findIndex((item) => item.id === safeId)
  if (index < 0) throw err.notFound(`watch 草稿「${id}」`)
  const item = items[index]
  if (item.status !== 'archived') {
    throw err.conflict(
      'WATCH_ITEM_NOT_ARCHIVED',
      '只有已归档的 watch 记录可以清理',
      '失败项请先重试；待归档项请等待处理完成'
    )
  }
  items.splice(index, 1)
  writeItems(root, items)
  return item
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test test/watch.test.js`

Expected: all watch tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/core/watch-inbox.js test/watch.test.js
git commit -m "feat: clear archived watch records"
```

### Task 2: Stable trash IDs and exact entry resolution

**Files:**
- Modify: `src/core/store.js`
- Modify: `test/rules.test.js`

- [ ] **Step 1: Write failing storage tests**

Add these imports from `src/core/store.js` through the existing `store` namespace and append to `describe('R7 逻辑删除', ...)`:

```js
test('同版本多次删除产生不同且可解析的回收站 ID', async (t) => {
  const { root, hub, slug } = fresh()
  hub.addVersion(slug, { versionNo: 'v1.0', title: '第一次', html: html('one') })
  hub.removeVersion(slug, 'v1.0')
  const first = store.listTrash(root, slug)[0]

  await new Promise((resolve) => setTimeout(resolve, 2))
  hub.addVersion(slug, { versionNo: 'v1.0', title: '第二次', html: html('two') })
  hub.removeVersion(slug, 'v1.0')
  const entries = store.listTrash(root, slug)

  t.assert.strictEqual(entries.length, 2)
  t.assert.notStrictEqual(entries[0].id, entries[1].id)
  t.assert.strictEqual(store.readTrashEntry(root, first.id).dir, first.dir)
})

test('非法回收站 ID 不能越过 trash 根目录', (t) => {
  const { root } = fresh()
  throwsCode(t, 'TRASH_ID_INVALID', () => store.readTrashEntry(root, '../projects'))
  throwsCode(t, 'TRASH_ID_INVALID', () => store.readTrashEntry(root, 'not-base64'))
})
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test test/rules.test.js`

Expected: FAIL because trash entries do not have `id` and `readTrashEntry` does not exist.

- [ ] **Step 3: Add route-safe ID helpers and exact lookup**

Add beside `TRASH_META` in `src/core/store.js`:

```js
const TRASH_ID_RE = /^[A-Za-z0-9_-]{8,512}$/

function trashId(slug, entry) {
  return Buffer.from(JSON.stringify([slug, entry]), 'utf8').toString('base64url')
}

function decodeTrashId(id) {
  const value = String(id || '')
  if (!TRASH_ID_RE.test(value)) throw err.bad('TRASH_ID_INVALID', '回收站记录编号不合法')
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error('shape')
    const [slug, entry] = parsed.map(String)
    if (!SLUG_RE.test(slug) || !entry || path.basename(entry) !== entry) throw new Error('path')
    return { slug, entry }
  } catch {
    throw err.bad('TRASH_ID_INVALID', '回收站记录编号不合法')
  }
}

export function readTrashEntry(root, id) {
  const { slug, entry } = decodeTrashId(id)
  const base = path.resolve(paths.trash(root))
  const dir = path.resolve(base, slug, entry)
  if (!dir.startsWith(`${base}${path.sep}`)) throw err.bad('TRASH_ID_INVALID', '回收站记录编号不合法')
  const metaFile = path.join(dir, TRASH_META)
  if (!fs.existsSync(metaFile)) throw err.notFound('回收站记录')
  const meta = parse(fs.readFileSync(metaFile, 'utf8'), TRASH_META)
  if (meta.project !== slug) throw err.bad('TRASH_ENTRY_INVALID', '回收站记录的项目元数据不一致')
  return { ...meta, id: trashId(slug, entry), dir }
}
```

Change the `listTrash` push to include the ID:

```js
const meta = parse(fs.readFileSync(metaFile, 'utf8'), TRASH_META)
out.push({ ...meta, id: trashId(s.name, entry), dir: entryDir })
```

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `node --test test/rules.test.js`

Expected: all rule tests pass, including duplicate trash IDs and invalid-ID rejection.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/core/store.js test/rules.test.js
git commit -m "feat: identify exact trash entries"
```

### Task 3: Restore eligibility and restore-by-ID service rules

**Files:**
- Modify: `src/core/service.js`
- Modify: `test/rules.test.js`

- [ ] **Step 1: Write failing eligibility and exact-restore tests**

Append to `describe('R7 逻辑删除', ...)`:

```js
test('回收站列表给出恢复资格并按 ID 恢复指定记录', (t) => {
  const { hub, slug } = fresh()
  hub.addVersion(slug, { versionNo: 'v1.0', title: '旧版', html: html('old') })
  hub.removeVersion(slug, 'v1.0')
  const first = hub.listTrash(slug)[0]

  hub.addVersion(slug, { versionNo: 'v1.0', title: '新版', html: html('new') })
  let blocked = hub.listTrash(slug).find((item) => item.id === first.id)
  t.assert.strictEqual(blocked.canRestore, false)
  t.assert.strictEqual(blocked.blockedReason, 'VERSION_EXISTS')

  hub.removeVersion(slug, 'v1.0')
  const entries = hub.listTrash(slug)
  const target = entries.find((item) => item.id === first.id)
  t.assert.strictEqual(target.canRestore, true)
  const restored = hub.restoreTrashEntry(target.id)
  t.assert.strictEqual(restored.title, '旧版')
})

test('项目缺失和数据不完整会阻断恢复', (t) => {
  const { root, hub, slug } = fresh()
  hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
  hub.removeVersion(slug, 'v1.0')
  const entry = hub.listTrash(slug)[0]

  fs.rmSync(store.paths.projectFile(root, slug))
  t.assert.strictEqual(hub.listTrash(slug)[0].blockedReason, 'PROJECT_NOT_FOUND')
  fs.writeFileSync(store.paths.projectFile(root, slug), JSON.stringify({ name: '恢复项目', code: slug }))
  fs.rmSync(path.join(entry.dir, 'v1.0.json'))
  t.assert.strictEqual(hub.listTrash(slug)[0].blockedReason, 'TRASH_INCOMPLETE')
  throwsCode(t, 'TRASH_INCOMPLETE', () => hub.restoreTrashEntry(entry.id))
})
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test test/rules.test.js`

Expected: FAIL because `listTrash` has no eligibility fields and `restoreTrashEntry` does not exist.

- [ ] **Step 3: Implement derived eligibility and exact restore**

Add above `export class Hub` in `src/core/service.js`:

```js
function trashRestoreState(root, entry) {
  if (!store.projectExists(root, entry.project)) {
    return { canRestore: false, blockedReason: 'PROJECT_NOT_FOUND' }
  }
  if (store.versionExists(root, entry.project, entry.versionNo)) {
    return { canRestore: false, blockedReason: 'VERSION_EXISTS' }
  }
  const required = [`${entry.versionNo}.json`, `${entry.versionNo}.html`]
  if (required.some((name) => !fs.existsSync(path.join(entry.dir, name)))) {
    return { canRestore: false, blockedReason: 'TRASH_INCOMPLETE' }
  }
  return { canRestore: true, blockedReason: null }
}
```

Replace `listTrash` and add `restoreTrashEntry` beside the existing lifecycle methods:

```js
listTrash(slug = null) {
  return store.listTrash(this.root, slug).map((entry) => ({
    ...entry,
    ...trashRestoreState(this.root, entry)
  }))
}

restoreTrashEntry(id) {
  this.#assertWritable('恢复版本')
  const entry = store.readTrashEntry(this.root, id)
  const state = trashRestoreState(this.root, entry)
  if (!state.canRestore) {
    if (state.blockedReason === 'VERSION_EXISTS') {
      throw err.conflict('VERSION_EXISTS', `版本号「${entry.versionNo}」已被重新占用，无法恢复`, '先处理现有同号版本')
    }
    if (state.blockedReason === 'PROJECT_NOT_FOUND') {
      throw err.conflict('PROJECT_NOT_FOUND', `项目「${entry.project}」已不存在，无法恢复`, '先恢复或重建项目')
    }
    throw err.conflict('TRASH_INCOMPLETE', '回收站记录数据不完整，无法恢复', '检查回收站中的版本 JSON 和 HTML 文件')
  }
  store.restoreFromTrash(this.root, entry.dir, entry.project)
  this.#log(entry.project, entry.versionNo, 'VERSION_RESTORE', `从回收站恢复版本 ${entry.versionNo}`)
  return this.getVersion(entry.project, entry.versionNo)
}
```

Keep the existing version-number restore method unchanged for CLI compatibility.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `node --test test/rules.test.js test/admin.test.js`

Expected: all rule and attachment-restore tests pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/core/service.js test/rules.test.js
git commit -m "feat: preflight trash restoration"
```

### Task 4: HTTP routes and typed web API wrappers

**Files:**
- Modify: `src/core/service.js`
- Modify: `src/server/routes.js`
- Modify: `test/server.test.js`
- Modify: `web/src/services/api.ts`
- Modify: `web/src/domain/status.js`

- [ ] **Step 1: Write failing HTTP contract tests**

Add `fs` and `path` imports to `test/server.test.js`, then append inside `describe('HTTP API', ...)`:

```js
test('清理已归档 watch 记录', async (t) => {
  const source = path.join(root, 'watch_v9.1.html')
  fs.writeFileSync(source, html('watch cleanup'))
  const item = hub.collectWatchFile('ord', source)

  const removed = await api.send('DELETE', `/api/watch/inbox/${item.id}`)
  t.assert.strictEqual(removed.status, 200)
  t.assert.strictEqual(removed.body.id, item.id)
  t.assert.ok(!hub.listWatchInbox().some((candidate) => candidate.id === item.id))
  t.assert.ok(hub.oplog({ project: 'ord' }).some((entry) => entry.action === 'WATCH_RECORD_REMOVE'))
})

test('按回收站 ID 恢复准确的版本记录', async (t) => {
  hub.addVersion('ord', { versionNo: 'v9.2', title: '待恢复', html: html('trash restore') })
  hub.removeVersion('ord', 'v9.2')
  const listed = await api.get('/api/trash?project=ord')
  const entry = listed.body.find((item) => item.versionNo === 'v9.2')
  t.assert.strictEqual(entry.canRestore, true)

  const restored = await api.send('POST', `/api/trash/${encodeURIComponent(entry.id)}/restore`)
  t.assert.strictEqual(restored.status, 200)
  t.assert.strictEqual(restored.body.versionNo, 'v9.2')
})
```

- [ ] **Step 2: Run the server test and verify it fails**

Run: `node --test test/server.test.js`

Expected: FAIL with `NO_ROUTE` for both new routes.

- [ ] **Step 3: Expose the Hub watch cleanup method and HTTP routes**

Add beside the existing watch methods in `src/core/service.js`:

```js
removeWatchItem(id) {
  this.#assertWritable('清理草稿箱记录')
  const item = watchbox.removeWatchItem(this.root, id)
  this.#log(item.project, item.versionNo, 'WATCH_RECORD_REMOVE', `清理已归档 watch 记录 ${item.id}`)
  return item
}
```

Add to `src/server/routes.js`:

```js
r.delete('/api/watch/inbox/:id', async (req, res, p) =>
  sendJson(res, 200, hub.removeWatchItem(p.id)))

r.post('/api/trash/:id/restore', async (req, res, p) =>
  sendJson(res, 200, hub.restoreTrashEntry(p.id)))
```

Place the watch route beside the existing retry route and the trash restore route beside `GET /api/trash`.

- [ ] **Step 4: Add web API wrappers**

Add to `web/src/services/api.ts` beside the existing watch and trash methods:

```ts
clearWatchItem: (id: string) => del<any>(`/api/watch/inbox/${enc(id)}`),
restoreTrashItem: (id: string) => post<any>(`/api/trash/${enc(id)}/restore`, {}),
```

Add the operation label to `OPERATION_STATUS` in `web/src/domain/status.js`:

```js
WATCH_RECORD_REMOVE: { label: '清理草稿记录', color: 'default' },
```

- [ ] **Step 5: Run server and request-model tests**

Run: `node --test test/server.test.js web/src/services/requestModel.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/core/service.js src/server/routes.js test/server.test.js web/src/services/api.ts web/src/domain/status.js
git commit -m "feat: expose queue maintenance APIs"
```

### Task 5: Pure draft/trash queue model

**Files:**
- Rename: `web/src/pages/watchInboxModel.js` → `web/src/pages/draftTrashModel.js`
- Rename: `web/src/pages/watchInboxModel.test.js` → `web/src/pages/draftTrashModel.test.js`

- [ ] **Step 1: Write failing model tests**

Rename the two existing files first:

```bash
git mv web/src/pages/watchInboxModel.js web/src/pages/draftTrashModel.js
git mv web/src/pages/watchInboxModel.test.js web/src/pages/draftTrashModel.test.js
```

Replace `web/src/pages/draftTrashModel.test.js` with:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  draftCounts, filterDraftItems, filterTrashItems, draftSelection,
  restoreReasonLabel, patchQueueParams, runQueueBatch,
} from './draftTrashModel.js'

const drafts = [
  { id: 'a', project: 'orders', title: '失败原型', filename: 'a.html', status: 'failed', collectedAt: '2026-08-28T10:00:00Z' },
  { id: 'b', project: 'orders', title: '处理中', filename: 'b.html', status: 'pending', collectedAt: '2026-08-28T11:00:00Z' },
  { id: 'c', project: 'users', title: '已完成', filename: 'c.html', status: 'archived', collectedAt: '2026-08-27T10:00:00Z' },
]

test('counts and sorts attention drafts with failures first', () => {
  assert.deepEqual(draftCounts(drafts), { attention: 2, failed: 1, archived: 1 })
  assert.deepEqual(filterDraftItems(drafts, { view: 'attention' }).map((item) => item.id), ['a', 'b'])
})

test('filters both queues by project, query and date', () => {
  assert.deepEqual(filterDraftItems(drafts, { view: 'all', project: 'orders', query: '原型' }).map((item) => item.id), ['a'])
  const trash = [{ id: 't', project: 'orders', versionNo: 'v2', deletedAt: '2026-08-28T09:00:00Z' }]
  assert.equal(filterTrashItems(trash, { query: 'v2', dateFrom: '2026-08-28' }).length, 1)
})

test('splits mixed draft selection into eligible actions', () => {
  assert.deepEqual(draftSelection(drafts, ['a', 'b', 'c']), { failed: ['a'], archived: ['c'] })
  assert.equal(restoreReasonLabel('VERSION_EXISTS'), '版本号已占用')
})

test('patches queue params without dropping unrelated context', () => {
  const params = patchQueueParams(new URLSearchParams('project=orders&view=attention'), { query: 'v2', view: '' })
  assert.equal(params.toString(), 'project=orders&query=v2')
})

test('runs bounded batches and keeps success, skip and failure details', async () => {
  let active = 0
  let maxActive = 0
  const result = await runQueueBatch([1, 2, 3], {
    concurrency: 2,
    skip: (item) => item === 2 ? '冲突' : '',
    run: async (item) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      if (item === 3) throw new Error('网络失败')
      return item
    },
  })
  assert.ok(maxActive <= 2)
  assert.deepEqual(result.succeeded.map((item) => item.item), [1])
  assert.deepEqual(result.skipped.map((item) => item.reason), ['冲突'])
  assert.deepEqual(result.failed.map((item) => item.reason), ['网络失败'])
})
```

- [ ] **Step 2: Run the model test and verify it fails**

Run: `node --test web/src/pages/draftTrashModel.test.js`

Expected: FAIL because `draftTrashModel.js` does not exist.

- [ ] **Step 3: Implement deterministic queue helpers**

Create `web/src/pages/draftTrashModel.js`:

```js
const text = (value) => String(value || '').trim()
const lower = (value) => text(value).toLowerCase()

function withinDate(value, from, to) {
  const day = text(value).slice(0, 10)
  return (!from || day >= from) && (!to || day <= to)
}

export function draftCounts(items = []) {
  return {
    attention: items.filter((item) => item.status === 'pending' || item.status === 'failed').length,
    failed: items.filter((item) => item.status === 'failed').length,
    archived: items.filter((item) => item.status === 'archived').length,
  }
}

export function filterDraftItems(items = [], filters = {}) {
  const needle = lower(filters.query)
  const view = filters.view || 'attention'
  return items.filter((item) => {
    const inView = view === 'all'
      || (view === 'attention' && ['pending', 'failed'].includes(item.status))
      || item.status === view
    const haystack = lower(`${item.title} ${item.filename}`)
    return inView
      && (!filters.project || item.project === filters.project)
      && (!needle || haystack.includes(needle))
      && withinDate(item.collectedAt, filters.dateFrom, filters.dateTo)
  }).sort((a, b) => {
    const priority = { failed: 0, pending: 1, archived: 2 }
    return (priority[a.status] ?? 9) - (priority[b.status] ?? 9)
      || text(b.collectedAt).localeCompare(text(a.collectedAt))
  })
}

export function filterTrashItems(items = [], filters = {}) {
  const needle = lower(filters.query)
  return items.filter((item) => {
    const haystack = lower(`${item.project} ${item.versionNo}`)
    return (!filters.project || item.project === filters.project)
      && (!needle || haystack.includes(needle))
      && withinDate(item.deletedAt, filters.dateFrom, filters.dateTo)
  }).sort((a, b) => text(b.deletedAt).localeCompare(text(a.deletedAt)))
}

export function draftSelection(items = [], selectedIds = []) {
  const selected = new Set(selectedIds)
  return items.reduce((out, item) => {
    if (!selected.has(item.id)) return out
    if (item.status === 'failed') out.failed.push(item.id)
    if (item.status === 'archived') out.archived.push(item.id)
    return out
  }, { failed: [], archived: [] })
}

export function restoreReasonLabel(reason) {
  return ({
    VERSION_EXISTS: '版本号已占用',
    PROJECT_NOT_FOUND: '项目不存在',
    TRASH_INCOMPLETE: '数据不完整',
  })[reason] || '可恢复'
}

export function patchQueueParams(current, patch) {
  const next = new URLSearchParams(current)
  Object.entries(patch).forEach(([key, value]) => {
    const normalized = text(value)
    if (normalized) next.set(key, normalized)
    else next.delete(key)
  })
  return next
}

export async function runQueueBatch(items, { run, skip = () => '', concurrency = 3 }) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      const item = items[index]
      const skipped = skip(item)
      if (skipped) {
        results[index] = { status: 'skipped', item, reason: skipped }
        continue
      }
      try {
        results[index] = { status: 'succeeded', item, value: await run(item) }
      } catch (error) {
        results[index] = { status: 'failed', item, reason: error instanceof Error ? error.message : String(error) }
      }
    }
  }
  const size = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1))
  await Promise.all(Array.from({ length: size }, () => worker()))
  return {
    results,
    succeeded: results.filter((item) => item.status === 'succeeded'),
    skipped: results.filter((item) => item.status === 'skipped'),
    failed: results.filter((item) => item.status === 'failed'),
  }
}
```

- [ ] **Step 4: Run the model test and verify it passes**

Run: `node --test web/src/pages/draftTrashModel.test.js`

Expected: all five model tests pass; the combined-filter test preserves the pre-existing project-scope behavior.

- [ ] **Step 5: Commit Task 5**

```bash
git add -A -- web/src/pages/watchInboxModel.js web/src/pages/watchInboxModel.test.js web/src/pages/draftTrashModel.js web/src/pages/draftTrashModel.test.js
git commit -m "feat: model draft and trash queues"
```

### Task 6: Release 1 filtering and responsive queue views

**Files:**
- Modify: `web/src/pages/WatchInbox.tsx`
- Modify: `web/src/pages/Trash.tsx`
- Modify: `web/src/styles/global.css`

- [ ] **Step 1: Wire URL-backed filters into both pages**

In both pages, import `useSearchParams`, `Input`, `Select`, `Table`, `Space`, and `useMemo`. Replace the old `filterWatchItems`-only import and `projectFilter` derivation in `WatchInbox.tsx` with:

```tsx
import {
  draftCounts, filterDraftItems, patchQueueParams,
} from './draftTrashModel.js';
```

In `Trash.tsx`, add:

```tsx
import { filterTrashItems, patchQueueParams, restoreReasonLabel } from './draftTrashModel.js';
```

Use this URL state pattern instead of the old single project-filter state:

```tsx
const [params, setParams] = useSearchParams();
const filters = {
  view: params.get('view') || 'attention',
  project: params.get('project') || '',
  query: params.get('query') || '',
  dateFrom: params.get('from') || '',
  dateTo: params.get('to') || '',
};
const updateFilters = (patch: Record<string, string>) =>
  setParams(patchQueueParams(params, patch), { replace: true });
```

For `Trash.tsx`, omit `view`. Derive distinct project options from loaded items:

```tsx
const projectOptions = useMemo(() => [...new Set(items.map((item) => item.project).filter(Boolean))]
  .sort().map((value) => ({ value, label: value })), [items]);
```

- [ ] **Step 2: Render draft counts, filters, and failure-first rows**

In `WatchInbox.tsx`, derive:

```tsx
const scoped = useMemo(() => filterDraftItems(items, { ...filters, view: 'all' }), [filters, items]);
const counts = useMemo(() => draftCounts(scoped), [scoped]);
const filtered = useMemo(() => filterDraftItems(items, filters), [filters, items]);
```

Render three view buttons with count badges and the shared filters:

```tsx
<Space wrap className="fl-queue-tabs" aria-label="草稿视图">
  <Button type={filters.view === 'attention' ? 'primary' : 'default'} onClick={() => updateFilters({ view: 'attention' })}>待处理 {counts.attention}</Button>
  <Button type={filters.view === 'failed' ? 'primary' : 'default'} onClick={() => updateFilters({ view: 'failed' })}>归档失败 {counts.failed}</Button>
  <Button type={filters.view === 'archived' ? 'primary' : 'default'} onClick={() => updateFilters({ view: 'archived' })}>已归档 {counts.archived}</Button>
</Space>
<div className="fl-queue-filters">
  <Select allowClear aria-label="按项目筛选草稿" placeholder="全部项目" value={filters.project || undefined} options={projectOptions} onChange={(value) => updateFilters({ project: value || '' })} />
  <Input.Search allowClear aria-label="搜索草稿标题或文件名" placeholder="搜索标题或文件名" value={filters.query} onChange={(event) => updateFilters({ query: event.target.value })} />
  <Input type="date" aria-label="草稿收集开始日期" value={filters.dateFrom} onChange={(event) => updateFilters({ from: event.target.value })} />
  <Input type="date" aria-label="草稿收集结束日期" value={filters.dateTo} onChange={(event) => updateFilters({ to: event.target.value })} />
</div>
```

Preserve the existing project-scoped header but clear only the project parameter, not the other queue filters:

```tsx
<PageHeader
  eyebrow="导入暂存"
  title={filters.project ? `草稿箱 · ${filters.project}` : '草稿箱'}
  description="失败项优先显示；可按项目、关键词和收集时间快速定位。"
  actions={(
    <>
      {filters.project ? <Button onClick={() => updateFilters({ project: '' })}>查看全部项目</Button> : null}
      <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
    </>
  )}
/>
```

Set the filtered empty state explicitly:

```tsx
const queueEmpty = !filtered.length;
```

Pass `empty={queueEmpty}` and `emptyText="没有符合当前筛选条件的草稿"` to the existing `State` wrapper.

Define one action renderer and use it in both responsive layouts:

```tsx
const draftAction = (item: any) => item.status === 'archived' ? (
  <Button size="small" disabled={!item.project || !item.versionNo} onClick={() => navigate(`/projects/${encodeURIComponent(item.project)}/versions/${encodeURIComponent(item.versionNo)}`)}>
    打开版本
  </Button>
) : item.status === 'failed' ? (
  <Button size="small" loading={busy === item.id} disabled={!writable || (Boolean(busy) && busy !== item.id)} onClick={() => void retry(item)}>
    重试
  </Button>
) : null;

<div className="fl-queue-desktop">
  <Table
    rowKey="id"
    pagination={false}
    loading={loading}
    dataSource={filtered}
    columns={[
      { title: '草稿', key: 'draft', render: (_, item) => <><strong>{textOf(item.title, '未命名草稿')}</strong><br /><span className="fl-mono">{textOf(item.filename, '未记录文件名')}</span></> },
      { title: '项目', dataIndex: 'project', key: 'project', render: (value) => textOf(value) },
      { title: '状态', key: 'status', render: (_, item) => { const meta = statusMeta(WATCH_STATUS, item.status); return <Tag color={meta.color}>{meta.label}</Tag>; } },
      { title: '收集时间', dataIndex: 'collectedAt', key: 'collectedAt', render: fmtTime },
      { title: '操作', key: 'action', render: (_, item) => draftAction(item) },
    ]}
  />
</div>
<div className="fl-queue-mobile">
  <List dataSource={filtered} renderItem={(item) => (
    <List.Item actions={draftAction(item) ? [draftAction(item)] : undefined}>
      <List.Item.Meta
        title={textOf(item.title, '未命名草稿')}
        description={`${textOf(item.project)} · ${textOf(item.filename, '未记录文件名')} · ${fmtTime(item.collectedAt)}`}
      />
      {(() => { const meta = statusMeta(WATCH_STATUS, item.status); return <Tag color={meta.color}>{meta.label}</Tag>; })()}
    </List.Item>
  )} />
</div>
```

- [ ] **Step 3: Render trash filters and eligibility labels**

In `Trash.tsx`, derive `filtered = filterTrashItems(items, filters)` and render the complete filter bar:

```tsx
const filtered = useMemo(() => filterTrashItems(items, filters), [filters, items]);

<div className="fl-queue-filters">
  <Select allowClear aria-label="按项目筛选回收站" placeholder="全部项目" value={filters.project || undefined} options={projectOptions} onChange={(value) => updateFilters({ project: value || '' })} />
  <Input.Search allowClear aria-label="搜索回收站项目或版本号" placeholder="搜索项目或版本号" value={filters.query} onChange={(event) => updateFilters({ query: event.target.value })} />
  <Input type="date" aria-label="删除开始日期" value={filters.dateFrom} onChange={(event) => updateFilters({ from: event.target.value })} />
  <Input type="date" aria-label="删除结束日期" value={filters.dateTo} onChange={(event) => updateFilters({ to: event.target.value })} />
</div>
```

Define the status and action once:

```tsx
const restoreStatus = (item: any) => (
  <Tag color={item.canRestore ? 'green' : 'orange'}>
    {item.canRestore ? '可恢复' : restoreReasonLabel(item.blockedReason)}
  </Tag>
);
const restoreAction = (item: any) => (
  <Tooltip title={item.canRestore ? '恢复后状态重置为编辑中' : restoreReasonLabel(item.blockedReason)}>
    <span><Button size="small" loading={restoring === item.id} disabled={!writable || !item.canRestore || Boolean(restoring)} onClick={() => restore(item)}>恢复</Button></span>
  </Tooltip>
);
```

Render both layouts with `item.id` as the only key:

```tsx
<div className="fl-queue-desktop">
  <Table
    rowKey="id"
    pagination={false}
    loading={loading}
    dataSource={filtered}
    columns={[
      { title: '项目', dataIndex: 'project', key: 'project', render: (value) => textOf(value) },
      { title: '版本', dataIndex: 'versionNo', key: 'versionNo', render: (value) => textOf(value) },
      { title: '删除时间', dataIndex: 'deletedAt', key: 'deletedAt', render: fmtTime },
      { title: '删除人', dataIndex: 'deletedBy', key: 'deletedBy', render: (value) => textOf(value, '—') },
      { title: '恢复状态', key: 'status', render: (_, item) => restoreStatus(item) },
      { title: '操作', key: 'action', render: (_, item) => restoreAction(item) },
    ]}
  />
</div>
<div className="fl-queue-mobile">
  <List dataSource={filtered} renderItem={(item) => (
    <List.Item actions={[restoreAction(item)]}>
      <List.Item.Meta title={`${textOf(item.project)} / ${textOf(item.versionNo)}`} description={`${fmtTime(item.deletedAt)} · ${textOf(item.deletedBy, '—')} 删除`} />
      {restoreStatus(item)}
    </List.Item>
  )} />
</div>
```

- [ ] **Step 4: Add responsive queue styles**

Append to `web/src/styles/global.css`:

```css
.fl-queue-tabs,
.fl-queue-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.fl-queue-filters > * {
  min-width: 220px;
}

.fl-queue-stack {
  display: grid;
  gap: 16px;
}

.fl-queue-desktop { display: block; }
.fl-queue-mobile { display: none; }

@media (max-width: 767px) {
  .fl-queue-filters > * { width: 100%; }
  .fl-queue-desktop { display: none; }
  .fl-queue-mobile { display: block; }
}
```

- [ ] **Step 5: Run model tests and build**

Run: `node --test web/src/pages/draftTrashModel.test.js && cd web && npm run build`

Expected: model tests pass and Vite completes without TypeScript errors.

- [ ] **Step 6: Commit Task 6**

```bash
git add web/src/pages/WatchInbox.tsx web/src/pages/Trash.tsx web/src/styles/global.css
git commit -m "feat: filter draft and trash queues"
```

### Task 7: Release 2 draft batch retry and cleanup

**Files:**
- Modify: `web/src/pages/WatchInbox.tsx`
- Modify: `web/src/styles/global.css`

- [ ] **Step 1: Add selection and batch execution state**

Import `type Key` from React plus `draftSelection` and `runQueueBatch`. Change `App.useApp()` to `const { message, modal } = App.useApp()` and add:

```tsx
const [selectedIds, setSelectedIds] = useState<Key[]>([]);
const [batching, setBatching] = useState(false);
const selection = useMemo(() => draftSelection(items, selectedIds.map(String)), [items, selectedIds]);
```

Give the desktop table a row selection configuration and the mobile list checkboxes with accessible labels:

```tsx
rowSelection={{
  selectedRowKeys: selectedIds,
  onChange: setSelectedIds,
  getCheckboxProps: (item) => ({ disabled: !writable || batching || item.status === 'pending' }),
}}
```

Use the same rule in the mobile list and update selection through:

```tsx
const toggleSelected = (id: string, checked: boolean) => {
  setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
};

<Checkbox
  aria-label={`选择草稿 ${textOf(item.title, item.filename)}`}
  checked={selectedIds.includes(item.id)}
  disabled={!writable || batching || item.status === 'pending'}
  onChange={(event) => toggleSelected(item.id, event.target.checked)}
/>
```

- [ ] **Step 2: Implement one batch runner for both actions**

Add this callback inside `WatchInbox`:

```tsx
const runDraftBatch = useCallback(async (kind: 'retry' | 'clear') => {
  const ids = kind === 'retry' ? selection.failed : selection.archived;
  const selected = items.filter((item) => ids.includes(item.id));
  if (!selected.length) return;
  setBatching(true);
  const result = await runQueueBatch(selected, {
    concurrency: 3,
    run: (item) => kind === 'retry' ? api.retryWatchItem(item.id) : api.clearWatchItem(item.id),
  });
  setSelectedIds(result.failed.map((entry) => entry.item.id));
  await load();
  modal.info({
    title: kind === 'retry' ? '批量重试结果' : '清理结果',
    content: (
      <div aria-live="polite">
        <p>成功 {result.succeeded.length} 项，失败 {result.failed.length} 项</p>
        {result.failed.map((entry) => <p key={entry.item.id}>{textOf(entry.item.title, entry.item.filename)}：{entry.reason}</p>)}
      </div>
    ),
  });
  setBatching(false);
}, [items, load, modal, selection.archived, selection.failed]);
```

Wrap the cleanup call in the existing `modal.confirm` API before invoking `runDraftBatch('clear')`. The confirmation content must be exactly:

```text
只会移除草稿箱中的已归档记录，不会删除已创建版本，也不会删除原始 HTML 文件。
```

Define the confirmation callback explicitly:

```tsx
const confirmClear = () => modal.confirm({
  title: `清理 ${selection.archived.length} 条已归档记录？`,
  content: '只会移除草稿箱中的已归档记录，不会删除已创建版本，也不会删除原始 HTML 文件。',
  okText: '清理记录',
  cancelText: '取消',
  onOk: () => runDraftBatch('clear'),
});
```

- [ ] **Step 3: Render the mixed-selection batch bar**

Show the bar whenever any row is selected:

```tsx
{selectedIds.length ? (
  <div className="fl-queue-batch" aria-label="草稿批量操作">
    <span>已选择 {selectedIds.length} 项</span>
    <Button loading={batching} disabled={!writable || !selection.failed.length} onClick={() => void runDraftBatch('retry')}>
      重试失败项（{selection.failed.length}）
    </Button>
    <Button loading={batching} disabled={!writable || !selection.archived.length} onClick={confirmClear}>
      清理已归档记录（{selection.archived.length}）
    </Button>
  </div>
) : null}
```

Pending items are not selectable. Failed and archived records may be selected together; each action only receives its eligible subset.

- [ ] **Step 4: Add batch-bar styling**

Append:

```css
.fl-queue-batch {
  position: sticky;
  bottom: 16px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border: 1px solid var(--fl-line);
  border-radius: 12px;
  background: var(--fl-surface);
  box-shadow: var(--fl-shadow-3);
}
```

- [ ] **Step 5: Run focused tests and build**

Run: `node --test test/watch.test.js test/server.test.js web/src/pages/draftTrashModel.test.js && cd web && npm run build`

Expected: all focused tests pass and Vite build succeeds.

- [ ] **Step 6: Commit Task 7**

```bash
git add web/src/pages/WatchInbox.tsx web/src/styles/global.css
git commit -m "feat: batch process watch records"
```

### Task 8: Release 3 batch restore and final regression

**Files:**
- Modify: `web/src/pages/Trash.tsx`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add trash selection and preflight-aware batch restore**

Import `type Key` from React and `runQueueBatch`. Change `App.useApp()` to `const { message, modal } = App.useApp()`. Add selection state and use `item.id` as the only row key:

```tsx
const [selectedIds, setSelectedIds] = useState<Key[]>([]);
const [batching, setBatching] = useState(false);
const selected = useMemo(() => items.filter((item) => selectedIds.includes(item.id)), [items, selectedIds]);
```

Add the desktop table row selection and matching mobile checkboxes. Disable selection only for read-only mode or while a batch runs; blocked items may remain selected so the result can report them as skipped.

```tsx
const toggleSelected = (id: string, checked: boolean) => {
  setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
};

const rowSelection = {
  selectedRowKeys: selectedIds,
  onChange: setSelectedIds,
  getCheckboxProps: () => ({ disabled: !writable || batching }),
};

<Checkbox
  aria-label={`选择回收站版本 ${item.project} / ${item.versionNo}`}
  checked={selectedIds.includes(item.id)}
  disabled={!writable || batching}
  onChange={(event) => toggleSelected(item.id, event.target.checked)}
/>
```

- [ ] **Step 2: Implement bounded restore with skipped conflict details**

Add:

```tsx
const runRestoreBatch = useCallback(async () => {
  if (!selected.length) return;
  setBatching(true);
  const result = await runQueueBatch(selected, {
    concurrency: 3,
    skip: (item) => item.canRestore ? '' : restoreReasonLabel(item.blockedReason),
    run: (item) => api.restoreTrashItem(item.id),
  });
  setSelectedIds(result.failed.map((entry) => entry.item.id));
  await load();
  const details = [...result.skipped, ...result.failed];
  modal.info({
    title: '批量恢复结果',
    content: (
      <div aria-live="polite">
        <p>成功 {result.succeeded.length} 项，跳过 {result.skipped.length} 项，失败 {result.failed.length} 项</p>
        {details.map((entry) => (
          <p key={entry.item.id}>{entry.item.project} / {entry.item.versionNo}：{entry.reason}</p>
        ))}
        {details.length ? (
          <Button onClick={() => void navigator.clipboard.writeText(details.map((entry) => `${entry.item.project} / ${entry.item.versionNo}：${entry.reason}`).join('\n'))}>
            复制失败明细
          </Button>
        ) : null}
      </div>
    ),
  });
  setBatching(false);
}, [load, modal, selected]);
```

Use one confirmation dialog before this function:

```tsx
const confirmBatchRestore = () => {
  const eligible = selected.filter((item) => item.canRestore).length;
  modal.confirm({
    title: `恢复 ${eligible} 个版本？`,
    content: `已选择 ${selected.length} 项；${eligible} 项可恢复，${selected.length - eligible} 项将因冲突或数据问题跳过。`,
    okText: '批量恢复',
    cancelText: '取消',
    onOk: runRestoreBatch,
  });
};
```

Update the existing single-item callback to use the stable ID as well:

```tsx
const restore = useCallback((item: any) => {
  if (!writable || !item.canRestore) return;
  modal.confirm({
    title: `恢复版本 ${textOf(item.versionNo)}？`,
    content: '恢复后状态重置为编辑中，不会自动变回基线。',
    okText: '恢复',
    cancelText: '取消',
    onOk: async () => {
      setRestoring(item.id);
      try {
        await api.restoreTrashItem(item.id);
        message.success(`${textOf(item.versionNo)} 已恢复`);
        await load();
      } catch (error) {
        message.error(errorText(error, '恢复版本失败'));
      } finally {
        setRestoring('');
      }
    },
  });
}, [load, message, modal, writable]);
```

This removes the old project/version ambiguity from both single and batch UI paths.

- [ ] **Step 3: Render the restore batch bar and copyable failure text**

Render:

```tsx
{selectedIds.length ? (
  <div className="fl-queue-batch" aria-label="回收站批量操作">
    <span>已选择 {selectedIds.length} 项，可恢复 {selected.filter((item) => item.canRestore).length} 项</span>
    <Button type="primary" loading={batching} disabled={!writable} onClick={confirmBatchRestore}>批量恢复</Button>
  </div>
) : null}
```

The result modal code above hides the copy action when there are no skipped or failed entries.

- [ ] **Step 4: Document the delivered releases**

Add under the current version in `CHANGELOG.md`:

```markdown
- 草稿箱新增项目与状态筛选、失败优先视图、批量重试和已归档记录清理。
- 回收站新增恢复资格提示、精确条目恢复和支持部分失败的批量恢复。
```

- [ ] **Step 5: Run the full verification suite**

Run: `node --test test/watch.test.js test/rules.test.js test/admin.test.js test/server.test.js web/src/pages/draftTrashModel.test.js`

Expected: all focused core, HTTP, model, and regression tests pass.

Run: `cd web && npm run build`

Expected: Vite production build succeeds.

Run: `npm test`

Expected: the complete Node test suite passes with zero failures.

- [ ] **Step 6: Perform the manual acceptance pass**

Run `npm start`, then verify these exact scenarios:

1. Open `/watch?project=ord`; confirm the project filter survives refresh.
2. Select failed and archived watch records together; confirm each batch button reports only eligible rows.
3. Clear an archived record; confirm the generated version and source HTML remain present.
4. Create two trash records where one version number is occupied; batch restore and confirm the eligible record succeeds while the conflict is skipped.
5. Open both pages in Git read-only mode; confirm all write actions are disabled while filtering and opening records still work.
6. Narrow the viewport below 768 px; confirm the mobile list exposes the same statuses and actions without horizontal overflow.

- [ ] **Step 7: Commit Task 8**

```bash
git add web/src/pages/Trash.tsx CHANGELOG.md
git commit -m "feat: batch restore trash entries"
```
