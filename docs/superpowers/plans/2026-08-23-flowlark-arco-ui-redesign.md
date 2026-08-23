# Flowlark Arco UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Flowlark's full web UI from Ant Design Vue to Arco Design Vue and reshape all pages into a coherent workflow-console experience.

**Architecture:** Keep the current Vue 3/Vite/Vue Router/Pinia/API architecture and replace only the UI framework, app shell, page templates, and shared visual components. Introduce small UI support modules so API feedback, layout primitives, and status display are not coupled to a specific page.

**Tech Stack:** Vue 3, Vite, Pinia, Vue Router, Arco Design Vue, Arco icon package, CSS custom properties, existing Flowlark API.

---

## Source Spec

Use this approved design document as the source of truth:

- `docs/superpowers/specs/2026-08-23-flowlark-arco-ui-redesign-design.md`

Also follow:

- `DESIGN.md`
- `design-system/flowlark/MASTER.md`

## Current Constraints

- The repository may already have unrelated modified and deleted files. Do not revert or format unrelated work.
- The migration touches only `web/`, `DESIGN.md`, and `design-system/flowlark/MASTER.md` unless a build failure proves another file is directly required.
- Backend routes, CLI behavior, storage files, and API payload shapes are out of scope.
- Keep commits narrow and build after every meaningful stage.

## File Structure

Create:

- `web/src/ui/feedback.js` - Arco-backed message, notification, and confirmation helpers used by API and views.
- `web/src/ui/status.js` - shared label/color mapping for version, review, Git, notification, and readiness states.
- `web/src/components/layout/PageShell.vue` - common page wrapper with title, description, actions, stats, and body slots.
- `web/src/components/layout/StatusPill.vue` - accessible status tag wrapper that always includes readable text.
- `web/src/components/layout/ResponsiveDataView.vue` - table/card switch wrapper for list pages.

Modify:

- `web/package.json` - replace AntD dependencies with Arco dependencies.
- `web/src/main.js` - register Arco and Arco CSS.
- `web/src/brand.js` - replace AntD theme export with Arco token mapping constants.
- `web/src/style.css` - remove `.ant-*` rules, add `.arco-*` token overrides and page-template classes.
- `web/src/api.js` - import feedback helpers instead of `ant-design-vue`.
- `web/src/App.vue` - rebuild app shell with Arco components.
- All files under `web/src/components/*.vue` - migrate AntD tags/imports and icon usage.
- All files under `web/src/views/*.vue` - migrate AntD tags/imports and apply page templates.
- `DESIGN.md` - update framework rule to Arco Design Vue.
- `design-system/flowlark/MASTER.md` - update framework rule and implementation notes.

Do not modify:

- `src/server/*`
- `src/core/*`
- `test/*`
- storage/data examples

## Component Mapping

Use this mapping consistently:

| Ant Design Vue | Arco Design Vue |
|---|---|
| `a-config-provider` | `a-config-provider` |
| `a-layout`, `a-layout-header`, `a-layout-sider`, `a-layout-content` | `a-layout`, `a-layout-header`, `a-layout-sider`, `a-layout-content` |
| `a-button` | `a-button` |
| `a-dropdown` + overlay/menu slots | `a-dropdown` + `#content` with `a-doption` |
| `a-menu`, `a-menu-item` | `a-menu`, `a-menu-item` |
| `a-popover` | `a-popover` |
| `a-tooltip` | `a-tooltip` |
| `a-badge` | `a-badge` |
| `a-tag` | `a-tag` |
| `a-alert` | `a-alert` |
| `a-table` `:data-source` | `a-table` `:data` |
| `#bodyCell="{ column, record }"` | Arco column slots or `#columns` with `a-table-column` |
| `a-modal v-model:open` | `a-modal v-model:visible` |
| `a-drawer v-model:open` | `a-drawer v-model:visible` |
| `a-form-item help` | `a-form-item extra` |
| `v-model:value` on input/select | `v-model` for Arco input/select |
| `v-model:checked` on checkbox | `v-model` for Arco checkbox |
| `message` from `ant-design-vue` | `Message` through `web/src/ui/feedback.js` |
| `Modal.confirm` | `Modal.confirm` through `web/src/ui/feedback.js` |

If a specific Arco component API differs during implementation, verify against installed package types/examples in `web/node_modules/@arco-design/web-vue` after installing dependencies and adjust only that call site.

## Task 1: Install Arco And Add Feedback Abstraction

**Files:**

- Modify: `web/package.json`
- Modify: `web/src/main.js`
- Create: `web/src/ui/feedback.js`
- Modify: `web/src/api.js`

- [ ] **Step 1: Update dependencies**

