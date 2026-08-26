# Version Timeline Redesign Implementation Plan

> **Execution update (2026-08-24):** This original plan targeted the Vue/Arco frontend. During execution the active frontend was migrated to Vite + React 19 + React Router + Ant Design 6. The delivered implementation therefore lives in `web/src/pages/ProjectVersions.tsx`, `ProjectVersions.module.css`, `projectVersionsModel.js`, and `web/src/services/api.ts`. The Vue task details below are retained only as historical planning context and must not be executed against the current app.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unbalanced project version timeline with a responsive master-detail browser optimized for projects containing 50 or more versions.

**Architecture:** Keep API orchestration and all existing mutation actions in `VersionTimeline.vue`. Move deterministic filtering, sorting, and keyboard-selection logic into a small tested module, and move the selected-version presentation into a focused `VersionSummary.vue` component reused by the desktop detail pane and mobile Drawer. Load full version details lazily through the existing `api.getVersion` endpoint and cache them per page session.

**Tech Stack:** Vue 3 `<script setup>`, Arco Design Vue 2.57, existing `--fl-*` CSS tokens, Node built-in test runner, Playwright regression artifacts.

**Working-tree constraint:** `web/src/views/VersionTimeline.vue` already contains user changes. Preserve them and do not commit that file unless the user explicitly authorizes committing the complete combined diff. New files may be committed independently after verifying the staged diff.

---

## File Map

- Create `web/src/views/versionTimelineModel.js`: pure filtering, sorting, and adjacent-selection helpers.
- Create `web/src/views/versionTimelineModel.test.js`: dependency-free unit tests using `node:test`.
- Create `web/src/components/VersionSummary.vue`: selected-version detail presentation and actions shared by desktop and mobile.
- Modify `web/src/views/VersionTimeline.vue`: master-detail layout, local browser state, lazy detail loading, cache invalidation, Drawer, and responsive styles.
- Modify `.codex-ui-regression/ui-regression.spec.js`: page-specific layout, overflow, empty-alert, console, and screenshot assertions.

### Task 1: Add Tested Version Browser Model

**Files:**
- Create: `web/src/views/versionTimelineModel.test.js`
- Create: `web/src/views/versionTimelineModel.js`

- [ ] **Step 1: Write the failing model tests**

Create `web/src/views/versionTimelineModel.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { filterVersions, adjacentVersionNo } from './versionTimelineModel.js'

const versions = [
  {
    versionNo: 'v3', title: '批量关闭校验', createdBy: 'Jinny', createdAt: '2026-08-24T08:00:00Z',
    display: { key: 'DRAFT' }, tags: ['批量操作'], requirements: [{ code: 'REQ-3', title: '订单关闭' }]
  },
  {
    versionNo: 'v2', title: '操作日志优化', createdBy: 'protohub', createdAt: '2026-08-23T08:00:00Z',
    display: { key: 'CONFIRMED' }, tags: [], requirements: [{ code: 'REQ-2', title: '日志筛选' }]
  },
  {
    versionNo: 'v1', title: '首版原型', createdBy: 'protohub', createdAt: '2026-08-22T08:00:00Z',
    display: { key: 'HISTORY' }, tags: [], requirements: []
  }
]

test('filters by version, title, author, tag, and requirement text', () => {
  for (const query of ['v3', '关闭校验', 'Jinny', '批量操作', 'REQ-3', '订单关闭']) {
    assert.deepEqual(filterVersions(versions, { query, status: 'all', order: 'newest' }).map(v => v.versionNo), ['v3'])
  }
})

test('filters by display status and sorts both directions without mutating input', () => {
  assert.deepEqual(filterVersions(versions, { query: '', status: 'CONFIRMED', order: 'newest' }).map(v => v.versionNo), ['v2'])
  assert.deepEqual(filterVersions(versions, { query: '', status: 'all', order: 'oldest' }).map(v => v.versionNo), ['v1', 'v2', 'v3'])
  assert.deepEqual(versions.map(v => v.versionNo), ['v3', 'v2', 'v1'])
})

test('moves selection within bounds', () => {
  assert.equal(adjacentVersionNo(versions, 'v2', 1), 'v1')
  assert.equal(adjacentVersionNo(versions, 'v2', -1), 'v3')
  assert.equal(adjacentVersionNo(versions, 'v3', -1), 'v3')
  assert.equal(adjacentVersionNo(versions, 'missing', 1), 'v3')
})

test('filters a 60-version project without dropping valid matches', () => {
  const manyVersions = Array.from({ length: 60 }, (_, index) => ({
    ...versions[index % versions.length],
    versionNo: `v${index + 1}`,
    title: index === 47 ? '唯一命中的历史版本' : `版本 ${index + 1}`
  }))
  assert.deepEqual(
    filterVersions(manyVersions, { query: '唯一命中', status: 'all', order: 'newest' }).map(v => v.versionNo),
    ['v48']
  )
})
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
node --test web/src/views/versionTimelineModel.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `versionTimelineModel.js`.

- [ ] **Step 3: Implement the pure model helpers**

Create `web/src/views/versionTimelineModel.js`:

```js
function searchableText(version) {
  const requirements = (version.requirements || []).flatMap(item => [item.code, item.title])
  return [version.versionNo, version.title, version.createdBy, ...(version.tags || []), ...requirements]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
}

