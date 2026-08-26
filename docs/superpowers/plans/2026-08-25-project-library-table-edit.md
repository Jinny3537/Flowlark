# Project Library Table and Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project-card library with a multi-field table, support complete project editing, and add requirement due dates that drive reliable per-project overdue statistics.

**Architecture:** Keep `project.json` and `requirement.json` as the persisted source of truth, add focused project-domain validation/statistics helpers, and derive counts when the Hub reads projects. Keep the existing React 19 + Ant Design 6 pages and API client; add pure page models for filters and form payloads so the important UI rules remain testable without introducing a component-test framework.

**Tech Stack:** Node.js ES modules, filesystem JSON storage, Node built-in test runner, React 19, TypeScript/TSX, React Router 7, Ant Design 6, dayjs, Vite 5, existing Flowlark CSS tokens.

---

## Working-Tree Constraint

The repository already contains user-owned modified, deleted, and untracked files unrelated to this feature. Preserve all of them.

- Run `git status --short` before and after every task.
- Never use `git add .`, `git add -A`, `git reset`, `git checkout --`, or cleanup commands.
- Stage only the exact files listed in the task being committed.
- If any target file acquires overlapping edits that are not from this plan, stop and ask before changing it.
- Do not stage `.codex-ui-regression/`, `test-results/`, launcher/packaging changes, or unrelated design documents.

## Success Baseline

- Approved design: `docs/superpowers/specs/2026-08-25-project-library-table-edit-design.md`.
- Current root test suite: 291 tests pass, 0 fail.
- Current frontend build: passes; the existing approximately 1.69 MB chunk warning remains non-blocking.
- Current `npm install` reports two pre-existing audit findings; dependency upgrades are outside this feature.

## File Map

Create:

- `src/core/projects.js`: project field validation, code uniqueness, requirement association, and derived project metrics.
- `test/projects.test.js`: focused project field, compatibility, and metric behavior tests.
- `test/project-edit-api.test.js`: HTTP contract coverage for project editing, due dates, and project summaries.
- `web/src/pages/projectsModel.js`: pure project filtering and form-normalization rules.
- `web/src/pages/projectsModel.test.js`: project page model tests.
- `web/src/pages/requirementsModel.js`: pure requirement form payload conversion.
- `web/src/pages/requirementsModel.test.js`: due-date payload tests.

Modify:

- `src/core/service.js:37-113`: integrate project-domain helpers, persist editable fields, and decorate project reads with live metrics.
- `src/core/requirements.js:9-74,143-160`: validate/store due dates and expose a canonical overdue flag.
- `src/core/json.js:9-20`: keep new project and requirement keys in stable Git-friendly order.
- `web/src/pages/Projects.tsx:1-102`: replace cards with table/filter/editor behavior.
- `web/src/pages/Requirements.tsx:1-258`: submit and display requirement due dates.
- `web/src/pages/RequirementDetail.tsx:1-154`: show and edit the due date.
- `web/src/styles/global.css:625-645,725-803,1968-2013`: add project table/filter styles and remove card-only styles made obsolete by this feature.

No server route or API-client method needs to be added: the existing project and requirement POST/PUT/GET routes already carry JSON bodies through to the Hub.

### Task 1: Persist and Validate Editable Project Fields

**Files:**

- Create: `src/core/projects.js`
- Create: `test/projects.test.js`
- Modify: `src/core/service.js:37-113`
- Modify: `src/core/json.js:9-20`

- [ ] **Step 1: Write failing project field and compatibility tests**

Create `test/projects.test.js`:

```js
import { after, describe, test } from 'node:test'
import fs from 'node:fs'
import { cleanup, newHub, throwsCode } from './helpers.js'
import * as store from '../src/core/store.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function fixture() {
  const { root, hub } = newHub()
  dirs.push(root)
  const project = hub.createProject({
    name: '华油中蓝', code: 'HYZL', description: '安全生产原型', priority: 'P1', archived: false
  })
  return { root, hub, project }
}

describe('项目可编辑字段', () => {
  test('创建项目保存优先级与归档状态', (t) => {
    const { project } = fixture()
    t.assert.strictEqual(project.code, 'HYZL')
    t.assert.strictEqual(project.priority, 'P1')
    t.assert.strictEqual(project.archived, false)
  })

  test('编辑业务代码不改变 slug、目录和历史链接', (t) => {
    const { root, hub, project } = fixture()
    const beforeDir = store.paths.project(root, project.slug)
    const updated = hub.updateProject(project.slug, {
      name: '华油中蓝二期', code: 'HYZL2', description: '二期范围', priority: 'P0', archived: true
    })
    t.assert.strictEqual(updated.slug, 'hyzl')
    t.assert.strictEqual(updated.code, 'HYZL2')
    t.assert.strictEqual(updated.name, '华油中蓝二期')
    t.assert.strictEqual(updated.description, '二期范围')
    t.assert.strictEqual(updated.priority, 'P0')
    t.assert.strictEqual(updated.archived, true)
    t.assert.strictEqual(store.paths.project(root, updated.slug), beforeDir)
    t.assert.strictEqual(fs.existsSync(beforeDir), true)
  })

  test('非法字段和重复业务代码不写入项目文件', (t) => {
    const { root, hub, project } = fixture()
    hub.createProject({ name: '其他项目', code: 'OTHER' })
    const file = store.paths.projectFile(root, project.slug)
    const before = fs.readFileSync(file, 'utf8')
    throwsCode(t, 'NAME_REQUIRED', () => hub.updateProject(project.slug, { name: '   ' }))
    throwsCode(t, 'PROJECT_CODE_INVALID', () => hub.updateProject(project.slug, { code: 'bad-code' }))
    throwsCode(t, 'PROJECT_CODE_EXISTS', () => hub.updateProject(project.slug, { code: 'OTHER' }))
    throwsCode(t, 'PROJECT_PRIORITY_INVALID', () => hub.updateProject(project.slug, { priority: 'urgent' }))
    throwsCode(t, 'PROJECT_ARCHIVED_INVALID', () => hub.updateProject(project.slug, { archived: 'true' }))
    t.assert.strictEqual(fs.readFileSync(file, 'utf8'), before)
  })

  test('历史非标准代码未修改时仍可编辑其他字段', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    const legacy = hub.createProject({ name: '旧项目', code: 'legacy-code' })
    const updated = hub.updateProject(legacy.slug, { description: '保留旧代码', priority: 'P2' })
    t.assert.strictEqual(updated.code, 'legacy-code')
    t.assert.strictEqual(updated.description, '保留旧代码')
    t.assert.strictEqual(updated.priority, 'P2')
    t.assert.strictEqual(updated.archived, false)
  })
})
```