Edit `web/package.json` dependencies to remove:

```json
"@ant-design/icons-vue": "^7.0.1",
"ant-design-vue": "^4.2.6"
```

Add:

```json
"@arco-design/web-vue": "^2.57.0"
```

Keep `vue`, `vue-router`, `pinia`, `dompurify`, and `marked` unchanged.

- [ ] **Step 2: Install packages**

Run:

```bash
cd web && npm install
```

Expected: `package-lock.json` updates and `node_modules/@arco-design/web-vue` exists.

- [ ] **Step 3: Register Arco in the app entry**

Replace `web/src/main.js` with:

```js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ArcoVue from '@arco-design/web-vue'
import '@arco-design/web-vue/dist/arco.css'
import './style.css'

import App from './App.vue'
import router from './router'

createApp(App).use(createPinia()).use(router).use(ArcoVue).mount('#app')
```

- [ ] **Step 4: Create feedback helper**

Create `web/src/ui/feedback.js`:

```js
import { Message, Modal, Notification } from '@arco-design/web-vue'

export const notify = {
  success(content) {
    return Message.success({ content })
  },
  error(content) {
    return Message.error({ content })
  },
  warning(content) {
    return Message.warning({ content })
  },
  info(content) {
    return Message.info({ content })
  }
}

export function confirmDanger({ title, content, okText = '确认', cancelText = '取消', onOk }) {
  return Modal.confirm({
    title,
    content,
    okText,
    cancelText,
    okButtonProps: { status: 'danger' },
    onOk
  })
}

export function confirmAction({ title, content, okText = '确认', cancelText = '取消', onOk }) {
  return Modal.confirm({
    title,
    content,
    okText,
    cancelText,
    onOk
  })
}

export const notification = Notification
```

- [ ] **Step 5: Decouple API from AntD**

In `web/src/api.js`, replace:

```js
import { message } from 'ant-design-vue'
```

With:

```js
import { notify } from './ui/feedback'
```

Then replace every `message.error`, `message.warning`, `message.success`, and `message.info` in `web/src/api.js` with `notify.error`, `notify.warning`, `notify.success`, and `notify.info`.

- [ ] **Step 6: Run build and confirm expected temporary failures**

Run:

```bash
cd web && npm run build
```

Expected: build fails because other files still import `ant-design-vue` and `@ant-design/icons-vue`. The failure should not mention `web/src/main.js` or `web/src/api.js` importing AntD.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/src/main.js web/src/api.js web/src/ui/feedback.js
git commit -m "chore: add Arco UI foundation"
```

## Task 2: Token Bridge And Global Arco Styles

**Files:**

- Modify: `web/src/brand.js`
- Modify: `web/src/style.css`
- Modify: `DESIGN.md`
- Modify: `design-system/flowlark/MASTER.md`

- [ ] **Step 1: Replace AntD theme export**

In `web/src/brand.js`, keep `BRAND` and replace `antdTheme` with `arcoThemeTokens`:

```js
export const arcoThemeTokens = {
  primary: BRAND.primary,
  primaryHover: BRAND.primaryHover,
  primaryActive: BRAND.primaryActive,
  text: '#16211F',
  textSecondary: '#5B6866',
  textTertiary: '#8C9997',
  border: '#DDE5E3',
  background: '#F4F7F6',
  surface: '#FFFFFF',
  warning: '#DC6803',
  danger: '#D92D20',
  success: '#039855'
}
```

- [ ] **Step 2: Replace AntD global selectors**

In `web/src/style.css`, remove `.ant-*` component selectors and replace them with Arco selectors:

```css
.arco-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--fl-s-1);
  border-radius: var(--fl-r-2);
  font-weight: 500;
  transition:
    color .18s var(--fl-ease),
    background-color .18s var(--fl-ease),
    border-color .18s var(--fl-ease),
    box-shadow .18s var(--fl-ease),
    transform .18s var(--fl-ease);
}

.arco-btn:not(.arco-btn-text):not(.arco-btn-outline):hover {
  transform: translateY(-1px);
  box-shadow: var(--fl-shadow-1);
}

.arco-card {
  border-color: var(--fl-line);
  border-radius: var(--fl-r-3);
  box-shadow: var(--fl-shadow-1);
}

.arco-modal,
.arco-drawer {
  color: var(--fl-text);
}

.arco-table-th {
  background: var(--fl-surface-2);
  color: var(--fl-text-2);
  font-size: var(--fl-fs-2);
  font-weight: 650;
}

.arco-table-tr:hover .arco-table-td {
  background: var(--fl-primary-bg);
}

