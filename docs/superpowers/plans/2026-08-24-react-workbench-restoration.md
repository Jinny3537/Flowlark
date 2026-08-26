# React Project Workbench Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore every user-visible workflow from the Vue project-version workbench and comparison route in the active React frontend.

**Architecture:** Keep `VersionWorkbench.tsx` as the route coordinator and move independent UI/API workflows into focused components under `web/src/pages/workbench/`. Keep comparison in its own route with a tested pure model. Reuse the existing preview server and HTTP APIs; do not change repository storage or backend lifecycle rules.

**Tech Stack:** React 19, React Router 7, Ant Design 6, Vite 5, CSS Modules, Node built-in test runner, existing Flowlark HTTP API and preview server.

---

## Working-Tree Constraint

The repository already contains user changes and an untracked React migration. Preserve every unrelated change. Stage only the files listed by each task, inspect `git diff --cached --name-only`, and do not use broad commands such as `git add .`.

## File Map

Create:

- `web/src/pages/workbench/workbenchModel.js`: deterministic workbench rules, preview URL construction, anchor encoding, change grouping, and feedback filtering.
- `web/src/pages/workbench/workbenchModel.test.js`: dependency-free unit coverage for the workbench model.
- `web/src/pages/workbench/WorkbenchPrimitives.tsx`: change list/editor, requirement editor, review status, baseline dialog, and attachments.
- `web/src/pages/workbench/AnnotationOverlay.tsx`: pointer-based normalized region selection.
- `web/src/pages/workbench/FeedbackDrawer.tsx`: feedback form and optional tab-capture workflow.
- `web/src/pages/workbench/PrototypeStage.tsx`: sandboxed preview, offline state, annotation state, online edit bridge, collapse, and split controls.
- `web/src/pages/workbench/PrototypeEditorDrawer.tsx`: source/file/URL HTML replacement workflow.
- `web/src/pages/workbench/WorkbenchDocuments.tsx`: specification, changes, requirements, attachments, version information, and feedback tabs.
- `web/src/pages/workbench/WorkbenchDrawers.tsx`: version history and feedback-list actions that do not belong to a document tab.
- `web/src/pages/workbench/VersionWorkbench.module.css`: full-height workbench, split stage, document panels, drawers, and responsive behavior.
- `web/src/pages/compareModel.js`: deterministic comparison defaults, ordering, URL validation, and query serialization.
- `web/src/pages/compareModel.test.js`: dependency-free comparison-model tests.
- `web/src/pages/Compare.module.css`: full-height dual-frame comparison layout and mobile stacking.

Modify:

- `web/src/pages/VersionWorkbench.tsx`: replace the read-only tab page with the complete workbench coordinator.
- `web/src/pages/Compare.tsx`: replace metadata cards with real version/system iframe comparison.
- `web/src/services/api.ts`: complete health response typing only; all required endpoint methods already exist.
- `web/src/utils/format.ts`: add byte-size and absolute-time helpers used by React workbench components.
- `.codex-ui-regression/ui-regression.spec.js`: add workbench and comparison layout assertions if the existing fixture can create a project version; otherwise perform the same checks through a temporary Playwright script without persisting generated data.

Do not modify the Vue components. They remain the migration reference until React parity is verified.

### Task 1: Add Tested Workbench Rules

**Files:**

- Create: `web/src/pages/workbench/workbenchModel.test.js`
- Create: `web/src/pages/workbench/workbenchModel.js`
- Modify: `web/src/services/api.ts:8-19`
- Modify: `web/src/utils/format.ts:1-12`

- [ ] **Step 1: Write the failing model tests**