export function filterVersions(versions, { query = '', status = 'all', order = 'newest' } = {}) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtered = versions.filter(version => {
    const matchesQuery = !normalizedQuery || searchableText(version).includes(normalizedQuery)
    const matchesStatus = status === 'all' || version.display.key === status
    return matchesQuery && matchesStatus
  })
  const compareNewest = (a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
    if (a.versionNo === b.versionNo) return 0
    return a.versionNo < b.versionNo ? 1 : -1
  }
  const direction = order === 'oldest' ? -1 : 1
  return [...filtered].sort((a, b) => direction * compareNewest(a, b))
}

export function adjacentVersionNo(versions, currentVersionNo, direction) {
  if (!versions.length) return null
  const currentIndex = versions.findIndex(version => version.versionNo === currentVersionNo)
  if (currentIndex < 0) return versions[0].versionNo
  const nextIndex = Math.max(0, Math.min(versions.length - 1, currentIndex + direction))
  return versions[nextIndex].versionNo
}
```

- [ ] **Step 4: Run the tests and verify pass**

Run:

```bash
node --test web/src/views/versionTimelineModel.test.js
```

Expected: 6 tests pass, 0 fail after adding shuffled-input and equal-timestamp coverage during review.

- [ ] **Step 5: Commit only the new model files**

```bash
git add web/src/views/versionTimelineModel.js web/src/views/versionTimelineModel.test.js
git diff --cached --check
git commit -m "test: cover version timeline browsing model"
```

### Task 2: Build the Reusable Version Summary

**Files:**
- Create: `web/src/components/VersionSummary.vue`
- Reference: `web/src/components/ChangeList.vue`

- [ ] **Step 1: Create the summary component contract and template**

Create `web/src/components/VersionSummary.vue` with this public interface:

```vue
<script setup>
import {
  IconArrowRight, IconMore, IconRefresh, IconFile, IconLink, IconThunderbolt
} from '@arco-design/web-vue/es/icon/index.js'
import ChangeList from './ChangeList.vue'
import { fmtAbsolute } from '../utils'

defineProps({
  version: { type: Object, default: null },
  loading: Boolean,
  error: { type: String, default: '' },
  canWrite: Boolean,
  canRollback: Boolean
})

defineEmits(['retry', 'open', 'baseline', 'rollback', 'action'])
</script>

<template>
  <section class="version-summary" aria-label="版本详情">
    <a-skeleton v-if="loading" animation class="summary-skeleton">
      <a-skeleton-line :rows="6" />
    </a-skeleton>

    <a-result v-else-if="error" status="warning" title="版本详情加载失败" :subtitle="error">
      <template #extra>
        <a-button @click="$emit('retry')"><template #icon><IconRefresh /></template>重试</a-button>
      </template>
    </a-result>

    <template v-else-if="version">
      <header class="summary-head">
        <div class="summary-identity">
          <div class="summary-status-line">
            <a-tag :color="version.display.color">{{ version.display.label }}</a-tag>
            <span v-if="version.isBaseline" class="baseline-label">当前基线</span>
          </div>
          <h2><span class="mono">{{ version.versionNo }}</span> {{ version.title }}</h2>
          <div class="summary-meta">
            <span>{{ version.createdBy }}</span>
            <span>{{ fmtAbsolute(version.createdAt) }}</span>
            <span><IconFile />{{ version.changeCount }} 条变更</span>
            <span><IconLink />{{ version.requirementCount }} 条需求</span>
            <span><IconThunderbolt />{{ version.externalRefs.length }} 个外部依赖</span>
          </div>
        </div>
        <div class="summary-actions">
          <a-button v-if="version.isBaseline && canRollback" :disabled="!canWrite" @click="$emit('rollback')">
            回滚上一版
          </a-button>
          <a-button v-if="!version.isBaseline && version.display.key !== 'VOID'"
                    :disabled="!canWrite" @click="$emit('baseline', version)">
            {{ version.display.key === 'HISTORY' ? '回滚为基线' : '设为基线' }}
          </a-button>
          <a-button type="primary" @click="$emit('open', version.versionNo)">
            打开工作台<template #icon><IconArrowRight /></template>
          </a-button>
          <a-dropdown :trigger="['click']">
            <a-button aria-label="更多版本操作"><template #icon><IconMore /></template></a-button>
            <template #content>
              <a-doption @click="$emit('action', 'compare', version)">与基线并排对比</a-doption>
              <a-doption @click="$emit('action', 'read', version)">标记为已读</a-doption>
              <a-doption @click="$emit('action', 'download', version)">下载 HTML</a-doption>
              <a-doption v-if="version.display.key === 'VOID'" :disabled="!canWrite"
                           @click="$emit('action', 'reopen', version)">恢复为编辑中</a-doption>
              <a-doption v-else :disabled="!canWrite || version.isBaseline"
                           @click="$emit('action', 'void', version)">废弃</a-doption>
              <a-doption class="danger-menu-item" :disabled="!canWrite || version.isBaseline"
                           @click="$emit('action', 'remove', version)">删除</a-doption>
            </template>
          </a-dropdown>
        </div>
      </header>

      <div class="summary-section">
        <div class="section-label">变更日志</div>
        <ChangeList v-if="version.changes.length" :items="version.changes" />
        <a-empty v-else description="未记录变更日志" />
      </div>

      <div class="summary-section">
        <div class="section-label">关联需求</div>
        <div v-if="version.requirements.length" class="requirement-list">
          <div v-for="item in version.requirements" :key="item.code" class="requirement-row">
            <span class="mono">{{ item.code }}</span><span>{{ item.title || '未填写标题' }}</span>
          </div>
        </div>
        <a-empty v-else description="未关联需求" />
      </div>
    </template>
  </section>