.arco-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--fl-s-1);
  border-radius: var(--fl-r-1);
  font-weight: 500;
}
```

Keep existing `:root`, `body`, `*:focus-visible`, responsive shell classes, and page utility classes unless they directly target AntD internals.

- [ ] **Step 3: Add page template classes**

Append to `web/src/style.css`:

```css
.flow-page {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--fl-s-5);
}

.flow-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--fl-s-4);
  margin-bottom: var(--fl-s-4);
}

.flow-page-title {
  margin: 0;
  color: var(--fl-ink);
  font-size: var(--fl-fs-5);
  line-height: 1.25;
}

.flow-page-description {
  margin: var(--fl-s-1) 0 0;
  color: var(--fl-text-2);
}

.flow-page-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--fl-s-2);
}

.flow-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--fl-s-3);
  margin-bottom: var(--fl-s-4);
}

.flow-stat {
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  background: var(--fl-surface);
  padding: var(--fl-s-3);
  box-shadow: var(--fl-shadow-1);
}

@media (max-width: 768px) {
  .flow-page {
    padding: var(--fl-s-3);
  }

  .flow-page-header {
    display: block;
  }

  .flow-page-actions {
    justify-content: flex-start;
    margin-top: var(--fl-s-3);
  }
}
```

- [ ] **Step 4: Update docs framework references**

In `DESIGN.md`, replace "Ant Design Vue 4" with "Arco Design Vue".

In `design-system/flowlark/MASTER.md`, update "Vue 3 `<script setup>` + Ant Design Vue 4 + Vite" to "Vue 3 `<script setup>` + Arco Design Vue + Vite". Replace AntD theme notes with an Arco token bridge note.

- [ ] **Step 5: Verify no AntD theme references remain**

Run:

```bash
rg -n "antdTheme|Ant Design Vue|ant-design-vue|\\.ant-" web/src DESIGN.md design-system/flowlark/MASTER.md
```

Expected: only temporary AntD imports/usages in unmigrated Vue files remain. There should be no `antdTheme` and no `.ant-*` CSS selectors.

- [ ] **Step 6: Commit**

```bash
git add web/src/brand.js web/src/style.css DESIGN.md design-system/flowlark/MASTER.md
git commit -m "style: add Arco token bridge"
```

## Task 3: Shared Layout Components

**Files:**

- Create: `web/src/components/layout/PageShell.vue`
- Create: `web/src/components/layout/StatusPill.vue`
- Create: `web/src/components/layout/ResponsiveDataView.vue`
- Create: `web/src/ui/status.js`

- [ ] **Step 1: Create `PageShell.vue`**

Create `web/src/components/layout/PageShell.vue`:

```vue
<template>
  <section class="flow-page">
    <header class="flow-page-header">
      <div>
        <slot name="breadcrumb" />
        <h1 class="flow-page-title">{{ title }}</h1>
        <p v-if="description" class="flow-page-description">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flow-page-actions">
        <slot name="actions" />
      </div>
    </header>

    <div v-if="$slots.stats" class="flow-stats" aria-label="页面状态摘要">
      <slot name="stats" />
    </div>

    <slot />
  </section>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' }
})
</script>
```

- [ ] **Step 2: Create `StatusPill.vue`**

Create `web/src/components/layout/StatusPill.vue`:

```vue
<template>
  <a-tag :color="color" class="status-pill">
    <span v-if="dot" class="status-pill-dot" aria-hidden="true" />
    <slot>{{ label }}</slot>
  </a-tag>
</template>

<script setup>
defineProps({
  label: { type: String, default: '' },
  color: { type: String, default: 'gray' },
  dot: { type: Boolean, default: false }
})
</script>
```

Add to `web/src/style.css`:

```css
.status-pill {
  white-space: nowrap;
}

.status-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}
```

- [ ] **Step 3: Create `ResponsiveDataView.vue`**

Create `web/src/components/layout/ResponsiveDataView.vue`:

```vue
<template>
  <div class="responsive-data-view">
    <div class="responsive-data-table">
      <slot name="table" />
    </div>
    <div class="responsive-data-cards">
      <slot name="cards" />
    </div>
  </div>
</template>
```

Add to `web/src/style.css`:

```css
.responsive-data-cards {
  display: none;
}

@media (max-width: 768px) {
  .responsive-data-table {
    display: none;
  }

  .responsive-data-cards {
    display: grid;
    gap: var(--fl-s-3);
  }
}
```

- [ ] **Step 4: Create shared status maps**

Create `web/src/ui/status.js`:

```js
export const versionStatus = {
  DRAFT: { label: '草稿', color: 'orange' },
  BASELINE: { label: '基线', color: 'green' },
  HISTORY: { label: '历史', color: 'gray' },
  VOID: { label: '已废弃', color: 'red' }
}