Create `web/src/pages/workbench/workbenchModel.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  baselineBlocked,
  canEditStructure,
  decodeAnchor,
  encodeAnchor,
  filterVersionFeedback,
  groupChanges,
  olderSiblings,
  previewUrl,
  requirementUrl
} from './workbenchModel.js'

const versions = [
  { versionNo: 'v3', display: { key: 'DRAFT' } },
  { versionNo: 'v2', display: { key: 'HISTORY' } },
  { versionNo: 'v1', display: { key: 'HISTORY' } }
]

test('builds encoded preview URLs and mutually exclusive modes', () => {
  const base = { protocol: 'http:', hostname: '127.0.0.1', previewPort: 7789, slug: '订单 原型', versionNo: 'v1.0' }
  assert.equal(previewUrl(base), 'http://127.0.0.1:7789/p/%E8%AE%A2%E5%8D%95%20%E5%8E%9F%E5%9E%8B/v1.0')
  assert.equal(previewUrl({ ...base, offline: true }), `${previewUrl(base)}?offline=1`)
  assert.equal(previewUrl({ ...base, edit: true }), `${previewUrl(base)}?edit=1`)
})

test('enforces draft structural editing and baseline rules', () => {
  assert.equal(canEditStructure({ canWrite: true, version: versions[0] }), true)
  assert.equal(canEditStructure({ canWrite: false, version: versions[0] }), false)
  assert.equal(canEditStructure({ canWrite: true, version: versions[1] }), false)
  assert.equal(baselineBlocked({ target: { changeCount: 0 }, totalVersions: 2 }), true)
  assert.equal(baselineBlocked({ target: { changeCount: 0, baselineAt: '2026-08-01' }, totalVersions: 2 }), false)
  assert.equal(baselineBlocked({ target: { changeCount: 0 }, totalVersions: 1 }), false)
})

test('returns only siblings older than the selected version', () => {
  assert.deepEqual(olderSiblings(versions, 'v2').map(item => item.versionNo), ['v1'])
  assert.deepEqual(olderSiblings(versions, 'missing'), [])
})

test('groups changes in ADD MODIFY REMOVE order', () => {
  const groups = groupChanges([
    { type: 'REMOVE', content: 'c' },
    { type: 'ADD', content: 'a' },
    { type: 'MODIFY', content: 'b' }
  ])
  assert.deepEqual(groups.map(group => group.type), ['ADD', 'MODIFY', 'REMOVE'])
  assert.equal(groups[0].meta.label, '新增')
})

test('filters feedback and resolves requirement links', () => {
  const feedback = [
    { id: '1', project: 'orders', version: 'v2' },
    { id: '2', project: 'orders', version: 'v1' },
    { id: '3', project: 'account', version: 'v2' }
  ]
  assert.deepEqual(filterVersionFeedback(feedback, 'orders', 'v2').map(item => item.id), ['1'])
  assert.equal(requirementUrl('REQ 1', '', 'https://req.local/{code}'), 'https://req.local/REQ%201')
  assert.equal(requirementUrl('REQ-1', 'https://custom/1', 'https://req.local/{code}'), 'https://custom/1')
})

test('round-trips unicode annotation anchors', () => {
  const anchor = { x: 0.1, y: 0.2, width: 0.3, height: 0.4, label: '顶部' }
  assert.deepEqual(decodeAnchor(encodeAnchor(anchor)), anchor)
  assert.equal(decodeAnchor('invalid'), null)
})
```

- [ ] **Step 2: Run the model test and verify failure**

Run:

```bash
node --test web/src/pages/workbench/workbenchModel.test.js
```

Expected: failure with `ERR_MODULE_NOT_FOUND` for `workbenchModel.js`.

- [ ] **Step 3: Implement the model exactly once**

Create `web/src/pages/workbench/workbenchModel.js`:

```js
export const CHANGE_META = {
  ADD: { label: '新增', color: 'success' },
  MODIFY: { label: '修改', color: 'warning' },
  REMOVE: { label: '删除', color: 'error' }
}

export function previewUrl({ protocol, hostname, previewPort, slug, versionNo, offline = false, edit = false }) {
  const base = `${protocol}//${hostname}:${previewPort}/p/${encodeURIComponent(slug)}/${encodeURIComponent(versionNo)}`
  const params = new URLSearchParams()
  if (offline) params.set('offline', '1')
  if (edit) params.set('edit', '1')
  return params.size ? `${base}?${params}` : base
}

export function canEditStructure({ canWrite, version }) {
  return Boolean(canWrite && version && version.display && version.display.key === 'DRAFT')
}

export function baselineBlocked({ target, totalVersions }) {
  return Boolean(target && Number(target.changeCount || target.changes?.length || 0) === 0 && totalVersions > 1 && !target.baselineAt)
}

export function olderSiblings(versions, versionNo) {
  const index = versions.findIndex(item => item.versionNo === versionNo)
  return index < 0 ? [] : versions.slice(index + 1)
}

export function groupChanges(items = []) {
  return ['ADD', 'MODIFY', 'REMOVE']
    .map(type => ({ type, meta: CHANGE_META[type], items: items.filter(item => item.type === type) }))
    .filter(group => group.items.length)
}

export function filterVersionFeedback(items = [], project, version) {
  return items.filter(item => item.project === project && item.version === version)
}

export function requirementUrl(code, fallback, template) {
  if (fallback) return fallback
  return template ? template.replace('{code}', encodeURIComponent(code)) : ''
}

export function encodeAnchor(anchor) {
  const bytes = new TextEncoder().encode(JSON.stringify(anchor))
  let raw = ''
  for (const byte of bytes) raw += String.fromCharCode(byte)
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function decodeAnchor(value) {
  if (!value) return null
  try {
    const normalized = String(value).replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const raw = atob(padded)
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, char => char.charCodeAt(0))))
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Complete shared React types and format helpers**

Extend `HealthInfo` in `web/src/services/api.ts` with the fields consumed by the workbench:

```ts
defaultTags?: string[];
updateManifestUrl?: string;
mirror?: boolean;
rules?: { requireChangelog?: boolean; lockBaseline?: boolean };
```

Append these exports to `web/src/utils/format.ts`:

```ts
export function fmtAbsolute(value?: string | number | Date | null) {
  return fmtTime(value);
}

export function fmtSize(bytes?: number | null) {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
```

- [ ] **Step 5: Run focused tests and build**

Run:

```bash
node --test web/src/pages/workbench/workbenchModel.test.js
cd web && npm run build
```

Expected: six model tests pass and Vite exits with code 0.

- [ ] **Step 6: Commit the tested foundation**

Stage only:

```bash
git add web/src/pages/workbench/workbenchModel.js web/src/pages/workbench/workbenchModel.test.js web/src/services/api.ts web/src/utils/format.ts
git diff --cached --check
git commit -m "test: define React workbench rules"
```

### Task 2: Restore Shared Workbench Primitives

**Files:**

- Create: `web/src/pages/workbench/WorkbenchPrimitives.tsx`

- [ ] **Step 1: Add change rendering and editing**

Export `ChangeList` and `ChangeEditor` with these contracts:

```tsx
export type ChangeItem = {
  type?: string;
  location?: string;
  content?: string;
  requirement?: string;
  fromVersionNo?: string;
};

export function ChangeList({ items = [], locationCounts = {}, showHot = false, onOpenRequirement }: {
  items?: ChangeItem[];
  locationCounts?: Record<string, number>;
  showHot?: boolean;
  onOpenRequirement?: (code: string) => void;
})

export function ChangeEditor({ value, onChange }: {
  value: ChangeItem[];
  onChange: (value: ChangeItem[]) => void;
})
```

`ChangeList` must call `groupChanges(items)`, render Ant Design `Tag` labels for ADD/MODIFY/REMOVE, display location and content, expose requirement codes as buttons, show `fromVersionNo`, and show `该区域在所选区间内被修改了 N 次` when `showHot` is true and the normalized location count exceeds two.

`ChangeEditor` must render one row per value with:

```tsx
<Select options={[
  { value: 'ADD', label: '新增' },
  { value: 'MODIFY', label: '修改' },
  { value: 'REMOVE', label: '删除' },
]} />
<Input placeholder="位置（选填）" maxLength={50} />
<Input placeholder="改了什么，一句话说清" maxLength={200} />
<Input placeholder="需求号" maxLength={40} />
<Button type="text" danger icon={<CloseOutlined />} aria-label="删除这条变更" />
```

The dashed add button appends `{ type: 'MODIFY', location: '', content: '', requirement: '' }` without mutating the input array.

- [ ] **Step 2: Add requirement editing**

Export:

```tsx
export type RequirementLink = { code?: string; title?: string; url?: string };

export function RequirementEditor({ value, onChange }: {
  value: RequirementLink[];
  onChange: (value: RequirementLink[]) => void;
})
```

Each row uses inputs with placeholders `REQ-2026-0311`, `需求标题（选填）`, and `https://需求池地址`; the delete button is icon-only with `aria-label="删除这条关联需求"`; the add button appends `{ code: '', title: '', url: '' }` immutably.

- [ ] **Step 3: Add review and baseline controls**

Export `ReviewStatusControl` and `BaselineModal`. `ReviewStatusControl` uses these exact options and calls `api.setReviewStatus`:

```ts
const reviewOptions = [
  { value: 'pending', label: '待评审' },
  { value: 'confirmed', label: '已确认' },
  { value: 'questions', label: '有疑问' },
];
```

Disable review changes when the workbench is read-only or status is `obsolete`. On success, show `审阅状态已更新` and pass the returned version to `onChanged`.

`BaselineModal` receives `{ open, slug, target, current, totalVersions, onClose, onDone }`, derives its blocked state with `baselineBlocked`, shows the current and target version, explains structural locking, disables confirmation when blocked, calls `api.setBaseline`, and shows `当前基线：<versionNo>`.

- [ ] **Step 4: Add attachment management**

Export `AttachmentsPanel` with `{ slug, versionNo, attachments, canWrite, maxFileBytes, onChanged }`. Use Ant Design `Upload` with `beforeUpload`, reject files larger than `maxFileBytes`, and call `api.addAttachment` with the raw `File`. Render file type through Ant Design file icons rather than emoji. Open and download with `api.attachmentUrl`; disable both for missing files. Confirm deletion through `modal.confirm`, call `api.removeAttachment`, then `onChanged`.

- [ ] **Step 5: Build and commit**

Run `cd web && npm run build`.

Expected: Vite exits with code 0 and no unused imports.

Stage and commit only:

```bash
git add web/src/pages/workbench/WorkbenchPrimitives.tsx
git diff --cached --check
git commit -m "feat: restore workbench editing primitives"
```

### Task 3: Restore Annotation Feedback

**Files:**

- Create: `web/src/pages/workbench/AnnotationOverlay.tsx`
- Create: `web/src/pages/workbench/FeedbackDrawer.tsx`

- [ ] **Step 1: Port normalized pointer selection**

Create `AnnotationOverlay.tsx` with this public shape:

```tsx
export type Anchor = { x: number; y: number; width: number; height: number };

export function AnnotationOverlay({ active, anchor, onSelect, onCancel }: {
  active: boolean;
  anchor: Anchor | null;
  onSelect: (anchor: Anchor) => void;
  onCancel: () => void;
})
```

The overlay must:

- Normalize pointer coordinates against `event.currentTarget.getBoundingClientRect()` and clamp every coordinate to `0..1`.
- Capture the primary pointer on pointer-down.
- Draw the rectangle from the minimum x/y and absolute width/height while dragging.
- Ignore selections narrower or shorter than `0.01`.
- Call `onCancel` for Escape and pointer cancellation.
- Use `role="application"`, `tabIndex={0}`, and `aria-label="原型标注区域"`.
- Render the persisted `anchor` when annotation mode is inactive.