</template>
```

- [ ] **Step 2: Add scoped layout styles using only Flowlark tokens**

Append to `VersionSummary.vue`:

```vue
<style scoped>
.version-summary { min-width:0; padding:var(--fl-s-5); }
.summary-skeleton { max-width:760px; }
.summary-head { display:flex; align-items:flex-start; gap:var(--fl-s-4); padding-bottom:var(--fl-s-5); border-bottom:1px solid var(--fl-line); }
.summary-identity { min-width:0; flex:1; }
.summary-status-line,.summary-meta,.summary-actions { display:flex; align-items:center; flex-wrap:wrap; gap:var(--fl-s-2); }
.summary-head h2 { min-width:0; margin:var(--fl-s-2) 0; color:var(--fl-ink); font-size:var(--fl-fs-5); line-height:1.35; overflow-wrap:anywhere; }
.summary-meta { color:var(--fl-text-2); font-size:var(--fl-fs-2); }
.summary-meta span { display:inline-flex; align-items:center; gap:var(--fl-s-1); }
.baseline-label { color:var(--fl-primary-deep); font-weight:700; }
.summary-section { padding-top:var(--fl-s-5); }
.requirement-list { min-width:0; border-top:1px solid var(--fl-line); }
.requirement-row { display:grid; min-width:0; grid-template-columns:minmax(0,110px) minmax(0,1fr); gap:var(--fl-s-3); padding:var(--fl-s-3) 0; border-bottom:1px solid var(--fl-line); }
.requirement-code,.requirement-title { min-width:0; overflow-wrap:anywhere; }
:deep(.danger-menu-item:not(.arco-menu-disabled)) { color:var(--fl-danger); }
@media (max-width:768px) {
  .version-summary { padding:var(--fl-s-4); }
  .summary-head { flex-direction:column; }
  .summary-actions { width:100%; }
}
</style>
```

- [ ] **Step 3: Commit only the new component if its staged diff is isolated**

```bash
git add web/src/components/VersionSummary.vue
git diff --cached --check
git commit -m "feat: add version summary panel"
```

### Task 3: Refactor VersionTimeline State and Data Flow

**Files:**
- Modify: `web/src/views/VersionTimeline.vue:1-289`
- Reference: `web/src/api.js:83-85`

- [ ] **Step 1: Add imports and browser state**

Add these imports and state declarations:

```js
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { IconPlus, IconBarChart, IconFullscreen, IconSearch } from '@arco-design/web-vue/es/icon/index.js'
import VersionSummary from '../components/VersionSummary.vue'
import { adjacentVersionNo, filterVersions } from './versionTimelineModel.js'

const query = ref('')
const statusFilter = ref('all')
const sortOrder = ref('newest')
const selectedVersionNo = ref(null)
const selectedVersion = ref(null)
const detailLoading = ref(false)
const detailError = ref('')
const mobileDetailOpen = ref(false)
const detailCache = new Map()
let detailRequestId = 0

const filteredVersions = computed(() => filterVersions(versions.value, {
  query: query.value,
  status: statusFilter.value,
  order: sortOrder.value
}))

