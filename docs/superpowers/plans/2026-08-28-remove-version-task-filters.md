# Remove Version Task Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the project-version task filter buttons and every corresponding frontend state, URL, preference, filtering, style, and test path while preserving the other version filters and summary information.

**Architecture:** Delete the `task` dimension at the pure model boundary first so URL and preference normalization no longer carry it. Then simplify `ProjectVersions` to use only the remaining filters, render review counts as read-only tags, retain the watch navigation button, and remove the obsolete button-row CSS.

**Tech Stack:** React 19, TypeScript/TSX, Ant Design 6, CSS Modules, Node.js built-in test runner, Vite 5.

---

## File map

- Modify `web/src/pages/projectVersionsModel.test.js`: replace task-filter coverage with compatibility coverage proving old `task` input is ignored.
- Modify `web/src/pages/projectVersionsModel.js`: remove task matching and task query/preference normalization.
- Modify `web/src/pages/ProjectVersions.tsx`: remove task state and controls; make review summary badges read-only.
- Modify `web/src/pages/ProjectVersions.module.css`: remove styles used only by the deleted task-filter row.

### Task 1: Remove the task dimension from the filter model

**Files:**
- Modify: `web/src/pages/projectVersionsModel.test.js:48-57`
- Modify: `web/src/pages/projectVersionsModel.test.js:129-140`
- Modify: `web/src/pages/projectVersionsModel.js:35-42`
- Modify: `web/src/pages/projectVersionsModel.js:55-68`
- Modify: `web/src/pages/projectVersionsModel.js:101-135`

- [ ] **Step 1: Replace task-filter tests with legacy-input compatibility coverage**

Delete the test named `filters review tasks independently from lifecycle`. Replace the query serialization test with this exact version:

```js
test('serializes supported filters and ignores the removed task dimension', () => {
  const query = projectFilterQuery({
    query: 'REQ-3', task: 'pending', status: 'DRAFT', order: 'oldest',
    author: 'Jinny', requirement: 'REQ', external: true, includeVoid: true,
  })
  assert.equal(query, 'q=REQ-3&status=DRAFT&order=oldest&author=Jinny&requirement=REQ&external=1&void=1')
  assert.deepEqual(projectFilterState(new URLSearchParams(`${query}&task=pending`)), {
    query: 'REQ-3', status: 'DRAFT', order: 'oldest',
    author: 'Jinny', requirement: 'REQ', external: true, includeVoid: true,
  })
  assert.equal(projectFilterQuery(projectFilterState(new URLSearchParams(''))), '')
})
```

- [ ] **Step 2: Run the focused test and confirm it fails before the model change**

Run:

```bash
node --test web/src/pages/projectVersionsModel.test.js
```

Expected: FAIL in `serializes supported filters and ignores the removed task dimension` because the current implementation still emits `task=pending` and returns a `task` property.

- [ ] **Step 3: Remove task matching from `filterVersions`**

Delete the entire `matchesTask` function. Replace `filterVersions` with:

```js
export function filterVersions(versions, {
  query = '', status = 'all', order = 'newest', author = '', requirement = '', external = false,
} = {}) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase()
  const normalizedAuthor = String(author).trim().toLocaleLowerCase()
  const normalizedRequirement = String(requirement).trim().toLocaleLowerCase()
  const filtered = versions.filter((version) => {
    const matchesQuery = !normalizedQuery || searchableText(version).includes(normalizedQuery)
    const matchesStatus = status === 'all' || version.display?.key === status
    const authors = `${version.createdBy || ''} ${version.updatedBy || ''}`.toLocaleLowerCase()
    const matchesAuthor = !normalizedAuthor || authors.includes(normalizedAuthor)
    const matchesRequirement = !normalizedRequirement || requirementText(version).includes(normalizedRequirement)
    const matchesExternal = !external || (version.externalRefs || []).length > 0
    return matchesQuery && matchesStatus && matchesAuthor && matchesRequirement && matchesExternal
  })

  const direction = order === 'oldest' ? -1 : 1
  return filtered.sort((a, b) => direction * compareNewest(a, b))
}
```

- [ ] **Step 4: Remove task normalization and serialization**

Delete the `TASKS` constant. Replace `projectFilterState` and `projectFilterQuery` with:

```js
export function projectFilterState(params, fallback = {}) {
  const get = (key) => {
    if (typeof params?.get === 'function') return params.get(key)
    if (key === 'q') return params?.q ?? params?.query
    if (key === 'void') return params?.void ?? params?.includeVoid
    return params?.[key]
  }
  const rawExternal = get('external') ?? fallback.external
  const rawVoid = get('void') ?? fallback.includeVoid
  return {
    query: String(get('q') || fallback.query || ''),
    status: String(get('status') || fallback.status || 'all'),
    order: String(get('order') || fallback.order || 'newest') === 'oldest' ? 'oldest' : 'newest',
    author: String(get('author') || fallback.author || ''),
    requirement: String(get('requirement') || fallback.requirement || ''),
    external: rawExternal === true || String(rawExternal || '') === '1',
    includeVoid: rawVoid === true || String(rawVoid || '') === '1',
  }
}

export function projectFilterQuery(input = {}) {
  const state = projectFilterState(input)
  const params = new URLSearchParams()
  if (state.query) params.set('q', state.query)
  if (state.status !== 'all') params.set('status', state.status)
  if (state.order !== 'newest') params.set('order', state.order)
  if (state.author) params.set('author', state.author)
  if (state.requirement) params.set('requirement', state.requirement)
  if (state.external) params.set('external', '1')
  if (state.includeVoid) params.set('void', '1')
  return params.toString()
}
```