- [ ] **Step 2: Port feedback creation and screenshot capture**

Create `FeedbackDrawer.tsx` with:

```tsx
type FeedbackContext = {
  project: string;
  version: string;
  baseline: string | null;
  requirements: string[];
  changes: Array<Record<string, unknown>>;
  anchor: Anchor;
  url: string;
};

export function FeedbackDrawer({ open, context, captureRect, onClose, onSubmitted }: {
  open: boolean;
  context: FeedbackContext;
  captureRect: DOMRect | null;
  onClose: () => void;
  onSubmitted: () => Promise<void> | void;
})
```

Use labeled title and description fields with limits 200 and 5000. The screenshot action calls `navigator.mediaDevices.getDisplayMedia`, draws only `captureRect` into a canvas using the captured video-to-window scale, stores the PNG payload after the comma, and always stops every stream track in `finally`. Unsupported capture or denied permission shows `未截取截图，仍可继续提交反馈`.

Submission requires trimmed title and description and calls:

```ts
await api.createFeedbackDraft({
  ...context,
  title: title.trim(),
  description: description.trim(),
  screenshotBase64: screenshotBase64 || undefined,
});
```

On success, show `反馈已保存`, call `onSubmitted`, and close. On failure, keep all form data.

- [ ] **Step 3: Build and commit**

Run `cd web && npm run build`.

Stage and commit only:

```bash
git add web/src/pages/workbench/AnnotationOverlay.tsx web/src/pages/workbench/FeedbackDrawer.tsx
git diff --cached --check
git commit -m "feat: restore prototype annotation feedback"
```

### Task 4: Restore the Prototype Stage and HTML Editor

**Files:**

- Create: `web/src/pages/workbench/PrototypeStage.tsx`
- Create: `web/src/pages/workbench/PrototypeEditorDrawer.tsx`

- [ ] **Step 1: Create the preview-stage imperative bridge**

Export this handle and component:

```tsx
export type PrototypeStageHandle = {
  readEditedHtml: () => Promise<string>;
};

export type PrototypeStageProps = {
  version: any;
  previewSrc: string;
  editPreviewSrc: string;
  editable: boolean;
  docsCollapsed: boolean;
  useOffline: boolean;
  annotationMode: boolean;
  prototypeEditMode: boolean;
  selectedAnchor: Anchor | null;
  buildingOffline: boolean;
  htmlSaving: boolean;
  onOfflineChange: (value: boolean) => void;
  onToggleAnnotation: () => void;
  onTogglePrototypeEdit: () => void;
  onSavePrototypeEdit: () => void;
  onOpenHtmlEditor: () => void;
  onToggleDocs: () => void;
  onBuildOffline: () => void;
  onSelectAnchor: (anchor: Anchor, rect: DOMRect) => void;
  onCancelAnnotation: () => void;
};
```

Export the component with `forwardRef<PrototypeStageHandle, PrototypeStageProps>`. Inside `readEditedHtml`, create a unique message id, listen only for a response whose `event.source` is the current iframe window and whose `{ type, id }` equals `{ type: 'flowlark:edit-html', id }`, and remove the listener on success or after 3000 ms. Send `{ type: 'flowlark:get-edit-html', id }` to the iframe. Reject timeout with `EDIT_HTML_TIMEOUT`.

Render the iframe with:

```tsx
<iframe
  ref={frameRef}
  title="原型预览"
  src={prototypeEditMode ? editPreviewSrc : previewSrc}
  sandbox="allow-scripts allow-forms allow-popups allow-modals"
  referrerPolicy="no-referrer"
/>
```

The toolbar includes offline preview, sandbox explanation, annotation, online edit, save while editing, HTML replacement, and preview/document collapse. The dependency alert lists external references and exposes offline generation when no offline file exists. The annotation callback converts the selected normalized anchor into a viewport `DOMRect` before calling `onSelectAnchor`.

- [ ] **Step 2: Create the source/file/URL drawer**

`PrototypeEditorDrawer` receives `{ open, slug, versionNo, editable, hasOffline, maxFileBytes, onClose, onSaved }`. On open, load `api.getHtml` and inspect it through `api.inspectHtml`. Maintain exact modes `code`, `file`, and `url` in an Ant Design segmented control.

File mode accepts `.html,.htm`, rejects invalid extension and oversized files, reads with `FileReader.readAsText`, and inspects the result. URL mode requires non-empty input and calls `api.importUrl`; copy `result.html` and `result.externalRefs` into the draft state. Code mode exposes dependency inspection.

Save is exactly:

```ts
if (!editable) return message.info('当前版本不可修改原型文件');
if (!htmlDraft.trim()) return message.warning('请先提供原型 HTML');
setSaving(true);
try {
  const nextVersion = await api.replaceHtml(slug, versionNo, htmlDraft);
  message.success('原型文件已保存，预览已刷新');
  await onSaved(nextVersion);
  onClose();
} finally {
  setSaving(false);
}
```

A failed load or save keeps the drawer open and keeps the last available draft.

- [ ] **Step 3: Build and commit**

Run `cd web && npm run build`.