const statusOptions = computed(() => {
  const seen = new Map()
  for (const version of versions.value) seen.set(version.display.key, version.display.label)
  return [{ value: 'all', label: '全部状态' }, ...Array.from(seen, ([value, label]) => ({ value, label }))]
})
```

- [ ] **Step 2: Implement race-safe detail loading and cache invalidation**

Add these functions:

```js
async function selectVersion(versionNo, { openMobile = false, force = false } = {}) {
  if (!versionNo) return
  const requestId = ++detailRequestId
  selectedVersionNo.value = versionNo
  if (openMobile && window.matchMedia('(max-width: 899px)').matches) mobileDetailOpen.value = true
  detailError.value = ''

  if (!force && detailCache.has(versionNo)) {
    selectedVersion.value = detailCache.get(versionNo)
    detailLoading.value = false
    return
  }

  detailLoading.value = true
  try {
    const detail = await api.getVersion(props.slug, versionNo)
    if (requestId !== detailRequestId || selectedVersionNo.value !== versionNo) return
    detailCache.set(versionNo, detail)
    selectedVersion.value = detail
  } catch (error) {
    if (requestId !== detailRequestId) return
    selectedVersion.value = null
    detailError.value = error.message || '无法读取版本详情'
  } finally {
    if (requestId === detailRequestId) detailLoading.value = false
  }
}

function clearFilters() {
  query.value = ''
  statusFilter.value = 'all'
  sortOrder.value = 'newest'
}

function handleIndexKeydown(event) {
  if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Enter') return selectedVersionNo.value && openWb(selectedVersionNo.value)
  const direction = event.key === 'ArrowDown' ? 1 : -1
  const nextNo = adjacentVersionNo(filteredVersions.value, selectedVersionNo.value, direction)
  selectVersion(nextNo)
  nextTick(() => document.querySelector(`[data-version-no="${CSS.escape(nextNo)}"]`)?.focus())
}
```

- [ ] **Step 3: Integrate selection into the existing load function**

After assigning `versions.value = list`, preserve or initialize selection:

```js
const currentStillExists = list.some(version => version.versionNo === selectedVersionNo.value)
const nextSelection = currentStillExists ? selectedVersionNo.value : list[0]?.versionNo
if (nextSelection) await selectVersion(nextSelection, { force: true })
else {
  selectedVersionNo.value = null
  selectedVersion.value = null
}
```

Replace the existing slug watcher with:

```js
watch(() => props.slug, async () => {
  detailRequestId += 1
  detailCache.clear()
  selectedVersionNo.value = null
  selectedVersion.value = null
  mobileDetailOpen.value = false
  await load()
})

watch(filteredVersions, list => {
  if (!list.length) return
  if (!list.some(version => version.versionNo === selectedVersionNo.value)) {
    selectVersion(list[0].versionNo)
  }
})
```

- [ ] **Step 4: Add explicit reload and cache-invalidation handlers**

Use these handlers for modal completion and direct mutations:

```js
async function reloadAllVersions() {
  detailCache.clear()
  await load()
}

async function reloadSelectedVersion(versionNo = selectedVersionNo.value) {
  if (versionNo) detailCache.delete(versionNo)
  await load()
}
```

Change `NewVersionModal @created` and `BaselineModal @done` to `reloadAllVersions`. In `doRollback`, clear the cache before `load()`. In the `reopen`, `void`, and `remove` branches of `onAction`, call `reloadSelectedVersion(v.versionNo)` after the API succeeds. Keep `markReadLatest` and the `read` branch on normal `load()` because they change list read markers but not full version detail data.

Use these complete mutation branches:

```js
async function doRollback() {
  if (!app.canWrite) return notify.info('当前是只读模式，不能回滚基线')
  const version = await api.rollback(props.slug)
  notify.success(`已回滚到 ${version.versionNo}`)
  detailCache.clear()
  await load()
}