export const reviewStatus = {
  unread: { label: '未读', color: 'orange' },
  reviewing: { label: '审阅中', color: 'blue' },
  approved: { label: '已确认', color: 'green' },
  obsolete: { label: '已过期', color: 'gray' }
}

export function gitStatusLabel(status) {
  if (!status || !status.tracked) return { label: '未纳入 Git', color: 'gray' }
  if (status.conflicts && status.conflicts.length) return { label: `${status.conflicts.length} 个冲突`, color: 'red' }
  if (status.files && status.files.length) return { label: `${status.files.length} 处改动`, color: 'orange' }
  return { label: '工作区干净', color: 'green' }
}
```

- [ ] **Step 5: Run a syntax-only build check**

Run:

```bash
cd web && npm run build
```

Expected: build still fails on remaining AntD imports/usages, but the new layout files compile if imported manually is not yet required.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/layout web/src/ui/status.js web/src/style.css
git commit -m "feat: add shared UI layout primitives"
```

## Task 4: Migrate App Shell To Arco

**Files:**

- Modify: `web/src/App.vue`

- [ ] **Step 1: Replace imports**

In `web/src/App.vue`, remove imports from `ant-design-vue/es/locale/zh_CN`, `ant-design-vue`, and `@ant-design/icons-vue`.

Use:

```js
import { notify } from './ui/feedback'
import {
  IconApps,
  IconArchive,
  IconBell,
  IconBranch,
  IconCalendar,
  IconDelete,
  IconFile,
  IconFolder,
  IconInbox,
  IconPlus,
  IconSearch,
  IconSend,
  IconSettings,
  IconUserGroup
} from '@arco-design/web-vue/es/icon'
```

Replace `message.success('通知队列已处理')` with `notify.success('通知队列已处理')`.

- [ ] **Step 2: Replace config provider**

Change:

```vue
<a-config-provider :locale="zhCN" :theme="theme">
```

To:

```vue
<a-config-provider>
```

Remove `const theme = antdTheme`.

- [ ] **Step 3: Convert dropdown and modal bindings**

Use `v-model:visible` for Arco modal:

```vue
<a-modal
  v-model:visible="settingsOpen"
  title="设置"
  :width="860"
  :footer="false"
  modal-class="settings-modal"
  unmount-on-close
>
  <SettingsView embedded />
</a-modal>
```

Use Arco dropdown content:

```vue
<a-dropdown trigger="click">
  <a-button type="primary" class="quick-create-button" :disabled="!app.canWrite">
    <template #icon><IconPlus /></template>
    <span>快速创建</span>
  </a-button>
  <template #content>
    <a-doption value="version" @click="onQuickCreate({ key: 'version' })">
      <IconFile /> 导入原型
    </a-doption>
    <a-doption value="requirement" @click="onQuickCreate({ key: 'requirement' })">
      <IconUserGroup /> 新建需求
    </a-doption>
    <a-doption value="milestone" @click="onQuickCreate({ key: 'milestone' })">
      <IconCalendar /> 新建迭代
    </a-doption>
    <a-doption value="delivery" @click="onQuickCreate({ key: 'delivery' })">
      <IconSend /> 创建交付快照
    </a-doption>
  </template>
</a-dropdown>
```

- [ ] **Step 4: Convert sidebar menu**

Use Arco menu selection:

```vue
<a-menu
  :selected-keys="activeKey ? [activeKey] : []"
  class="app-menu"
  @menu-item-click="(key) => $router.push('/' + key)"
>
  <a-menu-item key="actions"><template #icon><IconApps /></template>个人工作台</a-menu-item>
  <a-menu-item key="projects"><template #icon><IconFolder /></template>项目</a-menu-item>
  <a-menu-item key="requirements"><template #icon><IconFile /></template>需求</a-menu-item>
  <a-menu-item key="milestones"><template #icon><IconCalendar /></template>迭代</a-menu-item>
  <a-menu-item key="deliveries"><template #icon><IconSend /></template>交付</a-menu-item>
  <a-menu-item key="watch"><template #icon><IconInbox /></template>草稿箱</a-menu-item>
  <a-menu-item key="trash"><template #icon><IconDelete /></template>回收站</a-menu-item>
</a-menu>
```

- [ ] **Step 5: Add contextual live badge text**

Near notification badge, add:

```vue
<span class="sr-only" role="status" aria-atomic="true">
  {{ pendingNotifications.length }} 条交付通知待重试
</span>
```

Add to `web/src/style.css` if not already present:

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 6: Build and fix only App shell errors**

Run:

```bash
cd web && npm run build
```