- [ ] **Step 2: Run the tests and verify the new behavior fails**

Run:

```bash
node --test test/projects.test.js
```

Expected: failures because `priority` and `archived` are not persisted, `code` is not editable, and invalid updates are not rejected.

- [ ] **Step 3: Add focused project validation helpers**

Create `src/core/projects.js`:

```js
import { err } from './errors.js'
import * as store from './store.js'

export const PROJECT_CODE_RE = /^[A-Z0-9]{1,40}$/
export const PROJECT_PRIORITIES = new Set(['', 'P0', 'P1', 'P2', 'P3'])

export function assertEditableProjectCode(value) {
  const code = String(value || '').trim()
  if (!PROJECT_CODE_RE.test(code)) {
    throw err.bad('PROJECT_CODE_INVALID', `项目代码「${code}」不合法`, '只允许 1–40 位大写字母和数字')
  }
  return code
}

export function normalizeProjectPriority(value = '') {
  const priority = String(value || '').trim()
  if (!PROJECT_PRIORITIES.has(priority)) {
    throw err.bad('PROJECT_PRIORITY_INVALID', `项目优先级「${priority}」不合法`, '请选择 P0、P1、P2、P3 或不设置')
  }
  return priority
}

export function normalizeArchived(value = false) {
  if (typeof value !== 'boolean') {
    throw err.bad('PROJECT_ARCHIVED_INVALID', '项目归档状态必须是布尔值')
  }
  return value
}

export function assertUniqueProjectCode(root, code, exceptSlug = null) {
  const key = String(code).trim().toUpperCase()
  for (const slug of store.listProjectSlugs(root)) {
    if (slug === exceptSlug) continue
    const project = store.readProject(root, slug)
    if (String(project.code || '').trim().toUpperCase() === key) {
      throw err.conflict('PROJECT_CODE_EXISTS', `项目代码「${code}」已被项目「${project.name}」使用`)
    }
  }
  return code
}
```

The web form will enforce uppercase letters/digits for new projects. The Hub applies that strict rule when an existing code is actually changed, while preserving the existing CLI contract that can create legacy lowercase/hyphenated codes.

- [ ] **Step 4: Integrate project fields into the Hub without renaming slugs**

Add this import near the other domain imports in `src/core/service.js`:

```js
import * as projectx from './projects.js'
```

Replace the current `createProject` and `updateProject` methods with:

```js
  createProject({ name, code, description = '', priority = '', archived = false }) {
    this.#assertWritable('创建项目')
    const trimmedName = String(name || '').trim()
    if (!trimmedName) throw err.bad('NAME_REQUIRED', '请填写项目名称')

    const slug = store.slugify(code || trimmedName)
    if (!slug || !store.SLUG_RE.test(slug)) {
      throw err.bad('CODE_INVALID', `无法从「${code || trimmedName}」生成合法的项目标识`,
        '显式指定：--code order-center（小写字母、数字、连字符）')
    }
    if (store.projectExists(this.root, slug)) {
      throw err.conflict('PROJECT_EXISTS', `项目「${slug}」已存在`)
    }

    const now = new Date().toISOString()
    const who = currentUser()
    const project = {
      slug,
      name: trimmedName,
      code: code ? String(code).trim() : slug,
      description: String(description || ''),
      priority: projectx.normalizeProjectPriority(priority),
      archived: projectx.normalizeArchived(archived),
      createdAt: now,
      createdBy: who,
      updatedAt: now,
      updatedBy: who
    }
    store.writeProject(this.root, slug, project)
    this.#log(slug, null, 'PROJECT_CREATE', `创建项目 ${trimmedName}`)
    return this.getProject(slug)
  }

  updateProject(slug, patch) {
    this.#assertWritable('编辑项目')
    const current = store.readProject(this.root, slug)
    const next = { ...current }

    if (patch.name !== undefined) {
      const name = String(patch.name || '').trim()
      if (!name) throw err.bad('NAME_REQUIRED', '请填写项目名称')
      next.name = name
    }
    if (patch.code !== undefined && String(patch.code).trim() !== String(current.code || '').trim()) {
      const code = projectx.assertEditableProjectCode(patch.code)
      projectx.assertUniqueProjectCode(this.root, code, slug)
      next.code = code
    }
    if (patch.description !== undefined) next.description = String(patch.description || '')
    if (patch.priority !== undefined) next.priority = projectx.normalizeProjectPriority(patch.priority)
    if (patch.archived !== undefined) next.archived = projectx.normalizeArchived(patch.archived)
    if (next.priority === undefined) next.priority = ''
    if (next.archived === undefined) next.archived = false

    next.updatedAt = new Date().toISOString()
    next.updatedBy = currentUser()
    store.writeProject(this.root, slug, next)
    this.#log(slug, null, 'PROJECT_UPDATE', `编辑项目 ${next.name}`)
    return this.getProject(slug)
  }
```

This validates the in-memory copy before the single write, so a failed patch does not partially change `project.json`.

