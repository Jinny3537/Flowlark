# Version Index Search-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project version index render and persist only text search while retaining the existing default newest-first ordering.

**Architecture:** Simplify `ProjectVersions` at the page-component boundary: remove non-search controls and their React/URL/preference state, call the existing model with only `query`, and rely on existing model and API defaults for newest-first ordering and excluding voided versions. Keep `projectVersionsModel` unchanged because other page logic still uses its generic ordering behavior.

**Tech Stack:** React 19, TypeScript, Ant Design 6, CSS Modules, Vite 5, Node.js test runner.

---

### Task 1: Record the pre-change verification baseline

**Files:**
- Test: `web/src/pages/projectVersionsModel.test.js`
- Verify: `web/src/pages/ProjectVersions.tsx`

- [ ] **Step 1: Run the focused model test before editing**

Run:

```bash
node --test web/src/pages/projectVersionsModel.test.js
```

Expected: all tests pass, including text search and default newest-first ordering.

- [ ] **Step 2: Run the current production build before editing**

Run:

```bash
npm run build --prefix web
```

Expected: Vite exits with status `0` and writes the current production bundle to `web/dist`.

### Task 2: Reduce ProjectVersions to query-only filtering

**Files:**
- Modify: `web/src/pages/ProjectVersions.tsx:1-148`
- Modify: `web/src/pages/ProjectVersions.tsx:206-304`

- [ ] **Step 1: Remove Ant Design and icon imports used only by deleted controls**

Change the component imports so the relevant sections contain:

```tsx
import {
  App,
  Alert,
  Button,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
```

and remove `FilterOutlined` from the `@ant-design/icons` import. Keep all other icon imports unchanged.

- [ ] **Step 2: Replace non-search filter state with one query initializer**

Replace the filter-state block with:

```tsx
const [query, setQuery] = useState(() => projectFilterState(searchParams).query);
const [filtersHydrated, setFiltersHydrated] = useState(false);
```

This removes `initialFilters`, `includeVoid`, `statusFilter`, `sortOrder`, `authorFilter`, `requirementFilter`, `externalOnly`, and `advancedFiltersOpen`.

- [ ] **Step 3: Filter with the search query only**

Replace the `filteredVersions` and `statusOptions` blocks with:

```tsx
const filteredVersions = useMemo(
  () => filterVersions(versions, { query }),
  [query, versions],
);
```

Do not modify `filterVersions`; its default `order = 'newest'` remains the source of ordering behavior.

- [ ] **Step 4: Stop requesting voided versions**

Change the list request and callback dependency list to:

```tsx
api.listVersions(slug, { includeDraft: true }),
```

```tsx
}, [selectVersion, slug]);
```

This uses the API default that excludes voided versions.

- [ ] **Step 5: Hydrate and persist only the search query**

Use this body for `apply` in the project-change hydration effect:

```tsx
const apply = (value: any) => {
  if (cancelled) return;
  setQuery(projectFilterState(value).query);
  setFiltersHydrated(true);
};
```

Use this state and dependency list in the URL/preference synchronization effect:

```tsx
const state = { query };
const nextQuery = projectFilterQuery(state);
if (nextQuery !== searchParams.toString()) setSearchParams(nextQuery, { replace: true });
const timer = window.setTimeout(() => {
  void api.setProjectPreference(slug, state).catch(() => undefined);
}, 350);
return () => window.clearTimeout(timer);
```

```tsx
}, [filtersHydrated, query, searchParams, setSearchParams, slug]);
```

Expected behavior: old filter parameters are ignored and removed on synchronization, while `q` remains shareable and persisted.

### Task 3: Remove all non-search controls and orphaned styles

**Files:**
- Modify: `web/src/pages/ProjectVersions.tsx:837-918`
- Modify: `web/src/pages/ProjectVersions.module.css:32-43`
- Modify: `web/src/pages/ProjectVersions.module.css:101-112`

- [ ] **Step 1: Remove the voided-version checkbox from the empty state**

The empty state must end immediately after the create button:

```tsx
<Button
  type="primary"
  icon={<PlusOutlined />}
  disabled={!canWrite}
  onClick={() => setNewVersionOpen(true)}
>
  创建首个版本
</Button>
```

- [ ] **Step 2: Leave only the search input in the index toolbar**

Replace the contents of `styles.indexToolbar` with:

```tsx
<Input
  allowClear
  aria-label="搜索版本"
  placeholder="搜索版本、标题、标签或需求"
  prefix={<SearchOutlined />}
  value={query}
  onChange={(event) => setQuery(event.target.value)}
/>
```

Remove the status select, order select, void checkbox, advanced-filter button, and conditional advanced-filter panel.

- [ ] **Step 3: Delete CSS that belonged only to removed controls**

Delete these complete rules:

```css
.pageEmpty :global(.ant-checkbox-wrapper) { margin-top: var(--fl-s-3); }
.indexFilters { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--fl-s-2); margin-top: var(--fl-s-2); }
.indexOptions { display: flex; align-items: center; justify-content: space-between; gap: var(--fl-s-2); margin-top: var(--fl-s-2); color: var(--fl-text-2); font-size: var(--fl-fs-2); }
.advancedFilters { display: grid; gap: var(--fl-s-2); margin-top: var(--fl-s-2); padding: var(--fl-s-2); border: 1px solid var(--fl-line); border-radius: var(--fl-r-2); background: color-mix(in srgb, var(--fl-surface) 86%, var(--fl-primary-bg)); }
```

Also delete the `.indexFilters` and `.indexOptions` declarations from the `max-width: 480px` media query.

- [ ] **Step 4: Confirm removed symbols have no page references**

Run:

```bash
rg -n 'Checkbox|Select|FilterOutlined|includeVoid|statusFilter|sortOrder|authorFilter|requirementFilter|externalOnly|advancedFiltersOpen|indexFilters|indexOptions|advancedFilters' web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
```

Expected: no output and exit status `1` because none of the removed symbols remain.

### Task 4: Verify and commit the implementation

**Files:**
- Verify: `web/src/pages/ProjectVersions.tsx`
- Verify: `web/src/pages/ProjectVersions.module.css`
- Test: `web/src/pages/projectVersionsModel.test.js`

- [ ] **Step 1: Run whitespace validation**

Run:

```bash
git diff --check -- web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
```

Expected: no output and exit status `0`.

- [ ] **Step 2: Run the focused model test**

Run:

```bash
node --test web/src/pages/projectVersionsModel.test.js
```

Expected: all tests pass, confirming text search and default newest-first ordering remain intact.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build --prefix web
```

Expected: Vite exits with status `0` and reports a successful production build.

- [ ] **Step 4: Review the scoped diff**

Run:

```bash
git diff -- web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
```

Expected: every changed line removes a non-search control, its state/data flow, or its orphaned style; no `VersionWorkbench` file appears.

- [ ] **Step 5: Commit only the implementation files**

Run:

```bash
git add web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
git commit -m "feat: simplify version index search"
```

Expected: the commit contains exactly the two implementation files and leaves unrelated working-tree changes untouched.
