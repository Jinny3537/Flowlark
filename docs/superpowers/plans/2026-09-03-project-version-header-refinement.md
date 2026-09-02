# Project Version Header Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project versions page's detached back button and metadata card with a compact breadcrumb-style context row and a single project-name heading.

**Architecture:** Keep the change page-scoped so other consumers of `PageHeader` are unaffected. Render the context navigation directly in `ProjectVersions`, remove the redundant project summary markup, and use the existing CSS Module for desktop and narrow-screen layout; do not change routes, data loading, permissions, or version actions.

**Tech Stack:** React 19, React Router 7, Ant Design 6, TypeScript/TSX, CSS Modules, Vite 5, Playwright for local visual verification.

---

## File Map

| File | Responsibility |
|---|---|
| `web/src/pages/ProjectVersions.tsx` | Render the page-scoped context navigation, project heading, and existing actions; remove the project summary card. |
| `web/src/pages/ProjectVersions.module.css` | Style the context navigation and remove obsolete summary-card desktop and responsive rules. |

No shared component, model, service, route, or persisted data file changes in this plan.

## Task 1: Establish the Structural Failure Baseline

**Files:**

- Inspect: `web/src/pages/ProjectVersions.tsx:1-32`
- Inspect: `web/src/pages/ProjectVersions.tsx:674-715`
- Inspect: `web/src/pages/ProjectVersions.module.css:1-9`

- [ ] **Step 1: Verify the target page does not yet contain the approved navigation structure**

Run:

```bash
node --input-type=module -e "import fs from 'node:fs'; const source=fs.readFileSync('web/src/pages/ProjectVersions.tsx','utf8'); if (!source.includes('aria-label=\"页面路径\"')) throw new Error('approved page context navigation is missing')"
```

Expected: FAIL with `approved page context navigation is missing`.

- [ ] **Step 2: Record the redundant structure that must disappear**

Run:

```bash
rg -n 'eyebrow="项目版本"|backTo="/projects"|aria-label="项目摘要"|className=\{styles\.projectMeta\}' web/src/pages/ProjectVersions.tsx
```

Expected: matches for the detached back/eyebrow configuration and project summary section.

## Task 2: Implement the Page-Scoped Header Hierarchy

**Files:**

- Modify: `web/src/pages/ProjectVersions.tsx:15-32`
- Modify: `web/src/pages/ProjectVersions.tsx:674-715`
- Modify: `web/src/pages/ProjectVersions.module.css:1-9`
- Modify: `web/src/pages/ProjectVersions.module.css:142-162`

- [ ] **Step 1: Add the back-arrow icon import**

Add `ArrowLeftOutlined` beside the existing `ArrowRightOutlined` import:

```tsx
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CopyOutlined,
  DownloadOutlined,
  DownOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FilterOutlined,
  HistoryOutlined,
  InboxOutlined,
  LinkOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  UndoOutlined,
} from '@ant-design/icons';
```

- [ ] **Step 2: Add the breadcrumb-style context row before `PageHeader`**

Insert the following page-scoped navigation immediately inside `<main>`:

```tsx
<nav className={styles.projectContext} aria-label="页面路径">
  <Button
    className={styles.projectBack}
    type="link"
    icon={<ArrowLeftOutlined />}
    onClick={() => navigate('/projects')}
  >
    项目列表
  </Button>
  <span className={styles.contextSeparator} aria-hidden="true">/</span>
  <span className={styles.contextCurrent} aria-current="page">项目版本</span>
</nav>
```

Keep the existing `navigate('/projects')` destination semantics. Do not use `location.replace`, and do not alter browser history behavior.

- [ ] **Step 3: Reduce `PageHeader` to the project name and existing actions**

Remove the `eyebrow`, generic description, and `backTo` props. Keep the existing title fallback and actions unchanged:

```tsx
<PageHeader
  title={project?.name || slug}
  actions={(
    <Space wrap className={styles.summaryActions}>
      <Button
        icon={<InboxOutlined />}
        onClick={() => navigate(`/watch?project=${encodeURIComponent(slug)}`)}
      >
        草稿箱{planning?.watchCount ? ` ${planning.watchCount}` : ''}
      </Button>
      <Button
        icon={<PlusOutlined />}
        disabled={!canWrite}
        onClick={() => setNewVersionOpen(true)}
      >
        新建版本
      </Button>
      {continuation.latest ? (
        <Button
          type="primary"
          icon={<ArrowRightOutlined />}
          onClick={() => openWorkbench(versionNoOf(continuation.latest))}
        >
          继续处理最新版本
        </Button>
      ) : null}
    </Space>
  )}
/>
```