- [ ] **Step 5: Stabilize the new project key order**

Change the project entry in `src/core/json.js` to:

```js
  project: ['slug', 'name', 'code', 'description', 'priority', 'archived', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
```

- [ ] **Step 6: Run focused and regression tests**

Run:

```bash
node --test test/projects.test.js test/rules.test.js test/cli.test.js
```

Expected: all focused, legacy project-rule, and CLI tests pass.

- [ ] **Step 7: Commit only project entity changes**

```bash
git add src/core/projects.js src/core/service.js src/core/json.js test/projects.test.js
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: support editable project fields"
```

Expected staged paths: exactly the four files above.

### Task 2: Add Requirement Due Dates and Canonical Overdue Status

**Files:**

- Modify: `src/core/requirements.js:9-74,143-160`
- Modify: `src/core/json.js:19`
- Modify: `test/requirements.test.js`

- [ ] **Step 1: Write failing due-date and overdue tests**

Append to `test/requirements.test.js`:

```js
describe('需求截止日期', () => {
  test('创建、更新和清空合法截止日期', (t) => {
    const { hub } = fixture()
    let item = hub.createRequirement({ code: 'REQ-DATE', title: '日期需求', dueDate: '2026-08-31' })
    t.assert.strictEqual(item.dueDate, '2026-08-31')
    item = hub.updateRequirement('REQ-DATE', { dueDate: '2026-09-01' })
    t.assert.strictEqual(item.dueDate, '2026-09-01')
    item = hub.updateRequirement('REQ-DATE', { dueDate: '' })
    t.assert.strictEqual(item.dueDate, '')
  })

  test('拒绝格式错误和不存在的日期', (t) => {
    const { hub } = fixture()
    throwsCode(t, 'REQUIREMENT_DUE_DATE_INVALID', () => {
      hub.createRequirement({ code: 'REQ-BAD-1', title: '错误格式', dueDate: '2026/08/31' })
    })
    throwsCode(t, 'REQUIREMENT_DUE_DATE_INVALID', () => {
      hub.createRequirement({ code: 'REQ-BAD-2', title: '不存在日期', dueDate: '2026-02-30' })
    })
  })

  test('逾期边界排除今天、未来和已交付需求', (t) => {
    t.assert.strictEqual(reqx.isRequirementOverdue({ dueDate: '2026-08-24', derivedStatus: 'designing' }, '2026-08-25'), true)
    t.assert.strictEqual(reqx.isRequirementOverdue({ dueDate: '2026-08-25', derivedStatus: 'designing' }, '2026-08-25'), false)
    t.assert.strictEqual(reqx.isRequirementOverdue({ dueDate: '2026-08-26', derivedStatus: 'designing' }, '2026-08-25'), false)
    t.assert.strictEqual(reqx.isRequirementOverdue({ dueDate: '2026-08-24', derivedStatus: 'delivered' }, '2026-08-25'), false)
    t.assert.strictEqual(reqx.isRequirementOverdue({ dueDate: '', derivedStatus: 'designing' }, '2026-08-25'), false)
  })

  test('未提供截止日期的更新和旧文件保持兼容', (t) => {
    const { root, hub } = fixture()
    hub.createRequirement({ code: 'REQ-LEGACY', title: '兼容需求', dueDate: '2026-08-31' })
    let item = hub.updateRequirement('REQ-LEGACY', { title: '只改标题' })
    t.assert.strictEqual(item.dueDate, '2026-08-31')

    const file = store.paths.requirementFile(root, 'REQ-LEGACY')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    delete raw.dueDate
    fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`)
    item = hub.getRequirement('REQ-LEGACY')
    t.assert.strictEqual(item.dueDate, '')
    t.assert.strictEqual(item.overdue, false)
  })
})
```

Extend the existing helper import to include `throwsCode`:

```js
import { cleanup, html, newHub, throwsCode } from './helpers.js'
```

- [ ] **Step 2: Verify the new tests fail**

Run:

```bash
node --test test/requirements.test.js
```

Expected: failures because `dueDate` and `isRequirementOverdue` do not exist.

- [ ] **Step 3: Implement date-only validation and overdue derivation**

Add below `REQUIREMENT_CODE_RE` in `src/core/requirements.js`:

```js
export const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function normalizeDueDate(value) {
  const dueDate = String(value || '').trim()
  if (!dueDate) return ''
  if (!DUE_DATE_RE.test(dueDate)) {
    throw err.bad('REQUIREMENT_DUE_DATE_INVALID', `截止日期「${dueDate}」不合法`, '请使用 YYYY-MM-DD 格式')
  }
  const [year, month, day] = dueDate.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw err.bad('REQUIREMENT_DUE_DATE_INVALID', `截止日期「${dueDate}」不存在`, '请选择有效日历日期')
  }
  return dueDate
}

export function localDate(now = new Date()) {
  const part = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}`
}

export function isRequirementOverdue(item, today = localDate()) {
  return Boolean(item && item.dueDate && item.dueDate < today && item.derivedStatus !== 'delivered')
}
```

Add `dueDate` after `owner` in `createRequirement`:

```js
    dueDate: normalizeDueDate(input.dueDate),
```

Include `dueDate` in the update allowlist and normalize it before writing:

```js
  for (const key of ['title', 'description', 'project', 'module', 'type', 'priority', 'owner', 'dueDate', 'statusOverride', 'external', 'url']) {
    if (patch[key] !== undefined) item[key] = patch[key]
  }
  if (!String(item.title || '').trim()) throw err.bad('REQUIREMENT_TITLE_REQUIRED', '请填写需求标题')
  item.title = String(item.title).trim()
  item.dueDate = normalizeDueDate(item.dueDate)
```

Replace `requirementDetail` with:

```js
export function requirementDetail(root, code) {
  const item = readRequirement(root, code)
  const versions = linkedVersions(root, code)
  const derivedStatus = item.statusOverride || deriveRequirementStatus(root, code)
  const detail = { ...item, dueDate: item.dueDate || '', derivedStatus, manualStatus: !!item.statusOverride, versions }
  return { ...detail, overdue: isRequirementOverdue(detail) }
}
```

- [ ] **Step 4: Stabilize the requirement key order**

Change the requirement entry in `src/core/json.js` to:

```js
  requirement: ['code', 'title', 'description', 'project', 'module', 'type', 'priority', 'owner', 'dueDate', 'statusOverride', 'external', 'url', 'createdAt', 'updatedAt'],
```

- [ ] **Step 5: Run due-date and serialization tests**

```bash
node --test test/requirements.test.js test/git.test.js
```

Expected: both files pass; requirement JSON includes `dueDate` in stable order without changing version serialization.

- [ ] **Step 6: Commit only due-date domain changes**

```bash
git add src/core/requirements.js src/core/json.js test/requirements.test.js
git diff --cached --check
git commit -m "feat: add requirement due dates"
```

### Task 3: Derive Project Requirement and Overdue Counts

**Files:**

- Modify: `src/core/projects.js`
- Modify: `src/core/service.js:57-70`
- Modify: `test/projects.test.js`

- [ ] **Step 1: Add failing project metric tests**

Update the helper import in `test/projects.test.js`:

```js
import { cleanup, html, newHub, throwsCode } from './helpers.js'
```

Append:

```js
describe('项目概览派生统计', () => {
  test('按字段或版本关联归属并按需求编号去重', (t) => {
    const { hub, project } = fixture()
    hub.createRequirement({ code: 'REQ-1', title: '代码匹配且关联版本', project: 'HYZL', dueDate: '2000-01-01' })
    hub.createRequirement({ code: 'REQ-2', title: '名称匹配', project: '华油中蓝', dueDate: '2999-01-01' })
    hub.createRequirement({ code: 'REQ-3', title: '其他项目', project: 'OTHER', dueDate: '2000-01-01' })
    hub.addVersion(project.slug, {
      versionNo: 'v1', title: '首版', html: html(), requirements: ['REQ-1']
    })
    const summary = hub.getProject(project.slug)
    t.assert.strictEqual(summary.requirementCount, 2)
    t.assert.strictEqual(summary.overdueCount, 1)
    t.assert.strictEqual(summary.versionCount, 1)
  })

  test('已交付需求即使过期也不计入逾期数', (t) => {
    const { hub, project } = fixture()
    hub.createRequirement({ code: 'REQ-DONE', title: '已交付', project: project.slug, dueDate: '2000-01-01' })
    hub.addVersion(project.slug, {
      versionNo: 'v1', title: '已交付版', html: html(), requirements: ['REQ-DONE']
    })
    hub.setBaseline(project.slug, 'v1')
    const summary = hub.getProject(project.slug)
    t.assert.strictEqual(summary.requirementCount, 1)
    t.assert.strictEqual(summary.overdueCount, 0)
  })
})
```

- [ ] **Step 2: Verify project metrics fail**

```bash
node --test test/projects.test.js
```

Expected: `requirementCount` and `overdueCount` are `undefined`.

- [ ] **Step 3: Add project association and metric helpers**

Add this import to `src/core/projects.js`:

```js
import { isRequirementOverdue } from './requirements.js'
```

Append:

```js
function normalized(value) {
  return String(value || '').trim().toLowerCase()
}

export function requirementBelongsToProject(project, requirement) {
  const assigned = normalized(requirement.project)
  const direct = assigned && [project.slug, project.code, project.name]
    .some((value) => normalized(value) === assigned)
  const linked = (requirement.versions || [])
    .some((version) => String(version.project || '') === project.slug)
  return Boolean(direct || linked)
}

export function projectMetrics(project, requirements, today) {
  const matched = (requirements || []).filter((item) => requirementBelongsToProject(project, item))
  return {
    requirementCount: matched.length,
    overdueCount: matched.filter((item) => isRequirementOverdue(item, today)).length
  }
}
```

- [ ] **Step 4: Load requirements once per project-list read and decorate projects**

Replace the current `listProjects` and `getProject` methods in `src/core/service.js` with:

```js
  listProjects() {
    const requirements = reqx.listRequirements(this.root)
    return store.listProjectSlugs(this.root).map((slug) => this.#projectDetail(slug, requirements))
  }

  getProject(slug) {
    return this.#projectDetail(slug, reqx.listRequirements(this.root))
  }

  #projectDetail(slug, requirements) {
    const project = store.readProject(this.root, slug)
    const baselineNo = store.readBaseline(this.root, slug)
    const nos = store.listVersionNos(this.root, slug)
    return {
      ...project,
      priority: project.priority || '',
      archived: project.archived === true,
      baselineVersionNo: baselineNo,
      versionCount: nos.length,
      ...projectx.projectMetrics(project, requirements)
    }
  }
```

This preserves old-file compatibility and avoids rereading the full requirement set once per project on the list route.

- [ ] **Step 5: Run metric and search regressions**

```bash
node --test test/projects.test.js test/requirements.test.js test/search.test.js
```

Expected: all tests pass, including search calls that use `Hub.listProjects()`.

- [ ] **Step 6: Commit derived project summaries**

```bash
git add src/core/projects.js src/core/service.js test/projects.test.js
git diff --cached --check
git commit -m "feat: derive project requirement metrics"
```

### Task 4: Lock the HTTP Editing and Summary Contract

**Files:**

- Create: `test/project-edit-api.test.js`

- [ ] **Step 1: Write the API contract test**

Create `test/project-edit-api.test.js`:

```js
import { after, before, describe, test } from 'node:test'
import { cleanup, newHub } from './helpers.js'
import { startServer } from '../src/server/index.js'

let root
let server
let base

before(async () => {
  const context = newHub()
  root = context.root
  context.hub.createProject({ name: '华油中蓝', code: 'HYZL' })
  server = await startServer(root, { port: 0, previewPort: 0 })
  base = `http://127.0.0.1:${server.port}`
})

after(async () => {
  if (server) await server.close()
  cleanup(root)
})

async function send(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}

describe('项目编辑与概览 API', () => {
  test('编辑项目后 slug 稳定且列表返回需求统计', async (t) => {
    let result = await send('POST', '/api/requirements', {
      code: 'REQ-API', title: '逾期需求', project: 'hyzl', dueDate: '2000-01-01'
    })
    t.assert.strictEqual(result.status, 201)

    result = await send('PUT', '/api/projects/hyzl', {
      name: '华油中蓝二期', code: 'HYZL2', description: '二期项目', priority: 'P0', archived: true
    })
    t.assert.strictEqual(result.status, 200)
    t.assert.strictEqual(result.body.slug, 'hyzl')
    t.assert.strictEqual(result.body.code, 'HYZL2')
    t.assert.strictEqual(result.body.priority, 'P0')
    t.assert.strictEqual(result.body.archived, true)
    t.assert.strictEqual(result.body.requirementCount, 1)
    t.assert.strictEqual(result.body.overdueCount, 1)

    result = await send('GET', '/api/projects')
    t.assert.strictEqual(result.status, 200)
    t.assert.strictEqual(result.body[0].slug, 'hyzl')
    t.assert.strictEqual(result.body[0].requirementCount, 1)
  })

  test('非法项目代码和截止日期返回结构化错误', async (t) => {
    let result = await send('PUT', '/api/projects/hyzl', { code: 'bad-code' })
    t.assert.strictEqual(result.status, 400)
    t.assert.strictEqual(result.body.code, 'PROJECT_CODE_INVALID')

    result = await send('POST', '/api/requirements', {
      code: 'REQ-BAD-DATE', title: '非法日期', dueDate: '2026-02-30'
    })
    t.assert.strictEqual(result.status, 400)
    t.assert.strictEqual(result.body.code, 'REQUIREMENT_DUE_DATE_INVALID')
  })
})
```

- [ ] **Step 2: Run the API test**

```bash
node --test test/project-edit-api.test.js
```

Expected: both subtests pass. The requirement remains associated after the business-code rename because its persisted project reference uses the stable `slug`.

- [ ] **Step 3: Commit the API contract**

```bash
git add test/project-edit-api.test.js
git diff --cached --check
git commit -m "test: cover project editing API"
```

### Task 5: Add Pure Frontend Form and Filter Models

**Files:**

- Create: `web/src/pages/projectsModel.js`
- Create: `web/src/pages/projectsModel.test.js`
- Create: `web/src/pages/requirementsModel.js`
- Create: `web/src/pages/requirementsModel.test.js`

- [ ] **Step 1: Write failing project model tests**

Create `web/src/pages/projectsModel.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { filterProjects, initialProjectValues, isProjectCodeAllowed, projectPayload } from './projectsModel.js'

const items = [
  { slug: 'hyzl', name: '华油中蓝', code: 'HYZL', description: '安全生产', priority: 'P1', archived: false },
  { slug: 'legacy', name: '旧项目', code: 'legacy-code', description: '历史数据', priority: '', archived: true }
]

test('filters project rows by query, priority, and archive state', () => {
  assert.deepEqual(filterProjects(items, { query: '安全' }).map((item) => item.slug), ['hyzl'])
  assert.deepEqual(filterProjects(items, { priority: 'P1' }).map((item) => item.slug), ['hyzl'])
  assert.deepEqual(filterProjects(items, { archived: 'archived' }).map((item) => item.slug), ['legacy'])
  assert.deepEqual(filterProjects(items, { archived: 'active' }).map((item) => item.slug), ['hyzl'])
})

test('normalizes create and edit form values', () => {
  assert.deepEqual(initialProjectValues(), { name: '', code: '', description: '', priority: undefined, archived: false })
  assert.deepEqual(initialProjectValues(items[0]), {
    name: '华油中蓝', code: 'HYZL', description: '安全生产', priority: 'P1', archived: false
  })
  assert.deepEqual(projectPayload({ name: ' 华油中蓝 ', code: ' HYZL ', description: ' 范围 ', priority: undefined, archived: false }), {
    name: '华油中蓝', code: 'HYZL', description: ' 范围 ', priority: '', archived: false
  })
})

test('accepts new uppercase codes and unchanged legacy codes', () => {
  assert.equal(isProjectCodeAllowed('HYZL2'), true)
  assert.equal(isProjectCodeAllowed('bad-code'), false)
  assert.equal(isProjectCodeAllowed('legacy-code', 'legacy-code'), true)
})
```

- [ ] **Step 2: Write failing requirement payload tests**

Create `web/src/pages/requirementsModel.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { requirementPayload } from './requirementsModel.js'

test('serializes selected and cleared due dates', () => {
  const dueDate = { format: (pattern) => pattern === 'YYYY-MM-DD' ? '2026-08-31' : '' }
  assert.deepEqual(requirementPayload({ title: '需求', dueDate }), { title: '需求', dueDate: '2026-08-31' })
  assert.deepEqual(requirementPayload({ title: '需求', dueDate: null }), { title: '需求', dueDate: '' })
})
```

- [ ] **Step 3: Verify both model tests fail because modules do not exist**

```bash
node --test web/src/pages/projectsModel.test.js web/src/pages/requirementsModel.test.js
```

Expected: module-not-found failures for both model modules.

- [ ] **Step 4: Implement the project page model**

Create `web/src/pages/projectsModel.js`:

```js
export const PROJECT_PRIORITIES = ['P0', 'P1', 'P2', 'P3']
export const PROJECT_CODE_RE = /^[A-Z0-9]{1,40}$/