Stage and commit only:

```bash
git add web/src/pages/workbench/PrototypeStage.tsx web/src/pages/workbench/PrototypeEditorDrawer.tsx
git diff --cached --check
git commit -m "feat: restore prototype preview and editing"
```

### Task 5: Restore the Document Pane

**Files:**

- Create: `web/src/pages/workbench/WorkbenchDocuments.tsx`

- [ ] **Step 1: Define the document-pane contract**

Export:

```tsx
export function WorkbenchDocuments({
  activeTab,
  onTabChange,
  slug,
  versionNo,
  version,
  siblings,
  canWrite,
  maxFileBytes,
  requirementUrlTemplate,
  allTags,
  specCommits,
  feedbacks,
  onVersionChanged,
  onSpecHistoryChanged,
  onTagsChanged,
  onFeedbackChanged,
}: {
  activeTab: string;
  onTabChange: (key: string) => void;
  slug: string;
  versionNo: string;
  version: any;
  siblings: any[];
  canWrite: boolean;
  maxFileBytes: number;
  requirementUrlTemplate: string;
  allTags: any[];
  specCommits: any[];
  feedbacks: any[];
  onVersionChanged: (version?: any) => Promise<void>;
  onSpecHistoryChanged: () => Promise<void>;
  onTagsChanged: () => Promise<void>;
  onFeedbackChanged: () => Promise<void>;
})
```

Render six Ant Design tab items in this order: `spec`, `changes`, `reqs`, `files`, `info`, `feedback`.

- [ ] **Step 2: Implement specification viewing and editing**

Maintain `specEditing`, `specDraft`, `specRef`, `specAtContent`, `saving`, and `importingSpec`. Render Markdown with `DOMPurify.sanitize(marked.parse(markdown, { gfm: true, breaks: true }))`.

Historical selection calls `api.specAt(slug, versionNo, ref)` and clearly labels the content as non-current. Starting edit resets historical selection. Saving calls `api.setSpec`, refreshes version and specification history, and closes edit mode only after success.

The template inserted by `编写模板` must contain the accepted six sections: background/goal, requirements, functional rules, data/API, acceptance criteria, and risks. Existing non-empty draft content requires `modal.confirm` before replacement.

Markdown import accepts `.md,.markdown,.txt`, enforces `maxFileBytes`, reads as text, and either fills the active draft or immediately saves with `api.setSpec` when not already editing.

- [ ] **Step 3: Implement changes and requirements**

Changes initialize their comparison start from the first `olderSiblings(siblings, versionNo)` entry. When no start is selected, show `version.changes`; otherwise call `api.cumulative(slug, from, versionNo)` and use `items` plus `locationCounts`.

Draft-only change editing uses `ChangeEditor`. Save exactly the entries satisfying `item.content?.trim()` through `api.setChanges`, then refresh both version and cumulative data.

Requirements render code, title, and the result of `requirementUrl(code, item.url, requirementUrlTemplate)`. Draft-only editing uses `RequirementEditor`. Save exactly the entries satisfying `item.code?.trim()` through `api.setRequirements`.

- [ ] **Step 4: Implement files, information, and feedback**

Files render `AttachmentsPanel` and refresh only current version after mutations.

Version information uses one-column bordered descriptions for version number, title, display status, tags, file, repository path, source, external dependencies, creation, first baseline time, and preview link. Tags use `mode="tags"`, call `api.setTags`, then refresh version and all tag options.

Feedback uses `filterVersionFeedback(feedbacks, slug, versionNo)`. Each item shows title, description, creation time, requirements, screenshot link, annotation deep link, submission, and confirmed deletion through `api.removeFeedbackDraft`.

The submit action calls `api.submitFeedback(item.id, {})` so the configured default issue provider remains the backend authority. If the result contains `url`, show `反馈已提交` and open that URL in a new window. If the result contains Markdown fallback content, copy `result.markdown` to the clipboard and show `未配置问题平台，反馈 Markdown 已复制`. A failed submission leaves the draft in the list.

- [ ] **Step 5: Build and commit**

Run `cd web && npm run build`.

Stage and commit only:

```bash
git add web/src/pages/workbench/WorkbenchDocuments.tsx
git diff --cached --check
git commit -m "feat: restore workbench document panels"
```

### Task 6: Integrate the Complete Version Workbench

**Files:**

- Create: `web/src/pages/workbench/WorkbenchDrawers.tsx`
- Create: `web/src/pages/workbench/VersionWorkbench.module.css`
- Modify: `web/src/pages/VersionWorkbench.tsx:1-88`

- [ ] **Step 1: Add version history presentation**

Export `VersionHistoryDrawer` from `WorkbenchDrawers.tsx`. It receives `{ open, commits, loading, onClose }`, shows `还没有 Git 提交记录` when empty, and otherwise renders a Timeline with subject, short hash, author, formatted date, and kind tags. Keep the feedback creation drawer in `FeedbackDrawer.tsx`; do not duplicate it here.

- [ ] **Step 2: Replace the read-only route coordinator**

Replace the `@umijs/max` route import with `useNavigate`, `useParams`, and `useSearchParams` from `react-router-dom`. `VersionWorkbench.tsx` must load these core resources in one guarded request:

```ts
const requestId = ++requestIdRef.current;
const [nextProject, nextVersion, nextSiblings, nextHealth] = await Promise.all([
  api.getProject(slug),
  api.getVersion(slug, versionNo),
  api.listVersions(slug, { includeDraft: true, includeVoid: true }),
  api.health(),
]);
if (requestId !== requestIdRef.current) return;
```

After core success, initialize version drafts and independently load:

```ts
const loadSupplementary = async () => {
  const [nextHistory, nextSpecHistory, nextTags, nextFeedback] = await Promise.all([
    api.versionHistory(slug, versionNo).catch(() => []),
    api.specHistory(slug, versionNo).catch(() => []),
    api.allTags().catch(() => []),
    api.listFeedbackDrafts().catch(() => []),
  ]);
  if (requestId !== requestIdRef.current) return;
  setCommits(nextHistory as any[]);
  setSpecCommits(nextSpecHistory as any[]);
  setAllTags(nextTags as any[]);
  setFeedbacks(nextFeedback as any[]);
};
```

On route changes, increment the request id, reset editing/drawer/annotation state, and start the new load. Do not let supplementary errors replace the core page.

- [ ] **Step 3: Implement toolbar actions and version switching**

The version selector navigates to `/projects/<slug>/versions/<versionNo>`. Toolbar buttons open history, navigate to comparison with `a=current&b=first-other`, copy the preview URL, open preview, download HTML, and open baseline confirmation. Include `ReviewStatusControl` next to the display status.

Use `navigator.clipboard.writeText(previewSrc)` with success and failure messages. Use `window.open(url, '_blank', 'noopener,noreferrer')` for preview/download links.

- [ ] **Step 4: Wire preview, editors, documents, and dialogs**

Derive:

```ts
const editable = canEditStructure({ canWrite, version });
const previewSrc = previewUrl({
  protocol: window.location.protocol,
  hostname: window.location.hostname,
  previewPort: health?.previewPort || 7789,
  slug,
  versionNo,
  offline: useOffline,
});
const editPreviewSrc = previewUrl({
  protocol: window.location.protocol,
  hostname: window.location.hostname,
  previewPort: health?.previewPort || 7789,
  slug,
  versionNo,
  edit: true,
});
```

Online save calls `stageRef.current.readEditedHtml()`, then `api.replaceHtml`, exits edit mode only after success, resets offline selection, increments an iframe reload key, and refreshes current version. Bridge failure shows `读取在线编辑内容失败，请重试` and keeps edit mode active.

Offline generation calls `api.buildOffline`, reports failed-resource count or inlined/total counts, refreshes current version, and enables offline preview.

Annotation selection stores the anchor and computed capture rectangle, creates a deep link with `anchor=<encodedAnchor>`, and opens `FeedbackDrawer`. Parse the initial anchor query with `decodeAnchor`.

Render `PrototypeEditorDrawer`, `BaselineModal`, `FeedbackDrawer`, and `VersionHistoryDrawer` at route level.

Keep split state in the route coordinator:

```ts
const DEFAULT_SPLIT = 68;
const [leftPct, setLeftPct] = useState(() => Number(localStorage.getItem('flowlark.split')) || DEFAULT_SPLIT);
const [dragging, setDragging] = useState(false);
const workspaceRef = useRef<HTMLDivElement>(null);

const moveSplit = useCallback((clientX: number) => {
  const rect = workspaceRef.current?.getBoundingClientRect();
  if (!rect) return;
  setLeftPct(Math.max(30, Math.min(88, ((clientX - rect.left) / rect.width) * 100)));
}, []);
```

Register window pointer-move/up listeners only while dragging, remove them in effect cleanup, persist the rounded percentage on pointer-up, and reset to 68 on divider double-click. The preview pane receives `style={{ width: docsCollapsed ? undefined : `${leftPct}%` }}`. At narrow width, ignore the persisted split and control pane visibility with a local `preview`/`documents` segmented state.

- [ ] **Step 5: Add full-height and responsive CSS**

`VersionWorkbench.module.css` must establish:

```css
.page {
  display: flex;
  min-width: 0;
  height: calc(100dvh - 64px);
  flex-direction: column;
  overflow: hidden;
  background: var(--fl-bg);
}

.stage { display: flex; min-height: 0; flex: 1; }
.previewPane { display: flex; min-width: 0; flex-direction: column; }
.documentPane { display: flex; min-width: 340px; flex: 1; flex-direction: column; background: var(--fl-surface); }
.splitter { width: 7px; flex: 0 0 7px; cursor: col-resize; background: var(--pw-color-gray-200); }
.previewCanvas { position: relative; display: flex; min-height: 0; flex: 1; overflow: hidden; }
.previewFrame { display: block; width: 100%; height: 100%; border: 0; }
.panelBody { min-height: 0; flex: 1; overflow-y: auto; padding: var(--fl-s-5); }
```

At `max-width: 899px`, set page height to `calc(100dvh - 60px)`, hide the splitter, make the stage single-column, and use an explicit segmented preview/document mode so only one pane occupies the available height. Ensure every toolbar can wrap or horizontally scroll without widening the page.