- [ ] **Step 4: Remove the complete project summary section**

Delete the `<section className={styles.projectMeta} aria-label="项目摘要">` block and all five of its fields. Do not remove `projectContinuation`; it still drives the latest-version primary action and downstream baseline behavior.

- [ ] **Step 5: Replace obsolete summary styles with page-context styles**

At the top of `ProjectVersions.module.css`, keep the page and action rules, remove every `.projectMeta` rule, and add:

```css
.projectContext {
  display: flex;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  gap: var(--fl-s-2);
  color: var(--fl-text-3);
  font-size: var(--fl-fs-2);
}
.projectBack { height: 44px; padding: 0; color: var(--fl-text-2); }
.projectBack:hover { color: var(--fl-primary-deep); }
.contextSeparator { color: var(--fl-line); }
.contextCurrent { color: var(--fl-primary-deep); font-weight: 650; }
```

Remove the `.projectMeta` rules from the `899px`, `768px`, and `480px` media queries. Preserve all unrelated responsive rules.

- [ ] **Step 6: Verify the approved structure and removed metadata**

Run:

```bash
node --input-type=module -e "import fs from 'node:fs'; const source=fs.readFileSync('web/src/pages/ProjectVersions.tsx','utf8'); const required=['aria-label=\"页面路径\"','项目列表','aria-current=\"page\"']; const forbidden=['eyebrow=\"项目版本\"','backTo=\"/projects\"','aria-label=\"项目摘要\"','styles.projectMeta']; for (const item of required) if (!source.includes(item)) throw new Error('missing '+item); for (const item of forbidden) if (source.includes(item)) throw new Error('still present '+item);"
```

Expected: exits with status 0 and no output.

- [ ] **Step 7: Verify CSS and production compilation**

Run:

```bash
rg -n 'projectMeta' web/src/pages/ProjectVersions.module.css
npm run build --prefix web
```

Expected: `rg` returns no matches; Vite reports a successful production build.

## Task 3: Verify Desktop and Narrow-Screen Behavior

**Files:**

- Verify: `web/src/pages/ProjectVersions.tsx`
- Verify: `web/src/pages/ProjectVersions.module.css`

- [ ] **Step 1: Start the existing local application**

Run the repository's existing start command in a persistent terminal:

```bash
npm start
```

Expected: the Flowlark server starts and prints a local application URL.

- [ ] **Step 2: Inspect the project versions page at a desktop viewport**

Use Playwright at `1440x900` to open an available `/projects/:slug` route and assert:

```js
await page.getByRole('navigation', { name: '页面路径' }).waitFor();
await page.getByRole('button', { name: /项目列表/ }).waitFor();
await page.getByRole('heading', { level: 1 }).waitFor();
if (await page.getByLabel('项目摘要').count()) throw new Error('project summary still rendered');
```

Expected: the context row appears above the single project-name `h1`, actions remain aligned on the right, the baseline strip directly follows the header, and there is no project summary card.

- [ ] **Step 3: Inspect the same page at a narrow viewport**

Set the viewport to `390x844`, reload the page, and verify:

```js
const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
if (bodyWidth > viewportWidth) throw new Error(`horizontal overflow: ${bodyWidth} > ${viewportWidth}`);
const backBox = await page.getByRole('button', { name: /项目列表/ }).boundingBox();
if (!backBox || backBox.height < 44) throw new Error('back target is smaller than 44px');
```

Expected: no horizontal overflow; long project names wrap without covering actions; action buttons wrap below the title; the return target remains at least 44 pixels high.

- [ ] **Step 4: Check interaction behavior**

Click the “项目列表” control and assert the URL ends in `/projects`. Return to the project page and verify the existing 草稿箱、新建版本、继续处理最新版本 controls still render according to current data and permission state.

- [ ] **Step 5: Review the final diff and commit only scoped files**

Run:

```bash
git diff --check -- web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
git diff -- web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
git status --short
```

Expected: every changed line traces to the approved header refinement; unrelated `VersionWorkbench` and local regression artifacts remain untouched and unstaged.

Commit only the two implementation files:

```bash
git add -- web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
git commit -m "feat: refine project version header"
```