function onAction(key, version) {
  if (key === 'open') return openWb(version.versionNo)
  if (key === 'download') return window.open(api.downloadUrl(props.slug, version.versionNo), '_blank')
  if (key === 'compare') {
    const other = baseline.value && baseline.value.versionNo !== version.versionNo
      ? baseline.value.versionNo
      : versions.value.find(item => item.versionNo !== version.versionNo)?.versionNo
    return goCompare(version.versionNo, other)
  }
  if (key === 'read') {
    return api.markRead(props.slug, version.versionNo).then(async () => {
      notify.success(`已标记看到 ${version.versionNo}`)
      await load()
    })
  }
  if (key === 'reopen') {
    if (!app.canWrite) return notify.info('当前是只读模式，不能恢复版本')
    return api.reopenVersion(props.slug, version.versionNo).then(async () => {
      notify.success('已恢复为编辑中')
      await reloadSelectedVersion(version.versionNo)
    })
  }
  if (key === 'void') {
    if (!app.canWrite) return notify.info('当前是只读模式，不能废弃版本')
    return confirmDanger({
      title: `废弃版本 ${version.versionNo}？`,
      content: '废弃后默认不在时间线显示，记录保留，可随时恢复。',
      okText: '废弃',
      okType: 'danger',
      onOk: async () => {
        await api.voidVersion(props.slug, version.versionNo)
        notify.success('已废弃')
        await reloadSelectedVersion(version.versionNo)
      }
    })
  }
  if (key === 'remove') {
    if (!app.canWrite) return notify.info('当前是只读模式，不能删除版本')
    return confirmDanger({
      title: `删除版本 ${version.versionNo}？`,
      content: '文件会移入 .flowlark/trash，可在回收站恢复。',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        await api.removeVersion(props.slug, version.versionNo)
        notify.success('已移入回收站')
        await reloadSelectedVersion(version.versionNo)
      }
    })
  }
}
```

- [ ] **Step 5: Run model tests and production build**

```bash
node --test web/src/views/versionTimelineModel.test.js
npm --prefix web run build
```

Expected: model tests pass and build succeeds with no new Vue warnings.

- [ ] **Step 6: Do not commit the pre-modified page file**

Inspect but leave `VersionTimeline.vue` unstaged:

```bash
git diff -- web/src/views/VersionTimeline.vue
git status --short
```

### Task 4: Replace the Timeline Markup and Scoped Styles

**Files:**
- Modify: `web/src/views/VersionTimeline.vue:1-145`
- Modify: `web/src/views/VersionTimeline.vue:267-289`

- [ ] **Step 1: Replace the page root with a centered timeline shell**

Use this structure while retaining the existing Alerts and modal components:

```vue
<div class="page-pad timeline-page">
  <div class="timeline-shell">
    <a-breadcrumb class="timeline-breadcrumb">
      <a-breadcrumb-item><a @click="$router.push('/projects')">项目</a></a-breadcrumb-item>
      <a-breadcrumb-item>{{ project ? project.name : '' }}</a-breadcrumb-item>
    </a-breadcrumb>

    <header class="timeline-head">
      <div class="timeline-project">
        <h1 class="page-title">{{ project ? project.name : '' }}</h1>
        <div class="mono text-secondary">{{ slug }}</div>
      </div>
      <div class="timeline-actions">
        <a-checkbox v-model="includeVoid" @change="load">显示已废弃</a-checkbox>
        <a-button :disabled="versions.length < 2" @click="goCompare()">
          <template #icon><IconFullscreen /></template>并排对比
        </a-button>
        <a-button :disabled="versions.length < 2" @click="cumOpen = true">
          <template #icon><IconBarChart /></template>累计变更
        </a-button>
        <a-button type="primary" :disabled="!app.canWrite" @click="newOpen = true">
          <template #icon><IconPlus /></template>新建版本
        </a-button>
      </div>
    </header>

    <a-alert v-if="!app.canWrite" type="info" show-icon class="timeline-alert" title="当前是只读模式">
      可以查看时间线、标记已读、下载和对比；上传版本、设置基线、废弃和删除需要写权限。
    </a-alert>

    <a-alert v-if="newCount > 0" type="success" show-icon class="timeline-alert">
      自你上次看过 <b class="mono">{{ readState.versionNo }}</b> 之后，新增了
      <b>{{ newCount }}</b> 个版本
      <a class="link-gap" @click="cumOpen = true">看看改了什么</a>
      <a class="link-gap" @click="markReadLatest">标记为已读</a>
    </a-alert>

    <div v-if="baseline" class="baseline-strip">
      <div class="baseline-main">
        <span class="baseline-kicker">当前基线</span>
        <strong class="mono">{{ baseline.versionNo }}</strong>
        <span class="baseline-title" :title="baseline.title">{{ baseline.title }}</span>
      </div>
      <div class="baseline-meta">
        {{ baseline.createdBy }} · {{ fmtAbsolute(baseline.baselineAt || baseline.createdAt) }}
      </div>
      <a-button @click="selectVersion(baseline.versionNo, { openMobile: true })">查看详情</a-button>
      <a-button type="primary" @click="openWb(baseline.versionNo)">打开工作台</a-button>
    </div>

    <a-alert v-else-if="!loading && versions.length > 0" type="warning" show-icon class="timeline-alert"
             title="本项目还没有基线版本">
      研发不知道该按哪一版开发。选择一个版本后设为基线。
    </a-alert>

    <a-spin :spinning="loading">
      <a-empty v-if="!loading && versions.length === 0" description="还没有版本">
        <a-button type="primary" :disabled="!app.canWrite" @click="newOpen = true">上传第一版原型</a-button>
      </a-empty>

      <section v-if="versions.length" class="version-browser" data-testid="version-browser">
        <aside class="version-index" aria-label="版本列表" @keydown="handleIndexKeydown">
          <div class="index-toolbar">
            <a-input v-model="query" allow-clear placeholder="搜索版本、标题、标签或需求">
              <template #prefix><IconSearch /></template>
            </a-input>
            <div class="index-filters">
              <a-select v-model="statusFilter" :options="statusOptions" aria-label="筛选版本状态" />
              <a-select v-model="sortOrder" aria-label="版本排序">
                <a-option value="newest">最新优先</a-option>
                <a-option value="oldest">最早优先</a-option>
              </a-select>
            </div>
          </div>

          <div v-if="filteredVersions.length" class="index-list" role="listbox">
            <button v-for="version in filteredVersions" :key="version.versionNo"
                    class="index-row" :class="{ selected: version.versionNo === selectedVersionNo }"
                    type="button" role="option" :aria-selected="version.versionNo === selectedVersionNo"
                    :data-version-no="version.versionNo" @click="selectVersion(version.versionNo, { openMobile: true })">
              <span class="index-version mono">{{ version.versionNo }}</span>
              <span class="index-copy">
                <a-tooltip :title="version.title">
                  <span class="index-title">{{ version.title }}</span>
                </a-tooltip>
                <span class="index-meta">{{ version.createdBy }} · {{ fmtTime(version.createdAt) }}</span>
              </span>
              <span class="index-state">
                <span v-if="version.isBaseline" class="baseline-marker">基线</span>
                <a-tag v-else :color="version.display.color">{{ version.display.label }}</a-tag>
              </span>
            </button>
          </div>

          <a-empty v-else description="没有匹配的版本">
            <a-button @click="clearFilters">清除筛选</a-button>
          </a-empty>
        </aside>

        <VersionSummary class="desktop-summary" data-testid="desktop-version-summary"
                        :version="selectedVersion" :loading="detailLoading" :error="detailError"
                        :can-write="app.canWrite" :can-rollback="canRollback"
                        @retry="selectVersion(selectedVersionNo, { force: true })"
                        @open="openWb" @baseline="askBaseline" @rollback="doRollback" @action="onAction" />
      </section>
    </a-spin>

    <a-drawer v-model:visible="mobileDetailOpen" title="版本详情" placement="right" width="100%">
      <VersionSummary data-testid="mobile-version-summary" :version="selectedVersion"
                      :loading="detailLoading" :error="detailError" :can-write="app.canWrite"
                      :can-rollback="canRollback" @retry="selectVersion(selectedVersionNo, { force: true })"
                      @open="openWb" @baseline="askBaseline" @rollback="doRollback" @action="onAction" />
    </a-drawer>

    <NewVersionModal v-model:open="newOpen" :slug="slug" @created="reloadAllVersions" />
    <BaselineModal v-model:open="blOpen" :slug="slug" :target="blTarget"
                   :current="baseline ? baseline.versionNo : null"
                   :total-versions="versions.length" @done="reloadAllVersions" />
    <CumulativeModal v-model:open="cumOpen" :slug="slug" :versions="versions"
                     :default-to="baseline ? baseline.versionNo : (versions[0] && versions[0].versionNo)" />
  </div>
