# Prototype Entry Project Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the management-table project home with A2 prototype-entry cards that show each project's latest active version and open the prototype version manager as the primary action.

**Architecture:** Extend the existing project read model with a small `latestVersion` projection derived from the same version sorting and display rules used elsewhere. Render the project home as a responsive card grid; each card has one primary semantic button for navigation and a separate overflow action for editing, while the existing editor modal and filters remain reusable.

**Tech Stack:** Node.js ES modules, filesystem JSON storage, React 19, TypeScript/TSX, React Router 7, Ant Design 6, existing Flowlark CSS tokens, Node built-in tests, Vite 5, Python Playwright.

---

## Working-Tree Constraint

- Preserve all pre-existing dirty and untracked files.
- Stage only files named in each task.
- Never use broad `git add`, reset, checkout, or cleanup commands.
- Approved design: `docs/superpowers/specs/2026-08-26-prototype-entry-project-home-design.md`.

## File Map

Modify:

- `src/core/service.js`: derive `latestVersion` in the existing project detail projection.
- `test/projects.test.js`: cover newest non-void selection and no-active-version fallback.
- `test/project-edit-api.test.js`: assert the HTTP project list exposes the projection.
- `web/src/pages/Projects.tsx`: replace the table with A2 entry cards and retain the editor modal.
- `web/src/styles/global.css`: add the responsive card system and remove obsolete project-table-only rules.

### Task 1: Add Latest Active Version to Project Reads

**Files:**

- Modify: `src/core/service.js`
- Modify: `test/projects.test.js`
- Modify: `test/project-edit-api.test.js`

- [ ] **Step 1: Write failing project summary tests**

Append to `test/projects.test.js`:

```js
describe('项目最新原型摘要', () => {
  test('返回最新非废弃版本及统一展示状态', (t) => {
    const { hub, project } = fixture()
    hub.addVersion(project.slug, { versionNo: 'v1.0', title: '首版原型', html: html() })
    hub.setBaseline(project.slug, 'v1.0')
    hub.addVersion(project.slug, {
      versionNo: 'v2.0', title: '最新可用原型', html: html(),
      changes: [{ type: '修改', location: '项目首页', content: '更新入口' }]
    })
    hub.addVersion(project.slug, {
      versionNo: 'v3.0', title: '已废弃原型', html: html(),
      changes: [{ type: '修改', location: '项目首页', content: '废弃试验' }]
    })
    hub.voidVersion(project.slug, 'v3.0')

    const summary = hub.getProject(project.slug)
    t.assert.strictEqual(summary.versionCount, 3)
    t.assert.strictEqual(summary.baselineVersionNo, 'v1.0')
    t.assert.strictEqual(summary.latestVersion.versionNo, 'v2.0')
    t.assert.strictEqual(summary.latestVersion.title, '最新可用原型')
    t.assert.strictEqual(summary.latestVersion.display.key, 'DRAFT')
    t.assert.strictEqual(typeof summary.latestVersion.updatedAt, 'string')
  })

  test('只有废弃版本时 latestVersion 为 null', (t) => {
    const { hub, project } = fixture()
    hub.addVersion(project.slug, { versionNo: 'v1.0', title: '废弃原型', html: html() })
    hub.voidVersion(project.slug, 'v1.0')
    const summary = hub.getProject(project.slug)
    t.assert.strictEqual(summary.versionCount, 1)
    t.assert.strictEqual(summary.latestVersion, null)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
node --test test/projects.test.js
```

Expected: `latestVersion` is undefined.

- [ ] **Step 3: Derive the latest active version once per project read**

In `Hub.#projectDetail` in `src/core/service.js`, read and sort versions before returning:

```js
const orderedVersions = rules.sortVersions(nos.map((no) => store.readVersion(this.root, slug, no)))
const latest = orderedVersions.find((version) => version.status !== 'VOID') || null
```

Add this property to the returned project:

```js
latestVersion: latest ? {
  versionNo: latest.versionNo,
  title: latest.title,
  display: rules.displayStatus(latest, baselineNo),
  updatedAt: latest.updatedAt || latest.createdAt
} : null,
```

- [ ] **Step 4: Extend the HTTP contract test**

In the first test in `test/project-edit-api.test.js`, create a version before editing the project:

```js
result = await send('POST', '/api/projects/hyzl/versions', {
  versionNo: 'v1.0', title: 'API 原型版本', html: '<!doctype html><html><body>prototype</body></html>'
})
t.assert.strictEqual(result.status, 201)
```

After `GET /api/projects`, assert:

```js
t.assert.strictEqual(result.body[0].latestVersion.versionNo, 'v1.0')
t.assert.strictEqual(result.body[0].latestVersion.title, 'API 原型版本')
t.assert.strictEqual(result.body[0].latestVersion.display.key, 'DRAFT')
```

- [ ] **Step 5: Run focused backend tests**

```bash
node --test test/projects.test.js test/project-edit-api.test.js test/rules.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit the project read projection**

```bash
git add src/core/service.js test/projects.test.js test/project-edit-api.test.js
git diff --cached --check
git commit -m "feat: expose latest prototype per project"
```

### Task 2: Build the A2 Prototype Entry Cards

**Files:**

- Modify: `web/src/pages/Projects.tsx`
- Modify: `web/src/styles/global.css`

- [ ] **Step 1: Replace table imports with card-entry dependencies**

Use Ant Design `Dropdown`, `Badge`, `Button`, `Checkbox`, `Form`, `Input`, `Modal`, `Select`, `Space`, and `Tag`. Add `ArrowRightOutlined` and `MoreOutlined`; remove `Table`, `EyeOutlined`, and the priority filter state.

- [ ] **Step 2: Reframe the page header and filters**

Use:

```tsx
<PageHeader
  eyebrow="原型项目"
  title="选择项目，进入原型管理"
  description="查看最新原型版本，并进入项目版本工作区。"
  actions={<Button type="primary" icon={<PlusOutlined />} disabled={!writable} onClick={startCreate}>新建项目</Button>}
/>
```

Keep the name/code search and archive filter. Remove the priority filter and pass only `{ query, archived: archiveFilter }` to `filterProjects`.

- [ ] **Step 3: Replace the Table with semantic cards**

Render:

```tsx
<section className="fl-project-entry-grid" aria-label="原型项目列表">
  {filtered.map((item) => {
    const latest = item.latestVersion;
    return (
      <article className="fl-project-entry-card" key={item.slug}>
        <Dropdown
          trigger={['click']}
          menu={{ items: [{ key: 'edit', label: '编辑项目', icon: <EditOutlined /> }], onClick: () => startEdit(item) }}
        >
          <Button className="fl-project-entry-more" type="text" icon={<MoreOutlined />} disabled={!writable} aria-label={`更多项目操作：${item.name}`} />
        </Dropdown>
        <button
          className="fl-project-entry-main"
          type="button"
          aria-label={`进入 ${item.name} 的原型管理`}
          onClick={() => navigate(`/projects/${encodeURIComponent(item.slug)}`)}
        >
          <span className="fl-project-entry-head">
            <span className="fl-mono">{textOf(item.code, item.slug)}</span>
            <Badge status={item.archived ? 'default' : 'success'} text={item.archived ? '已归档' : '进行中'} />
          </span>
          <strong className="fl-project-entry-title">{item.name}</strong>
          {latest ? (
            <span className="fl-project-version-panel">
              <span className="fl-project-version-head">
                <strong className="fl-mono">{latest.versionNo}</strong>
                <Tag color={latest.display?.color}>{latest.display?.short || latest.display?.label}</Tag>
              </span>
              <span className="fl-project-version-title">{textOf(latest.title, '未命名版本')}</span>
              <span className="fl-project-version-time">更新于 {fmtTime(latest.updatedAt)}</span>
            </span>
          ) : (
            <span className="fl-project-version-panel is-empty">
              <strong>暂无可用原型版本</strong>
              <span>进入项目后创建首个版本</span>
            </span>
          )}
          <span className="fl-project-entry-footer">
            <span>{item.versionCount || 0} 个版本 · 基线 {textOf(item.baselineVersionNo, '未设置')}</span>
            <strong>进入原型管理 <ArrowRightOutlined /></strong>
          </span>
        </button>
      </article>
    );
  })}