Expected: errors for other unmigrated files may remain. There should be no `App.vue` AntD import error.

- [ ] **Step 7: Commit**

```bash
git add web/src/App.vue web/src/style.css
git commit -m "feat: migrate app shell to Arco"
```

## Task 5: Migrate Shared Components

**Files:**

- Modify: `web/src/components/Attachments.vue`
- Modify: `web/src/components/BaselineModal.vue`
- Modify: `web/src/components/ChangeEditor.vue`
- Modify: `web/src/components/ChangeList.vue`
- Modify: `web/src/components/CumulativeModal.vue`
- Modify: `web/src/components/FeedbackDrawer.vue`
- Modify: `web/src/components/GitPanel.vue`
- Modify: `web/src/components/NewVersionModal.vue`
- Modify: `web/src/components/RequirementEditor.vue`
- Modify: `web/src/components/ReviewStatusControl.vue`
- Modify: `web/src/components/SearchPalette.vue`
- Modify: `web/src/components/AnnotationOverlay.vue`

- [ ] **Step 1: Replace feedback imports**

For every component in this task, replace:

```js
import { message } from 'ant-design-vue'
```

With:

```js
import { notify } from '../ui/feedback'
```

For components importing `Modal`, use:

```js
import { confirmAction, confirmDanger, notify } from '../ui/feedback'
```

Replace `message.success/error/warning/info` with `notify.success/error/warning/info`.

- [ ] **Step 2: Replace icons**

Replace `@ant-design/icons-vue` imports with Arco icon imports from `@arco-design/web-vue/es/icon`. Use these mappings:

```js
CloseOutlined -> IconClose
PlusOutlined -> IconPlus
UploadOutlined -> IconUpload
WarningOutlined -> IconExclamationCircle
ArrowRightOutlined -> IconArrowRight
SearchOutlined -> IconSearch
ReloadOutlined -> IconRefresh
CloudDownloadOutlined -> IconDownload
CodeOutlined -> IconCode
LockOutlined -> IconLock
```

If an exact icon name is unavailable, run:

```bash
ls web/node_modules/@arco-design/web-vue/es/icon | sed -n '1,160p'
```

Then choose the closest semantic Arco icon and keep one icon family.

- [ ] **Step 3: Convert modal/drawer bindings**

Apply these replacements:

```vue
<!-- before -->
<a-modal :open="open" @update:open="$emit('update:open', $event)">

<!-- after -->
<a-modal :visible="open" @update:visible="$emit('update:open', $event)">
```

```vue
<!-- before -->
<a-drawer :open="open" @update:open="$emit('update:open', $event)">

<!-- after -->
<a-drawer :visible="open" @update:visible="$emit('update:open', $event)">
```

Keep parent component prop names as `open` to avoid broad event-contract churn.

- [ ] **Step 4: Convert form v-model usage**

Apply these replacements:

```vue
<a-input v-model:value="form.name" />
```

To:

```vue
<a-input v-model="form.name" />
```

And:

```vue
<a-checkbox v-model:checked="form.enabled" />
```

To:

```vue
<a-checkbox v-model="form.enabled" />
```

- [ ] **Step 5: Convert select options**

Replace AntD option tags:

```vue
<a-select v-model:value="row.type">
  <a-select-option value="ADD">新增</a-select-option>
</a-select>
```

With Arco option tags:

```vue
<a-select v-model="row.type">
  <a-option value="ADD">新增</a-option>
</a-select>
```

- [ ] **Step 6: Convert confirmations**

Replace `Modal.confirm({ ... })` destructive calls with:

```js
confirmDanger({
  title: '删除附件？',
  content: '删除后需要重新上传才能恢复。',
  okText: '删除',
  onOk: async () => {
    await api.removeAttachment(props.slug, props.versionNo, item.name)
    notify.success('已删除')
    emit('changed')
  }
})
```

For non-destructive confirmation use `confirmAction`.

- [ ] **Step 7: Build after shared migration**

Run:

```bash
cd web && npm run build
```

Expected: no AntD import errors from `web/src/components`. Remaining errors should be in `web/src/views`.

- [ ] **Step 8: Commit**

```bash
git add web/src/components web/src/ui/feedback.js
git commit -m "feat: migrate shared components to Arco"
```

## Task 6: Migrate Console And Project Core Pages

**Files:**

- Modify: `web/src/views/ActionCenter.vue`
- Modify: `web/src/views/ProjectList.vue`
- Modify: `web/src/views/VersionTimeline.vue`

- [ ] **Step 1: Wrap each page in `PageShell`**

Import:

```js
import PageShell from '../components/layout/PageShell.vue'
import StatusPill from '../components/layout/StatusPill.vue'
import ResponsiveDataView from '../components/layout/ResponsiveDataView.vue'
import { notify, confirmAction } from '../ui/feedback'
```

Use this page shell shape:

```vue
<PageShell title="个人工作台" description="聚合今日待处理版本、评审、交付和同步状态。">
  <template #actions>
    <a-button @click="load" :loading="loading">
      <template #icon><IconRefresh /></template>
      刷新
    </a-button>
    <a-button type="primary" @click="$router.push('/projects')">
      <template #icon><IconFolder /></template>
      查看项目
    </a-button>
  </template>

  <template #stats>
    <div class="flow-stat">
      <div class="label">待处理</div>
      <strong>{{ attentionItems.length }}</strong>
    </div>
  </template>

  <!-- existing main content, converted to Arco -->
</PageShell>
```

- [ ] **Step 2: Convert AntD components to Arco**

Apply mappings from the Component Mapping section:

- `:data-source` to `:data`
- `a-select-option` to `a-option`
- `v-model:value` to `v-model`
- `v-model:open` to `v-model:visible`
- AntD icons to Arco icons
- `message` to `notify`
- `Modal.confirm` to `confirmAction` or `confirmDanger`

- [ ] **Step 3: Preserve key behavior**

Verify these functions still exist and are wired:

- `ActionCenter`: `load`, `goWorkbench`, `goProject`, `createProject`, `setBaseline`, `rollback`, `markVersionRead`, `buildOffline`, `syncGit`, `refreshMirror`
- `ProjectList`: `load`, `submit`
- `VersionTimeline`: version opening, baseline setting, new version modal opening, compare route opening

- [ ] **Step 4: Build**

Run:

```bash
cd web && npm run build
```

Expected: these three files no longer produce AntD import or template errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/ActionCenter.vue web/src/views/ProjectList.vue web/src/views/VersionTimeline.vue
git commit -m "feat: migrate console and project pages to Arco"
```

## Task 7: Migrate Workbench And Compare

**Files:**

- Modify: `web/src/views/Workbench.vue`
- Modify: `web/src/views/Compare.vue`
- Modify: `web/src/style.css`

- [ ] **Step 1: Convert imports and component bindings**

Replace all AntD imports, icon imports, modal bindings, drawer bindings, select options, and `v-model:value` usage using the same mappings from Task 5.

- [ ] **Step 2: Apply workbench layout classes**

Add or update these classes in `web/src/style.css`:

```css
.workbench-layout {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(320px, 420px);
  gap: var(--fl-s-4);
  min-height: 0;
}

.workbench-preview {
  min-height: 520px;
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  background: var(--fl-surface);
  overflow: hidden;
}

.workbench-side {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--fl-s-3);
}

@media (max-width: 1024px) {
  .workbench-layout {
    grid-template-columns: 1fr;
  }

  .workbench-preview {
    min-height: 420px;
  }
}
```

- [ ] **Step 3: Keep prototype iframe sandbox behavior unchanged**

Do not change iframe URL construction or sandbox attributes. Only move the iframe into the new layout container.

- [ ] **Step 4: Convert Compare table/list rendering**

For Arco tables, use:

```vue
<a-table :data="rows" :pagination="false" :bordered="false" row-key="key">
  <template #columns>
    <a-table-column title="位置" data-index="location" />
    <a-table-column title="变更" data-index="content" />
  </template>
</a-table>
```

If `Compare.vue` needs custom cells, use column slots and keep row keys stable.

- [ ] **Step 5: Build**

Run:

```bash
cd web && npm run build
```

Expected: `Workbench.vue` and `Compare.vue` compile without AntD imports or template errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/views/Workbench.vue web/src/views/Compare.vue web/src/style.css
git commit -m "feat: migrate workbench and compare views"
```

## Task 8: Migrate Workflow List And Detail Pages

**Files:**

- Modify: `web/src/views/RequirementList.vue`
- Modify: `web/src/views/RequirementDetail.vue`
- Modify: `web/src/views/MilestoneList.vue`
- Modify: `web/src/views/MilestoneDetail.vue`
- Modify: `web/src/views/DeliveryList.vue`
- Modify: `web/src/views/DeliveryDetail.vue`
- Modify: `web/src/views/WatchInbox.vue`
- Modify: `web/src/views/SearchPanel.vue`
- Modify: `web/src/views/Trash.vue`

- [ ] **Step 1: Convert all feedback imports**

Use:

```js
import { notify, confirmDanger } from '../ui/feedback'
```

Replace all direct AntD `message` and `Modal` usage.

- [ ] **Step 2: Apply list/detail templates**

Use `PageShell` on every page. Example for `RequirementList.vue`:

```vue
<PageShell title="需求" description="按业务需求查看跨项目版本演进。">
  <template #actions>
    <a-button :disabled="!app.canWrite" :loading="syncing" @click="syncFromPlatform">同步需求池</a-button>
    <a-button type="primary" :disabled="!app.canWrite" @click="open = true">新建需求</a-button>
  </template>
  <!-- migrated table/card content -->
</PageShell>
```

Use breadcrumbs or parent context in detail pages:

```vue
<template #breadcrumb>
  <a-breadcrumb>
    <a-breadcrumb-item>
      <button type="button" class="text-button" @click="$router.push('/requirements')">需求</button>
    </a-breadcrumb-item>
    <a-breadcrumb-item>{{ code }}</a-breadcrumb-item>
  </a-breadcrumb>
</template>
```

- [ ] **Step 3: Convert tables**

For each Arco table:

- Use `:data`, not `:data-source`.
- Keep `row-key` stable.
- Use `:pagination="false"` where current behavior has no pagination.
- Use explicit `:scroll="{ x: 760 }"` only where table comparison requires it.

- [ ] **Step 4: Convert modals and forms**

Use:

```vue
<a-modal v-model:visible="open" title="新建迭代" :confirm-loading="saving" @ok="create">
  <a-form layout="vertical">
    <a-form-item label="迭代标识" required>
      <a-input v-model="form.name" class="mono" placeholder="2026-S12" />
    </a-form-item>
  </a-form>
</a-modal>
```

- [ ] **Step 5: Build**

Run:

```bash
cd web && npm run build
```

Expected: no AntD import errors remain in workflow views.

- [ ] **Step 6: Commit**

```bash
git add web/src/views/RequirementList.vue web/src/views/RequirementDetail.vue web/src/views/MilestoneList.vue web/src/views/MilestoneDetail.vue web/src/views/DeliveryList.vue web/src/views/DeliveryDetail.vue web/src/views/WatchInbox.vue web/src/views/SearchPanel.vue web/src/views/Trash.vue
git commit -m "feat: migrate workflow pages to Arco"
```

## Task 9: Migrate Settings, Operation Log, And Setup Wizard

**Files:**

- Modify: `web/src/views/Settings.vue`
- Modify: `web/src/views/OpLog.vue`
- Modify: `web/src/views/SetupWizard.vue`

- [ ] **Step 1: Convert imports and components**

Replace AntD imports, icons, `message`, `Modal`, form bindings, select options, tabs, alerts, tables, upload, and modal/drawer visibility props using earlier mappings.

- [ ] **Step 2: Apply settings template**

Use `PageShell` when `Settings.vue` is not embedded:

```vue
<PageShell v-if="!embedded" title="设置" description="配置服务、Git、集成、通知、规则、外观和日志。">
  <SettingsContent />
</PageShell>
```

If splitting `Settings.vue` is necessary to keep the file understandable, create:

- `web/src/views/settings/SettingsContent.vue`
- `web/src/views/settings/SettingsSectionNav.vue`

Keep the public `Settings.vue` route and `embedded` prop behavior unchanged.

- [ ] **Step 3: Preserve setup wizard behavior**

Ensure `SetupWizard.vue` still validates these before creating a version:

- selected project
- base version
- HTML content
- new version number
- new title

Use `notify.warning` for validation feedback and `notify.success` after creation.

- [ ] **Step 4: Build**

Run:

```bash
cd web && npm run build
```

Expected: build passes or reports only remaining references outside `web/src/views` and `web/src/components`.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/Settings.vue web/src/views/OpLog.vue web/src/views/SetupWizard.vue web/src/views/settings
git commit -m "feat: migrate settings and setup views"
```

If `web/src/views/settings` was not created, omit that path from `git add`.

## Task 10: Remove Remaining AntD References

**Files:**

- Modify: any `web/src/**/*.vue`, `web/src/**/*.js`, `web/package.json`, or `web/package-lock.json` files still reported by the search command.

- [ ] **Step 1: Search for AntD**

Run:

```bash
rg -n "ant-design-vue|@ant-design/icons-vue|<a-[a-z-]+|v-model:value|v-model:checked|v-model:open|:data-source|bodyCell|\\.ant-" web/src web/package.json
```

Expected: no `ant-design-vue` or `@ant-design/icons-vue` results. Some `<a-*` results are valid because Arco uses the same component prefix.

- [ ] **Step 2: Fix legacy binding results**

For every result:

- `v-model:value` -> `v-model`
- `v-model:checked` -> `v-model`
- `v-model:open` -> `v-model:visible`
- `:data-source` -> `:data`
- `#bodyCell` -> Arco table column slots
- `.ant-*` -> `.arco-*` or Flowlark class