</div>
```

- [ ] **Step 2: Implement the centered wide-screen layout**

Replace the old timeline-specific styles with:

```css
.timeline-page { overflow:hidden; }
.timeline-shell { width:min(100%,1440px); margin:0 auto; min-width:0; }
.timeline-breadcrumb { margin-bottom:var(--fl-s-3); }
.timeline-head { display:flex; align-items:flex-start; gap:var(--fl-s-5); margin-bottom:var(--fl-s-4); }
.timeline-project { min-width:0; flex:1; }
.timeline-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:var(--fl-s-2); }
.timeline-alert { margin-bottom:var(--fl-s-4); }
.baseline-strip { min-height:56px; display:flex; align-items:center; gap:var(--fl-s-4); margin-bottom:var(--fl-s-4); padding:var(--fl-s-3) var(--fl-s-4); border-left:3px solid var(--fl-primary); background:var(--fl-primary-bg); }
.baseline-main { min-width:0; flex:1; display:flex; align-items:baseline; gap:var(--fl-s-2); }
.baseline-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.baseline-meta { flex:none; color:var(--fl-text-2); font-size:var(--fl-fs-2); }
.version-browser { min-height:560px; height:calc(100dvh - 280px); display:grid; grid-template-columns:320px minmax(0,1fr); border:1px solid var(--fl-line); border-radius:var(--fl-r-3); background:var(--fl-surface); overflow:hidden; box-shadow:var(--fl-shadow-1); }
.version-index { min-width:0; display:flex; flex-direction:column; border-right:1px solid var(--fl-line); background:var(--fl-surface-2); }
.index-toolbar { padding:var(--fl-s-3); border-bottom:1px solid var(--fl-line); background:var(--fl-surface); }
.index-filters { display:grid; grid-template-columns:1fr 1fr; gap:var(--fl-s-2); margin-top:var(--fl-s-2); }
.index-list { min-height:0; overflow-y:auto; }
.index-row { width:100%; min-height:68px; display:grid; grid-template-columns:52px minmax(0,1fr) auto; align-items:center; gap:var(--fl-s-2); padding:var(--fl-s-3); border:0; border-bottom:1px solid var(--fl-line); border-left:3px solid transparent; background:transparent; color:var(--fl-text); text-align:left; cursor:pointer; }
.index-row:hover { background:var(--fl-surface-3); }
.index-row.selected { border-left-color:var(--fl-primary); background:var(--fl-primary-bg); }
.index-row:focus-visible { position:relative; z-index:1; outline:2px solid var(--fl-primary); outline-offset:-2px; }
.index-version { font-weight:750; color:var(--fl-ink); }
.index-copy { min-width:0; display:flex; flex-direction:column; gap:var(--fl-s-1); }
.index-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
.index-meta { color:var(--fl-text-2); font-size:var(--fl-fs-2); }
.index-state { display:flex; justify-content:flex-end; }
.baseline-marker { color:var(--fl-primary-deep); font-size:var(--fl-fs-2); font-weight:700; }
```

- [ ] **Step 3: Add responsive behavior**

```css
@media (max-width:899px) {
  .timeline-page { overflow:visible; }
  .timeline-head { flex-direction:column; }
  .timeline-actions { width:100%; justify-content:flex-start; }
  .baseline-strip { align-items:flex-start; flex-wrap:wrap; }
  .baseline-main { width:100%; flex-wrap:wrap; }
  .baseline-meta { width:100%; }
  .version-browser { height:auto; min-height:0; display:block; }
  .version-index { border-right:0; }
  .index-list { max-height:none; overflow:visible; }
  .desktop-summary { display:none; }
}