export function filterProjects(items = [], { query = '', priority = '', archived = 'all' } = {}) {
  const needle = String(query || '').trim().toLowerCase()
  return items.filter((item) => {
    const haystack = `${item.name || ''} ${item.code || ''} ${item.description || ''}`.toLowerCase()
    return (!needle || haystack.includes(needle))
      && (!priority || item.priority === priority)
      && (archived === 'all' || (archived === 'archived' ? item.archived === true : item.archived !== true))
  })
}

export function initialProjectValues(project = null) {
  return {
    name: project?.name || '',
    code: project?.code || '',
    description: project?.description || '',
    priority: project?.priority || undefined,
    archived: project?.archived === true
  }
}

export function isProjectCodeAllowed(value, original = '') {
  const code = String(value || '').trim()
  return code === String(original || '').trim() || PROJECT_CODE_RE.test(code)
}

export function projectPayload(values) {
  return {
    name: String(values.name || '').trim(),
    code: String(values.code || '').trim(),
    description: String(values.description || ''),
    priority: values.priority || '',
    archived: values.archived === true
  }
}
```

- [ ] **Step 5: Implement the requirement payload model**

Create `web/src/pages/requirementsModel.js`:

```js
export function requirementPayload(values) {
  const dueDate = values.dueDate && typeof values.dueDate.format === 'function'
    ? values.dueDate.format('YYYY-MM-DD')
    : ''
  return { ...values, dueDate }
}
```

- [ ] **Step 6: Run model tests and commit**

```bash
node --test web/src/pages/projectsModel.test.js web/src/pages/requirementsModel.test.js
git add web/src/pages/projectsModel.js web/src/pages/projectsModel.test.js web/src/pages/requirementsModel.js web/src/pages/requirementsModel.test.js
git diff --cached --check
git commit -m "test: add project and requirement page models"
```

Expected: two model test files pass; commit includes exactly four files.

### Task 6: Replace Project Cards with the Table and Editor

**Files:**

- Modify: `web/src/pages/Projects.tsx:1-102`
- Modify: `web/src/styles/global.css:625-645,725-803,1968-2013`

- [ ] **Step 1: Replace page imports and state with table/editor dependencies**

Use these imports at the top of `web/src/pages/Projects.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { App, Button, Checkbox, Form, Input, Modal, Select, Space, Table, Tag, Tooltip } from 'antd';
import { EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import {
  filterProjects, initialProjectValues, isProjectCodeAllowed, projectPayload, PROJECT_PRIORITIES,
} from './projectsModel.js';
```

Inside the component, add runtime permission, editor, and filter state:

```tsx
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('');
  const [archiveFilter, setArchiveFilter] = useState('all');
  const filtered = useMemo(
    () => filterProjects(items, { query, priority, archived: archiveFilter }),
    [archiveFilter, items, priority, query],
  );
```

Delete the old `const [open, setOpen] = useState(false)` state; `editorOpen` is the sole modal visibility state.

- [ ] **Step 2: Replace create-only logic with shared create/edit behavior**

Add these callbacks after `load`:

```tsx
  const startCreate = useCallback(() => {
    setEditingProject(null);
    form.setFieldsValue(initialProjectValues());
    setEditorOpen(true);
  }, [form]);

  const startEdit = useCallback((project: any) => {
    setEditingProject(project);
    form.setFieldsValue(initialProjectValues(project));
    setEditorOpen(true);
  }, [form]);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditingProject(null);
    form.resetFields();
  }, [form]);

  const saveProject = useCallback(async () => {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const payload = projectPayload(values);
      const project = editingProject
        ? await api.updateProject(editingProject.slug, payload)
        : await api.createProject(payload);
      message.success(editingProject ? `项目 ${project.name} 已更新` : `项目 ${project.name} 已创建`);
      closeEditor();
      await load();
    } catch (nextError) {
      message.error(errorText(nextError, editingProject ? '更新项目失败' : '创建项目失败'));
    } finally {
      setSaving(false);
    }
  }, [closeEditor, editingProject, form, load, message]);