- [ ] **Step 3: Confirm dependency removal**

Run:

```bash
cd web && npm ls ant-design-vue @ant-design/icons-vue
```

Expected: npm reports both packages as missing or empty from the dependency tree.

- [ ] **Step 4: Build**

Run:

```bash
cd web && npm run build
```

Expected: build passes.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "chore: remove remaining AntD references"
```

## Task 11: Responsive And Accessibility Pass

**Files:**

- Modify: `web/src/style.css`
- Modify: any page/component with accessibility or responsive findings.

- [ ] **Step 1: Start dev server**

Run:

```bash
cd web && npm run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL such as `http://127.0.0.1:5173/`.

- [ ] **Step 2: Check key routes manually**

Open these routes:

```text
/#/actions
/#/projects
/#/requirements
/#/milestones
/#/deliveries
/#/watch
/#/settings
```

For project-specific routes, use data available in the local repo:

```text
/#/projects/<slug>
/#/projects/<slug>/versions/<versionNo>
/#/projects/<slug>/compare
```

- [ ] **Step 3: Verify responsive widths**

Check 375px, 768px, 1024px, and 1440px widths.

Acceptance:

- No unintended horizontal scroll on app shell.
- Sidebar hides or collapses on mobile.
- Workbench and Compare switch to one-column or tabs.
- Settings remains usable without clipped labels or actions.
- Button text does not overflow its container.

- [ ] **Step 4: Verify keyboard access**

Using only keyboard:

- Focus reaches top search.
- Focus reaches quick create.
- Focus reaches notification panel.
- Focus reaches Git panel.
- Focus reaches sidebar menu.
- Focus reaches table/card row actions.
- Dialogs and drawers can be closed.

If a custom clickable element is not keyboard reachable, change it to `<button>` or `<a>`.

- [ ] **Step 5: Verify accessible names**

Run:

```bash
rg -n "<a-button[^>]*(shape=\"circle\"|class=\"[^\"]*(icon|settings|close)|type=\"text\")" web/src
```

For every icon-only button found, add `aria-label`.

- [ ] **Step 6: Verify destructive confirmations**

Check these actions still confirm:

- Delete attachment
- Remove version
- Void version
- Restore/rollback if it changes baseline state
- Clear or retry notification queue when destructive or bulk
- Abort Git sync

- [ ] **Step 7: Build**

Run:

```bash
cd web && npm run build
```

Expected: build passes.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "fix: polish responsive and accessible UI states"
```

## Task 12: Final Validation And Cleanup

**Files:**

- Modify: only files required by final validation.

- [ ] **Step 1: Run web build**

Run:

```bash
cd web && npm run build
```

Expected: build passes and emits `web/dist`.

- [ ] **Step 2: Run repository tests**

Run:

```bash
npm test
```

Expected: Node test suite passes. If tests fail due to unrelated pre-existing work, capture the failing test names and error messages before deciding whether the UI migration caused them.

- [ ] **Step 3: Run final AntD search**

Run:

```bash
rg -n "ant-design-vue|@ant-design/icons-vue|antdTheme|\\.ant-" web/src web/package.json DESIGN.md design-system/flowlark/MASTER.md
```

Expected: no results.

- [ ] **Step 4: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: changed files are limited to the UI migration scope and unrelated pre-existing work is not reverted.

- [ ] **Step 5: Commit final fixes**

If Step 1-4 required fixes:

```bash
git add web DESIGN.md design-system/flowlark/MASTER.md
git commit -m "chore: finalize Arco UI migration"
```

If there are no fixes, do not create an empty commit.

## Self-Review

Spec coverage:

- Full `web/src/views` and shared components are covered by Tasks 4-10.
- Arco migration is covered by Tasks 1-2 and verified in Task 10.
- Workflow console information architecture is covered by Tasks 3, 4, 6, 8, and 9.
- Accessibility and responsive requirements are covered by Task 11.
- Build and route validation are covered by Task 12.
- Backend, CLI, storage, route contracts, dark mode, and complex animation libraries remain out of scope.

Placeholder scan:

- No unresolved placeholder markers or open-ended implementation instructions are intentionally present.
- Steps include concrete commands, expected outcomes, and file paths.

Type and naming consistency:

- Feedback helper is consistently named `notify`.
- Confirmation helpers are consistently named `confirmAction` and `confirmDanger`.
- Layout primitives are consistently named `PageShell`, `StatusPill`, and `ResponsiveDataView`.
- Arco modal/drawer visibility uses `visible`; existing component public props can remain `open` through `@update:visible="$emit('update:open', $event)"`.