- [ ] **Step 5: Run the focused model tests**

Run:

```bash
node --test web/src/pages/projectVersionsModel.test.js
```

Expected: all tests in `projectVersionsModel.test.js` PASS.

- [ ] **Step 6: Commit the model change only**

```bash
git add web/src/pages/projectVersionsModel.js web/src/pages/projectVersionsModel.test.js
git commit -m "refactor: remove version task filter model"
```

### Task 2: Remove the task controls and React state

**Files:**
- Modify: `web/src/pages/ProjectVersions.tsx:84-138`
- Modify: `web/src/pages/ProjectVersions.tsx:258-307`
- Modify: `web/src/pages/ProjectVersions.tsx:537-544`
- Modify: `web/src/pages/ProjectVersions.tsx:757-771`
- Modify: `web/src/pages/ProjectVersions.tsx:850-870`
- Modify: `web/src/pages/ProjectVersions.module.css:31-32`

- [ ] **Step 1: Remove `taskFilter` from component state and filtering**

Delete this state declaration:

```tsx
const [taskFilter, setTaskFilter] = useState(initialFilters.current.task);
```

Replace the `filteredVersions` memo with:

```tsx
const filteredVersions = useMemo(
  () => filterVersions(versions, {
    query,
    status: statusFilter,
    order: sortOrder,
    author: authorFilter,
    requirement: requirementFilter,
    external: externalOnly,
  }),
  [authorFilter, externalOnly, query, requirementFilter, sortOrder, statusFilter, versions],
);
```

- [ ] **Step 2: Remove task hydration, URL/preference sync, and reset state**

In the filter hydration effect, delete:

```tsx
setTaskFilter(next.task);
```

Use this exact preference/query state object:

```tsx
const state = {
  query,
  status: statusFilter,
  order: sortOrder,
  author: authorFilter,
  requirement: requirementFilter,
  external: externalOnly,
  includeVoid,
};
```

Replace the URL/preference effect dependency list with:

```tsx
[
  authorFilter, externalOnly, filtersHydrated, includeVoid, query, requirementFilter,
  searchParams, setSearchParams, slug, sortOrder, statusFilter,
]
```

Delete this line from `clearFilters`:

```tsx
setTaskFilter('all');
```

- [ ] **Step 3: Preserve review counts as read-only tags and the watch badge as a link**

Replace the `commandBadges.map` body with:

```tsx
{commandBadges.map((badge) => badge.key === 'watch' ? (
  <Button
    key={badge.key}
    size="small"
    onClick={() => navigate(`/watch?project=${encodeURIComponent(slug)}`)}
  >
    <Tag color={badge.color}>{badge.label}</Tag>
  </Button>
) : (
  <Tag key={badge.key} color={badge.color}>{badge.label}</Tag>
))}
```

This keeps pending/question counts visible without retaining any path that filters the version list.

- [ ] **Step 4: Delete the task-filter button row and its CSS**

Delete the entire JSX block beginning with:

```tsx
<div className={styles.taskFilters} aria-label="版本任务筛选">
```

and ending at its matching `</div>` after the five mapped buttons.

Delete these CSS rules:

```css
.taskFilters { display: flex; gap: var(--fl-s-1); margin-top: var(--fl-s-2); overflow-x: auto; padding-bottom: 2px; }
.taskFilters :global(.ant-btn) { flex: none; }
```

- [ ] **Step 5: Prove there are no component or style references left**

Run:

```bash
rg -n "taskFilter|setTaskFilter|taskFilters" web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
```

Expected: no output and exit status 1.

- [ ] **Step 6: Build the frontend**

Run:

```bash
npm --prefix web run build
```

Expected: Vite reports a successful production build with no TypeScript/JSX or CSS-module errors.

- [ ] **Step 7: Commit the UI change only**

```bash
git add web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
git commit -m "refactor: remove version task filter controls"
```

### Task 3: Run final regression checks

**Files:**
- Verify: `web/src/pages/projectVersionsModel.test.js`
- Verify: `web/src/pages/ProjectVersions.tsx`
- Verify: `web/src/pages/ProjectVersions.module.css`

- [ ] **Step 1: Run the focused model suite again**

```bash
node --test web/src/pages/projectVersionsModel.test.js
```

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run the production build again**

```bash
npm --prefix web run build
```

Expected: successful Vite production build.

- [ ] **Step 3: Check the exact removed surface**

```bash
rg -n "版本任务筛选|taskFilter|setTaskFilter|taskFilters|task=pending|params\.set\('task'" web/src/pages
```

Expected: no output and exit status 1. References in historical design or plan documents are outside this check and remain unchanged.

- [ ] **Step 4: Check patch hygiene without disturbing existing user changes**

```bash
git diff --check HEAD~2..HEAD
git status --short
```

Expected: `git diff --check` has no output. `git status --short` may still show the pre-existing `AppShell.tsx`, `NotFound.tsx`, `.codex-ui-regression/`, and `test-results/` changes, but none of the four implementation files should remain modified.