```

Delete the old `create` function.

- [ ] **Step 3: Replace the card grid with filters and the table**

Use `startCreate` for the page action and disable it in read-only mode:

```tsx
actions={<Button type="primary" icon={<PlusOutlined />} disabled={!writable} onClick={startCreate}>新建项目</Button>}
```

Replace the old card-grid section inside `State` with:

```tsx
        <div className="fl-section-stack">
          <div className="fl-project-filters">
            <Input.Search
              allowClear
              aria-label="搜索项目"
              placeholder="搜索项目名称、代码或描述"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select
              allowClear
              aria-label="项目优先级筛选"
              placeholder="全部优先级"
              value={priority || undefined}
              options={PROJECT_PRIORITIES.map((value) => ({ value, label: value }))}
              onChange={(value) => setPriority(value || '')}
            />
            <Select
              aria-label="项目归档状态筛选"
              value={archiveFilter}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'active', label: '进行中' },
                { value: 'archived', label: '已归档' },
              ]}
              onChange={setArchiveFilter}
            />
          </div>
          <Table
            rowKey="slug"
            loading={loading}
            dataSource={filtered}
            locale={{ emptyText: query || priority || archiveFilter !== 'all' ? '没有匹配的项目' : '还没有项目' }}
            scroll={{ x: 1180 }}
            columns={[
              {
                title: '项目', width: 230,
                render: (_, record: any) => (
                  <div className="fl-project-name">
                    <Button type="link" className="fl-result-link" onClick={() => navigate(`/projects/${encodeURIComponent(record.slug)}`)}>{record.name}</Button>
                    <span className="fl-muted fl-mono">{textOf(record.code, record.slug)}</span>
                  </div>
                ),
              },
              {
                title: '项目描述', dataIndex: 'description', width: 260, ellipsis: true,
                render: (value) => <Tooltip title={value || undefined}>{textOf(value, '暂无描述')}</Tooltip>,
              },
              {
                title: '项目概览', width: 260,
                render: (_, record: any) => (
                  <Space className="fl-project-overview" size="small" wrap>
                    <span>{record.requirementCount || 0} 条需求</span>
                    {record.overdueCount > 0 ? <Tag color="error">{record.overdueCount} 条逾期</Tag> : <span>0 条逾期</span>}
                    <span>{record.versionCount || 0} 个版本</span>
                  </Space>
                ),
              },
              { title: '优先级', dataIndex: 'priority', width: 100, render: (value) => value ? <Tag color="gold">{value}</Tag> : '未设置' },
              { title: '状态', dataIndex: 'archived', width: 110, render: (value) => <Tag color={value ? 'default' : 'success'}>{value ? '已归档' : '进行中'}</Tag> },
              { title: '更新时间', dataIndex: 'updatedAt', width: 150, render: (value) => fmtTime(value) },
              {
                title: '操作', fixed: 'right', width: 150,
                render: (_, record: any) => (
                  <Space size="small">
                    <Button type="link" icon={<EyeOutlined />} onClick={() => navigate(`/projects/${encodeURIComponent(record.slug)}`)}>查看</Button>
                    <Button type="link" icon={<EditOutlined />} disabled={!writable} onClick={() => startEdit(record)}>编辑</Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
```

- [ ] **Step 4: Replace the create modal with the shared project editor**

Replace the current modal with:

```tsx
      <Modal
        title={editingProject ? '编辑项目' : '新建项目'}
        open={editorOpen}
        width={720}
        confirmLoading={saving}
        onOk={saveProject}
        onCancel={closeEditor}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="项目全名" rules={[{ required: true, whitespace: true, message: '请填写项目全名' }]}>
            <Input maxLength={60} placeholder="例如：华油中蓝" />
          </Form.Item>
          <Form.Item
            name="code"
            label="项目代码"
            extra="修改代码不会改变项目路径、历史版本或已有需求编号。"
            rules={[
              { required: true, whitespace: true, message: '请填写项目代码' },
              {
                validator: (_, value) => isProjectCodeAllowed(value, editingProject?.code)
                  ? Promise.resolve()
                  : Promise.reject(new Error('仅允许 1–40 位大写字母和数字')),
              },
            ]}
          >
            <Input className="fl-mono" maxLength={40} placeholder="HYZL" />
          </Form.Item>
          {editingProject ? (
            <Form.Item label="项目概览">
              <div className="fl-project-editor-overview">
                <span><strong>{editingProject.requirementCount || 0}</strong> 条需求</span>
                <span><strong>{editingProject.overdueCount || 0}</strong> 条逾期</span>
                <span><strong>{editingProject.versionCount || 0}</strong> 个版本</span>
              </div>
            </Form.Item>
          ) : null}
          <Form.Item name="description" label="项目描述">
            <Input.TextArea rows={4} maxLength={500} showCount placeholder="简要描述项目目标和范围" />
          </Form.Item>
          <Space align="start" size="large" wrap>
            <Form.Item name="priority" label="项目优先级">
              <Select allowClear className="fl-project-priority-select" placeholder="未设置" options={PROJECT_PRIORITIES.map((value) => ({ value, label: value }))} />
            </Form.Item>
            <Form.Item name="archived" valuePropName="checked" label="项目状态">
              <Checkbox>已归档</Checkbox>
            </Form.Item>
          </Space>
        </Form>
      </Modal>
```

- [ ] **Step 5: Replace obsolete project-card CSS with table/editor CSS**

Remove `.fl-card-grid`, `.fl-project-card`, `.fl-project-card-head`, `.fl-project-description`, `.fl-project-metrics`, `.fl-project-metric`, and `.fl-project-footer` rules. Add:

```css
.fl-project-filters {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) 160px 160px;
  gap: var(--pw-space-12);
}

.fl-project-name {
  display: grid;
  gap: var(--pw-space-4);
}

.fl-project-overview {
  color: var(--pw-color-text-secondary);
}

.fl-project-editor-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--pw-space-12);
  padding: var(--pw-space-12);
  border: 1px solid var(--pw-color-border);
  border-radius: var(--pw-radius-md);
  background: var(--pw-color-surface-muted);
}

.fl-project-editor-overview span {
  color: var(--pw-color-text-secondary);
}

.fl-project-editor-overview strong {
  color: var(--pw-color-text-primary);
  font-size: var(--pw-font-size-20);
}

.fl-project-priority-select {
  width: 220px;
}
```

In the existing small-screen media query, remove `.fl-card-grid` and `.fl-project-metrics` from the grid override and add:

```css
  .fl-project-filters,
  .fl-project-editor-overview {
    grid-template-columns: minmax(0, 1fr);
  }

  .fl-project-priority-select {
    width: 100%;
  }
```

- [ ] **Step 6: Run project model tests and the frontend build**

```bash
node --test web/src/pages/projectsModel.test.js
npm run build:web
```

Expected: project model tests pass; Vite builds successfully with only the existing chunk-size warning.

- [ ] **Step 7: Commit the project table and editor**

```bash
git add web/src/pages/Projects.tsx web/src/styles/global.css
git diff --cached --check
git commit -m "feat: add project table editor"
```

### Task 7: Add Due Dates to Requirement List, Create, Detail, and Edit

**Files:**

- Modify: `web/src/pages/Requirements.tsx:1-258`
- Modify: `web/src/pages/RequirementDetail.tsx:1-154`

- [ ] **Step 1: Serialize the new-requirement due date**

In `web/src/pages/Requirements.tsx`, add `DatePicker` to the Ant Design import and import the payload helper:

```tsx
import { App, Button, Col, DatePicker, Form, Input, List, Modal, Row, Select, Space, Statistic, Table, Tag } from 'antd';
import { requirementPayload } from './requirementsModel.js';
```

Change the create request to:

```tsx
      const item = await api.createRequirement(requirementPayload(values));
```

- [ ] **Step 2: Show due date and overdue state in the requirement table**

Add this column after “本地状态” and increase horizontal scroll width to `1280`:

```tsx
              {
                title: '截止日期', dataIndex: 'dueDate', width: 150,
                render: (value, record: any) => (
                  <Space size="small" wrap>
                    <span>{textOf(value)}</span>
                    {record.overdue ? <Tag color="error">已逾期</Tag> : null}
                  </Space>
                ),
              },
```

Use:

```tsx
            scroll={{ x: 1280 }}
```

- [ ] **Step 3: Add a date picker to the new-requirement form**

Add a row before the description field:

```tsx
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item name="dueDate" label="截止日期">
                <DatePicker className="fl-full-width" format="YYYY-MM-DD" placeholder="选择截止日期" />
              </Form.Item>
            </Col>
          </Row>
```

- [ ] **Step 4: Populate and serialize the detail editor due date**

In `web/src/pages/RequirementDetail.tsx`, add imports:

```tsx
import { App, Button, DatePicker, Descriptions, Form, Input, List, Modal, Space, Tag } from 'antd';
import dayjs from 'dayjs';
import { requirementPayload } from './requirementsModel.js';
```

Add the date to `startEdit`:

```tsx
      dueDate: item?.dueDate ? dayjs(item.dueDate, 'YYYY-MM-DD') : null,
```

Change the update call to:

```tsx
      setItem(await api.updateRequirement(code, requirementPayload(values)));
```

- [ ] **Step 5: Show and edit the detail due date**

Add this `Descriptions.Item` after priority:

```tsx
              <Descriptions.Item label="截止日期">
                <Space size="small" wrap>
                  <span>{textOf(item?.dueDate)}</span>
                  {item?.overdue ? <Tag color="error">已逾期</Tag> : null}
                </Space>
              </Descriptions.Item>
```

Add this form item after owner:

```tsx
          <Form.Item name="dueDate" label="截止日期">
            <DatePicker className="fl-full-width" format="YYYY-MM-DD" placeholder="选择截止日期" />
          </Form.Item>
```

- [ ] **Step 6: Run frontend model tests and build**

```bash
node --test web/src/pages/requirementsModel.test.js
npm run build:web
```

Expected: payload tests pass; the frontend compiles with no TypeScript/Vite errors and only the existing chunk warning.

- [ ] **Step 7: Commit the requirement due-date UI**

```bash
git add web/src/pages/Requirements.tsx web/src/pages/RequirementDetail.tsx
git diff --cached --check
git commit -m "feat: show requirement due dates"
```

### Task 8: Final Regression and Visual Acceptance

**Files:**

- Verify only; modify a task-owned file only if a failing check identifies a feature regression.

- [ ] **Step 1: Run every focused feature test**

```bash
node --test test/projects.test.js test/requirements.test.js test/project-edit-api.test.js web/src/pages/projectsModel.test.js web/src/pages/requirementsModel.test.js
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run the entire backend/frontend-independent suite**

```bash
npm test
```

Expected: at least the baseline 291 tests plus the newly added tests pass, 0 fail.

- [ ] **Step 3: Build the production frontend**

```bash
npm run build:web
```

Expected: Vite exits 0. The existing chunk-size warning and existing audit findings may remain; no new build error is allowed.

- [ ] **Step 4: Verify the project workflow in the running app**

Open `/projects` at desktop width and verify:

- The table shows project name/code, description, requirement/overdue/version overview, priority, status, update time, and actions.
- Search, priority, active, and archived filters produce correct rows.
- “查看” navigates to the stable `slug` route.
- “编辑” opens without navigation, fully prepopulates fields, and saves changes.
- Editing the business code leaves the URL and project version history unchanged.
- Archiving displays a text status and remains reversible.
- Save success is announced; a rejected code keeps the modal and entered values visible.
- A read-only workspace disables create and edit controls.

- [ ] **Step 5: Verify due dates and responsive behavior**

Open `/requirements` and one requirement detail at desktop and below 768 px:

- Creating and editing a requirement can set and clear the date.
- The same `YYYY-MM-DD` value appears in list and detail.
- An overdue item shows the words “已逾期”; a delivered item does not.
- Project summary counts refresh after requirement changes.
- The project and requirement tables remain inside the page and use horizontal scrolling at narrow width.
- Modal focus is trapped and returns to the trigger after close; all icon-bearing actions retain readable text.

- [ ] **Step 6: Inspect the final diff and working tree**

```bash
git status --short
git log --oneline -8
git diff HEAD~7..HEAD --stat
```

Expected: feature commits contain only the files named in this plan. Pre-existing user-owned changes remain unstaged and untouched.

- [ ] **Step 7: Commit a final fix only if verification required one**

If Step 4 or Step 5 required a feature fix, stage only these task-owned paths that actually changed and commit:

```bash
git add src/core/projects.js src/core/service.js src/core/requirements.js src/core/json.js test/projects.test.js test/requirements.test.js test/project-edit-api.test.js web/src/pages/projectsModel.js web/src/pages/projectsModel.test.js web/src/pages/requirementsModel.js web/src/pages/requirementsModel.test.js web/src/pages/Projects.tsx web/src/pages/Requirements.tsx web/src/pages/RequirementDetail.tsx web/src/styles/global.css
git diff --cached --check
git commit -m "fix: complete project editing workflow"
```

If no fix was needed, do not create an empty commit.