- [ ] **Step 6: Build and commit**

Run `cd web && npm run build`.

Stage and commit only:

```bash
git add web/src/pages/VersionWorkbench.tsx web/src/pages/workbench/WorkbenchDrawers.tsx web/src/pages/workbench/VersionWorkbench.module.css
git diff --cached --check
git commit -m "feat: restore React version workbench"
```

### Task 7: Add Tested Comparison Rules

**Files:**

- Create: `web/src/pages/compareModel.test.js`
- Create: `web/src/pages/compareModel.js`

- [ ] **Step 1: Write failing comparison tests**

Create `web/src/pages/compareModel.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { comparisonDefaults, comparisonQuery, normalizeSystemUrl, orderedRange } from './compareModel.js'

const versions = [{ versionNo: 'v3' }, { versionNo: 'v2' }, { versionNo: 'v1' }]

test('prefers baseline and a different comparison version', () => {
  assert.deepEqual(comparisonDefaults(versions, 'v2', '', ''), { a: 'v2', b: 'v3' })
  assert.deepEqual(comparisonDefaults(versions, '', 'v1', ''), { a: 'v1', b: 'v3' })
})

test('orders ranges using the project version list', () => {
  assert.deepEqual(orderedRange(versions, 'v3', 'v1'), { older: 'v1', newer: 'v3' })
  assert.deepEqual(orderedRange(versions, 'v1', 'v3'), { older: 'v1', newer: 'v3' })
})

test('normalizes only http and https system URLs', () => {
  assert.equal(normalizeSystemUrl('example.com/app', 'http:'), 'http://example.com/app')
  assert.equal(normalizeSystemUrl('https://example.com/app', 'http:'), 'https://example.com/app')
  assert.equal(normalizeSystemUrl('javascript:alert(1)', 'http:'), '')
  assert.equal(normalizeSystemUrl('not a host', 'http:'), '')
})

test('serializes the active comparison state', () => {
  assert.equal(comparisonQuery({ mode: 'versions', a: 'v2', b: 'v3', systemUrl: '', showChanges: true }), 'mode=versions&a=v2&b=v3')
  assert.equal(comparisonQuery({ mode: 'system', a: 'v2', b: '', systemUrl: 'https://example.com/', showChanges: false }), 'mode=system&a=v2&url=https%3A%2F%2Fexample.com%2F&changes=0')
})
```

- [ ] **Step 2: Verify failure and implement**

Run `node --test web/src/pages/compareModel.test.js` and expect `ERR_MODULE_NOT_FOUND`.

Create `compareModel.js`:

```js
export function comparisonDefaults(versions, baseline, a, b) {
  const left = a || baseline || versions[0]?.versionNo || ''
  const right = b || versions.find(item => item.versionNo !== left)?.versionNo || left
  return { a: left, b: right }
}

export function orderedRange(versions, a, b) {
  const ia = versions.findIndex(item => item.versionNo === a)
  const ib = versions.findIndex(item => item.versionNo === b)
  if (ia < 0 || ib < 0) return { older: a, newer: b }
  return ia > ib ? { older: a, newer: b } : { older: b, newer: a }
}

export function normalizeSystemUrl(value, protocol) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const input = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${protocol}//${raw}`
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || /\s/.test(url.hostname)) return ''
    return url.href
  } catch {
    return ''
  }
}