</section>
```

If filters remove all rows, render an Ant Design `Empty` with “没有匹配的项目” instead of an empty grid.

- [ ] **Step 4: Add the responsive A2 card CSS**

Replace project-table-only styles with:

```css
.fl-project-filters { display:grid; grid-template-columns:minmax(280px,1fr) 160px; gap:var(--pw-space-12); }
.fl-project-entry-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:var(--pw-space-16); }
.fl-project-entry-card { position:relative; min-width:0; overflow:hidden; border:1px solid var(--pw-color-border); border-radius:var(--pw-radius-lg); background:var(--pw-color-surface-solid); box-shadow:var(--pw-shadow-xs); transition:border-color 180ms ease,box-shadow 180ms ease,transform 180ms ease; }
.fl-project-entry-card:hover { border-color:var(--fl-primary-border); box-shadow:var(--fl-shadow-2); transform:translateY(-2px); }
.fl-project-entry-main { display:flex; width:100%; min-height:260px; flex-direction:column; padding:var(--pw-space-20); border:0; background:transparent; color:inherit; text-align:left; cursor:pointer; }
.fl-project-entry-main:focus-visible { outline:2px solid var(--fl-primary); outline-offset:-3px; }
.fl-project-entry-more { position:absolute; z-index:2; top:var(--pw-space-12); right:var(--pw-space-12); }
.fl-project-entry-head { display:flex; min-width:0; align-items:center; justify-content:space-between; gap:var(--pw-space-8); padding-right:36px; color:var(--pw-color-text-secondary); font-size:var(--pw-font-size-12); }
.fl-project-entry-title { margin-top:var(--pw-space-12); color:var(--pw-color-text-primary); font-size:var(--pw-font-size-16); line-height:24px; }
.fl-project-version-panel { display:grid; gap:var(--pw-space-8); margin:var(--pw-space-16) 0; padding:var(--pw-space-16); border-radius:var(--pw-radius-md); background:var(--pw-color-surface-muted); }
.fl-project-version-panel.is-empty { align-content:center; min-height:112px; color:var(--pw-color-text-secondary); }
.fl-project-version-head,.fl-project-entry-footer { display:flex; min-width:0; align-items:center; justify-content:space-between; gap:var(--pw-space-8); }
.fl-project-version-head > strong { color:var(--pw-color-text-primary); font-size:var(--pw-font-size-20); }
.fl-project-version-title { overflow:hidden; color:var(--pw-color-text-primary); font-weight:650; text-overflow:ellipsis; white-space:nowrap; }
.fl-project-version-time { color:var(--pw-color-text-secondary); font-size:var(--pw-font-size-12); }
.fl-project-entry-footer { margin-top:auto; color:var(--pw-color-text-secondary); font-size:var(--pw-font-size-12); }
.fl-project-entry-footer > strong { display:inline-flex; align-items:center; gap:var(--pw-space-4); color:var(--pw-color-brand); }
```

At `max-width: 1439px` use two columns; at `max-width: 1023px` use one column. Existing mobile filter rules continue to collapse filters to one column.

- [ ] **Step 5: Run model tests and build**

```bash
node --test web/src/pages/projectsModel.test.js
npm run build:web
```

Expected: tests pass and Vite exits 0.

- [ ] **Step 6: Commit the entry-card home**

```bash
git add web/src/pages/Projects.tsx web/src/styles/global.css
git diff --cached --check
git commit -m "refactor: make projects a prototype entry home"
```

### Task 3: Full Regression and Browser Acceptance

**Files:**

- Verify only; modify only Task 1–2 files if a browser assertion proves a regression.

- [ ] **Step 1: Run all Node tests**

```bash
zsh -o pipefail -c 'node --test | tail -n 12'
```

Expected: zero failures.

- [ ] **Step 2: Build production assets**

```bash
npm run build:web
```

Expected: Vite exits 0 with only pre-existing non-blocking warnings.

- [ ] **Step 3: Verify card content and navigation in Chromium**

At 1440, 1024, 768, and 390px verify:

- grid column count is 3, 2, 1, 1;
- project management table headers are absent;
- every project displays code, status, latest version summary or empty-version copy, version total, baseline, and “进入原型管理”;
- clicking the card and pressing Enter navigate to `/projects/:slug`;
- the overflow button opens “编辑项目” without navigating;
- status filter and search still work;
- read-only mode leaves card navigation enabled but disables new/edit actions;
- page has no horizontal overflow, console errors, or page errors.

- [ ] **Step 4: Inspect final diff and preserve unrelated work**

```bash
git status --short
git diff --check HEAD~2..HEAD
```

Expected: only feature commits are new; pre-existing user changes remain unstaged.
