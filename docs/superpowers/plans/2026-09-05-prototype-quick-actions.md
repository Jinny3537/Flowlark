# Prototype Quick Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the three frequent prototype actions from the version-page overflow menu into the always-visible prototype preview toolbar.

**Architecture:** `VersionWorkbench` remains responsible for URLs, browser actions, and copy feedback. `PrototypeStage` receives three callbacks and renders the corresponding Ant Design buttons, keeping the child component presentation-only.

**Tech Stack:** React 19, TypeScript/TSX, Ant Design 6, Vite 5

---

### Task 1: Add visible actions to the preview stage

**Files:**
- Modify: `web/src/pages/workbench/PrototypeStage.tsx:1-235`

- [x] **Step 1: Extend the icon imports**

Add `DownloadOutlined`, `ExportOutlined`, and `LinkOutlined` to the existing `@ant-design/icons` import.

- [x] **Step 2: Extend the component contract**

Add these callbacks to `PrototypeStageProps` and the component destructuring:

```tsx
onCopyPreviewLink: () => void;
onOpenPreview: () => void;
onDownloadPrototype: () => void;
```

- [x] **Step 3: Render the three actions**

Insert these buttons at the start of `layout.actions`, before the existing offline-preview control:

```tsx
<Tooltip title="复制可直接访问当前原型的预览地址">
  <Button size="small" icon={<LinkOutlined />} onClick={onCopyPreviewLink}>
    复制预览直链
  </Button>
</Tooltip>
<Tooltip title="在新的浏览器窗口打开当前原型">
  <Button size="small" icon={<ExportOutlined />} onClick={onOpenPreview}>
    新窗口打开
  </Button>
</Tooltip>
<Tooltip title="下载当前版本的原型文件">
  <Button size="small" icon={<DownloadOutlined />} onClick={onDownloadPrototype}>
    下载原型
  </Button>
</Tooltip>
```

Expected: all three actions are rendered as native buttons with visible labels and reuse the toolbar's existing wrapping behavior.

### Task 2: Wire page behavior and remove the overflow menu

**Files:**
- Modify: `web/src/pages/VersionWorkbench.tsx:1-510`

- [x] **Step 1: Remove obsolete imports**

Remove `DownloadOutlined`, `ExportOutlined`, `LinkOutlined`, and `MoreOutlined` from the icon import. Remove `Dropdown` from the Ant Design import.

- [x] **Step 2: Remove the old menu**

Delete the `Dropdown` containing `link`, `window`, and `download`, including the `aria-label="更多版本操作"` trigger.

- [x] **Step 3: Pass the existing behaviors to the preview stage**

Add these props to the existing `PrototypeStage` call:

```tsx
onCopyPreviewLink={() => void copyPreviewLink()}
onOpenPreview={() => window.open(previewBase, '_blank', 'noopener,noreferrer')}
onDownloadPrototype={() => window.open(api.downloadUrl(slug, versionNo), '_blank', 'noopener,noreferrer')}
```

Expected: the old overflow trigger disappears; each new preview-toolbar button invokes the same behavior as its former menu item.

### Task 3: Verify the focused change

**Files:**
- Verify: `web/src/pages/VersionWorkbench.tsx`
- Verify: `web/src/pages/workbench/PrototypeStage.tsx`

- [x] **Step 1: Run the production build**

Run: `npm run build --prefix web`

Expected: Vite exits with code 0 and writes the production bundle.

- [x] **Step 2: Check removal and placement**

Run:

```bash
rg -n "更多版本操作|复制预览直链|新窗口打开|下载原型" web/src/pages/VersionWorkbench.tsx web/src/pages/workbench/PrototypeStage.tsx
```

Expected: `更多版本操作` is absent; the three labels occur in `PrototypeStage.tsx`.

- [x] **Step 3: Check diff scope**

Run:

```bash
git diff --check -- web/src/pages/VersionWorkbench.tsx web/src/pages/workbench/PrototypeStage.tsx
git diff --stat -- web/src/pages/VersionWorkbench.tsx web/src/pages/workbench/PrototypeStage.tsx
```

Expected: no whitespace errors; only the two planned source files are included.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add web/src/pages/VersionWorkbench.tsx web/src/pages/workbench/PrototypeStage.tsx docs/superpowers/plans/2026-09-05-prototype-quick-actions.md
git commit -m "feat: surface prototype quick actions"
```