export function comparisonQuery({ mode, a, b, systemUrl, showChanges }) {
  const params = new URLSearchParams({ mode })
  if (a) params.set('a', a)
  if (mode === 'versions' && b) params.set('b', b)
  if (mode === 'system' && systemUrl) params.set('url', systemUrl)
  if (!showChanges) params.set('changes', '0')
  return params.toString()
}
```

- [ ] **Step 3: Run tests and commit**

Run `node --test web/src/pages/compareModel.test.js`.

Expected: four tests pass.

Stage and commit only:

```bash
git add web/src/pages/compareModel.js web/src/pages/compareModel.test.js
git diff --cached --check
git commit -m "test: define React comparison rules"
```

### Task 8: Restore Real Prototype Comparison

**Files:**

- Modify: `web/src/pages/Compare.tsx:1-185`
- Create: `web/src/pages/Compare.module.css`

- [ ] **Step 1: Replace metadata cards with route state and real frames**

Initialize `mode`, `a`, `b`, `systemUrlInput`, `systemUrl`, `showChanges`, and `syncScroll` from search parameters. Load project, versions, and health. Apply `comparisonDefaults(versions, project.baselineVersionNo, a, b)`, then load selected version details and cumulative changes using `orderedRange`.

Every state-changing action must replace the current query with:

```ts
setParams(comparisonQuery({ mode, a, b, systemUrl, showChanges }), { replace: true });
```

Use a request identifier so older version-detail requests cannot replace newer selections.

- [ ] **Step 2: Build the full comparison toolbar and summary**

The toolbar includes back, title, segmented `原型对比`/`业务系统`, synchronized viewport checkbox, swap in version mode, and show/hide explanation. The summary strip displays left version, span/change count, cumulative/requirement count, and right version or system readiness. Warn on identical versions and explain business-system embedding restrictions.

- [ ] **Step 3: Render both preview panes**

Build prototype iframe sources with `previewUrl` and the health `previewPort`. Prototype frames use the same sandbox and referrer policy as the workbench. System mode validates input with `normalizeSystemUrl`; invalid input shows `请输入合法的 HTTP 或 HTTPS 地址` and does not update the active frame.

Each pane includes status text, selector/input, file metadata, open-in-new-window, and download where applicable. Use icon buttons with `aria-label` and tooltips.

Synchronized viewport behavior mirrors only `scrollLeft` between the two outer scroll containers and uses `requestAnimationFrame` to release a synchronization guard. Do not attempt cross-origin iframe-document scrolling.

- [ ] **Step 4: Restore the explanation panel and deep link**

Version mode shows cumulative changes and location hotspot counts. System mode shows the selected prototype's own changes and the CSP/X-Frame-Options warning. Copy link after synchronizing the query and report clipboard success or failure.

- [ ] **Step 5: Add responsive comparison CSS**

`Compare.module.css` must use a `calc(100dvh - 64px)` full-height page, two equal `minmax(0, 1fr)` frame panes, and an optional 340-pixel explanation column. Frames fill their available pane with stable dimensions.

At `max-width: 899px`, switch the stage and explanation to document flow, stack both frames, give each frame at least 420 pixels height, allow the page to scroll vertically, and prevent page-level horizontal overflow.

- [ ] **Step 6: Build and commit**

Run `cd web && npm run build`.

Stage and commit only:

```bash
git add web/src/pages/Compare.tsx web/src/pages/Compare.module.css
git diff --cached --check
git commit -m "feat: restore side-by-side prototype comparison"
```

### Task 9: Verify Full Functional Parity

**Files:**

- Modify: `.codex-ui-regression/ui-regression.spec.js` only when its fixture supports isolated temporary data.

- [ ] **Step 1: Run all deterministic tests**

Run:

```bash
node --test web/src/pages/workbench/workbenchModel.test.js web/src/pages/compareModel.test.js web/src/pages/projectVersionsModel.test.js
npm test
```

Expected: all focused model tests pass; the root suite reports zero failures.

- [ ] **Step 2: Run the production build**

Run:

```bash
cd web && npm run build
```

Expected: Vite exits with code 0 and generates `web/dist`.

- [ ] **Step 3: Start the local service without replacing an occupied port**

Read the current thread terminal first. If no Flowlark service is running, start:

```bash
npm run serve -- --port 7798 --preview-port 7799
```

Expected: the service reports both workbench and preview URLs. Keep the session alive through browser verification and stop only the service started by this task.

- [ ] **Step 4: Verify desktop workbench behavior**

At 1280x900 and 1440x900 verify:

- Core load, sibling switching, review status, history, comparison navigation, link copying, new-window preview, download, and baseline dialog.
- Split drag, double-click reset, document collapse, all six tabs, and no layout jump while supplementary data loads.
- Online edit save, source edit, file import, URL import, dependency inspection, and iframe refresh.
- Specification edit/import/history, cumulative changes, draft change editing, requirement editing, attachment upload/delete, tags, feedback creation/list/delete, and offline generation.
- Read-only controls are disabled; baseline/history/void controls show readable state labels.

Record console errors and take screenshots after the final stable state.

- [ ] **Step 5: Verify desktop comparison behavior**

At 1440x900 verify both iframe panes are nonblank, selectors work, swap works, query parameters update, horizontal outer-scroll synchronization works, the explanation panel toggles, cumulative changes render, system URL validation rejects non-HTTP protocols, and the new-window fallback remains visible.

- [ ] **Step 6: Verify narrow-screen behavior**

At 390x844 verify the workbench preview/document switch, toolbar reachability, drawers, text wrapping, and absence of horizontal overflow. Verify comparison panes stack vertically and each remains usable.

Run canvas/iframe visibility checks by asserting each frame's bounding box is nonzero and sampling screenshots to confirm the frame region is not entirely the surrounding background color.

- [ ] **Step 7: Add stable regression assertions**

When the existing regression fixture can create and clean isolated data, add assertions for:

```js
await expect(page.locator('iframe[title="原型预览"]')).toBeVisible();
await expect(page.getByRole('tab', { name: /规格书/ })).toBeVisible();
await expect(page.getByRole('button', { name: /并排对比/ })).toBeVisible();
expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
```

For comparison, assert two visible preview regions in version mode and one prototype plus one system region in system mode. If fixture isolation is unavailable, keep these checks in the temporary verification script and do not commit environment-specific test data.

- [ ] **Step 8: Run final clean verification and inspect the diff**

Run:

```bash
git diff --check
cd web && npm run build
cd .. && npm test
git status --short
```

Expected: no whitespace errors, build success, zero test failures, and only intended user changes plus workbench migration files in status.

- [ ] **Step 9: Commit only durable regression coverage**

If `.codex-ui-regression/ui-regression.spec.js` was changed with repository-independent assertions:

```bash
git add .codex-ui-regression/ui-regression.spec.js
git diff --cached --check
git commit -m "test: cover React workbench workflows"
```

If no durable test file changed, skip this commit and record the browser verification results in the final handoff.