@media (max-width:480px) {
  .index-filters { grid-template-columns:1fr; }
  .index-row { grid-template-columns:48px minmax(0,1fr); }
  .index-state { grid-column:2; }
}
```

- [ ] **Step 4: Verify build and focused model tests**

```bash
node --test web/src/views/versionTimelineModel.test.js
npm --prefix web run build
```

Expected: tests and build pass; no unresolved Vue components or prop warnings.

### Task 5: Add Browser Regression Coverage

**Files:**
- Modify: `.codex-ui-regression/ui-regression.spec.js`
- Generate: `.codex-ui-regression/screenshots/desktop-project-timeline.png`
- Generate: `.codex-ui-regression/screenshots/mobile-project-timeline.png`
- Generate: `.codex-ui-regression/screenshots/wide-project-timeline.png`

- [ ] **Step 1: Add an ultra-wide viewport and timeline assertions**

Add `['wide', { width: 1920, height: 1080 }]` to the viewport list, then add after navigation:

```js
if (route === '/projects/1') {
  await expect(page.getByTestId('version-browser')).toBeVisible()
  const browserBox = await page.getByTestId('version-browser').boundingBox()
  expect(browserBox.width).toBeLessThanOrEqual(1440)
  expect(browserBox.width).toBeGreaterThan(Math.min(viewport.width - 80, 900))

  if (viewport.width >= 900) {
    await expect(page.getByTestId('desktop-version-summary')).toBeVisible()
    const columns = await page.getByTestId('version-browser').evaluate(element =>
      getComputedStyle(element).gridTemplateColumns)
    expect(columns).not.toBe('none')
  }
}
```

- [ ] **Step 2: Add interaction checks for selection, search, and mobile Drawer**

Add a focused timeline test:

```js
test(`${viewportName} timeline browsing`, async ({ page }) => {
  await page.goto(new URL('/#/projects/1', baseUrl).toString(), { waitUntil: 'networkidle' })
  const rows = page.locator('.index-row')
  if (await rows.count() < 2) test.skip(true, 'Fixture has fewer than two versions')

  await rows.nth(1).click()
  if (viewport.width < 900) {
    await expect(page.getByTestId('mobile-version-summary')).toBeVisible()
    await page.keyboard.press('Escape')
  } else {
    await expect(page.getByTestId('desktop-version-summary')).toContainText(
      await rows.nth(1).locator('.index-version').innerText()
    )
  }

  await page.getByPlaceholder('搜索版本、标题、标签或需求').fill('__no_matching_version__')
  await expect(page.getByText('没有匹配的版本')).toBeVisible()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(rows.first()).toBeVisible()
})
```

- [ ] **Step 3: Add a deterministic 60-version browser test**

Add this test outside the viewport loop and before `test.afterAll`:

```js
test.describe('large version history', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('browses and filters 60 versions', async ({ page }) => {
    const syntheticVersions = Array.from({ length: 60 }, (_, index) => {
      const number = 60 - index
      const versionNo = `v${number}`
      return {
        versionNo,
        title: number === 48 ? '唯一命中的历史版本' : `订单中心版本 ${number}`,
        createdBy: number % 2 ? 'Jinny3537' : 'protohub',
        createdAt: new Date(Date.UTC(2026, 7, number)).toISOString(),
        baselineAt: versionNo === 'v1' ? '2026-08-24T08:00:00.000Z' : null,
        display: number % 5 === 0
          ? { key: 'DRAFT', label: '编辑中', color: 'gold' }
          : { key: 'HISTORY', label: '历史版本', color: 'gray' },
        isBaseline: versionNo === 'v1',
        isNew: false,
        isLastRead: false,
        tags: number % 3 === 0 ? ['批量操作'] : [],
        requirements: [{ code: `REQ-${number}`, title: `需求 ${number}` }],
        requirementCount: 1,
        changes: [{ location: '订单列表', description: `版本 ${number} 的变更` }],
        changeCount: 1,
        externalRefs: [],
        reviewStatus: 'confirmed'
      }
    })

    await page.route('**/api/projects/1/versions**', route => route.fulfill({ json: syntheticVersions }))
    await page.route(/\/api\/versions\/1\/v\d+$/, route => {
      const versionNo = new URL(route.request().url()).pathname.split('/').at(-1)
      const version = syntheticVersions.find(item => item.versionNo === versionNo)
      return route.fulfill({ json: { ...version, spec: '', attachments: [], hasOffline: false } })
    })

    await page.goto(new URL('/#/projects/1', baseUrl).toString(), { waitUntil: 'networkidle' })
    const rows = page.locator('.index-row')
    await expect(rows).toHaveCount(60)

    const listMetrics = await page.locator('.index-list').evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }))
    expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight)

    await page.getByPlaceholder('搜索版本、标题、标签或需求').fill('唯一命中')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('v48')
  })
})
```

- [ ] **Step 4: Install isolated Playwright dependencies and run the suite**

```bash
npm install --prefix .codex-ui-regression @playwright/test@1.55.0 --no-save
python3 /Users/beluga/.codex/skills/webapp-testing/scripts/with_server.py --server "npm --prefix web run dev -- --host 127.0.0.1 --port 5173" --port 5173 --timeout 45 -- .codex-ui-regression/node_modules/.bin/playwright test .codex-ui-regression/ui-regression.spec.js --reporter=line --workers=1
```

Expected: all desktop, wide, and mobile page checks pass; empty Alerts, horizontal overflow, page errors, and Flowlark console warnings are all zero.

- [ ] **Step 5: Visually inspect the generated timeline screenshots**

Inspect these files at original resolution:

```text
.codex-ui-regression/screenshots/desktop-project-timeline.png
.codex-ui-regression/screenshots/wide-project-timeline.png
.codex-ui-regression/screenshots/mobile-project-timeline.png
```

Confirm that the baseline strip is compact, the desktop columns are balanced, the list is primary, mobile rows fit without text collisions, and no controls overlap.

- [ ] **Step 6: Remove only temporary test dependencies**

Delete `.codex-ui-regression/node_modules` and `test-results` after the test run while retaining screenshots, the test script, and the JSON report.

### Task 6: Final Verification and Handoff

**Files:**
- Verify: all files above

- [ ] **Step 1: Run final static and build checks**

```bash
node --test web/src/views/versionTimelineModel.test.js
npm --prefix web run build
git diff --check
```

Expected: model tests pass, production build succeeds, and no whitespace errors are reported.

- [ ] **Step 2: Confirm scope and preserved changes**

```bash
git status --short
git diff -- web/src/views/VersionTimeline.vue web/src/components/VersionSummary.vue web/src/views/versionTimelineModel.js web/src/views/versionTimelineModel.test.js .codex-ui-regression/ui-regression.spec.js
```

Confirm no unrelated source file was modified by this redesign and that the pre-existing `VersionTimeline.vue` changes remain present.

- [ ] **Step 3: Report the result**

Report the implemented layout, tests and viewport results, artifact paths, remaining warnings, and the fact that the combined dirty `VersionTimeline.vue` diff was intentionally not committed.
