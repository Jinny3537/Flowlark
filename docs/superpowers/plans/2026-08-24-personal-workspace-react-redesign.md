# Flowlark Personal Workspace React Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved soft, balanced personal-workspace visual system to every migrated React page without changing backend contracts.

**Architecture:** Keep React 19, Vite, React Router and Ant Design 6. Add a responsive shared application shell and semantic workspace components, map `--pw-*` design tokens through the existing `--fl-*` compatibility layer, and restyle page compositions with CSS classes rather than introducing a second component framework.

**Tech Stack:** React 19, TypeScript/TSX, Ant Design 6, React Router 7, Vite 5, CSS custom properties, Node test runner, Playwright.

---

### Task 1: Establish the current regression baseline

**Files:**
- Test: `web/src/pages/projectVersionsModel.test.js`
- Inspect: `web/src/main.tsx`
- Inspect: `web/src/pages/ProjectVersions.tsx`

- [ ] **Step 1: Run the existing version model tests**

```bash
cd web && node --test src/pages/projectVersionsModel.test.js
```

Expected: all seven model tests pass.

- [ ] **Step 2: Run the current production build**

```bash
cd web && npm run build
```

Expected before implementation: fail if `src/pages/ProjectVersions.tsx` is still missing; record any additional errors as migration regressions to fix in Task 4.

### Task 2: Implement the token system and responsive application shell

**Files:**
- Create: `web/src/components/AppShell.tsx`
- Modify: `web/src/main.tsx`
- Modify: `web/src/styles/global.css`

- [ ] **Step 1: Create the responsive shell component**

Implement `AppShell` with:

```tsx
type AppShellProps = { children: ReactNode };

export function AppShell({ children }: AppShellProps) {
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;
  return (
    <Layout className="fl-app-shell">
      {mobile ? <Drawer className="fl-mobile-nav" /> : <Sider width={240} />}
      <Layout>
        <Header className="fl-app-header" />
        <Content className="fl-app-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
```

The real implementation must preserve all eight existing routes, active navigation state, the Flowlark brand, current workspace context and an accessible mobile menu button. Auxiliary navigation is visually separated from core workflow navigation.

- [ ] **Step 2: Map the personal-workspace tokens**

Define the complete approved primitive and semantic values in `global.css` and map compatibility variables:

```css
:root {
  --pw-color-page: #f7f9f8;
  --pw-color-surface-solid: #fff;
  --pw-color-brand: #328d61;
  --pw-color-text-primary: #151b18;
  --pw-color-border: rgba(21, 27, 24, .08);
  --pw-radius-md: 8px;
  --pw-radius-lg: 12px;
  --pw-shadow-sm: 0 4px 12px rgba(17, 24, 20, .06);
  --fl-primary: var(--pw-color-brand);
  --fl-bg: var(--pw-color-page);
  --fl-surface: var(--pw-color-surface-solid);
}
```

Add stable shell dimensions, maximum content width, Ant Design component overrides, focus-visible styles, hover/active transitions, reduced-motion handling and 768px/1024px breakpoints.

- [ ] **Step 3: Wire the shell and Ant Design theme**

Replace the inline `Shell` markup in `main.tsx` with `AppShell`, keep the current route table, and map `ConfigProvider` tokens:

```tsx
token: {
  colorPrimary: '#328d61',
  colorBgLayout: '#f7f9f8',
  colorText: '#151b18',
  colorBorder: '#e5ebe7',
  borderRadius: 8,
  fontSize: 14,
}
```

- [ ] **Step 4: Build after shell integration**

```bash
cd web && npm run build
```

Expected: only the known missing-page regression may remain.

### Task 3: Upgrade shared page components and the personal dashboard

**Files:**
- Modify: `web/src/components/PageHeader.tsx`
- Modify: `web/src/components/State.tsx`
- Create: `web/src/components/MetricCard.tsx`
- Modify: `web/src/pages/ActionCenter.tsx`

- [ ] **Step 1: Add contextual page headers**

Extend `PageHeader` without changing existing call sites:

```tsx
type PageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  backTo?: string;
  actions?: ReactNode;
};
```

Render a real button for back navigation, a stable title/description group and a wrapping actions container.

- [ ] **Step 2: Replace the bare spinner state**

Use an Ant Design skeleton whose geometry matches cards and lists. Support a visible error state and retry callback:

```tsx
type StateProps = {
  loading?: boolean;
  empty?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyText?: string;
  children: ReactNode;
};
```

- [ ] **Step 3: Add a semantic metric component**

Create `MetricCard` with an icon, label, numeric value, hint and optional route. Use a button only when a route exists, and keep the same fixed content geometry for all values.

- [ ] **Step 4: Recompose the personal workbench**

Keep the four existing API calls. Track partial API failures instead of swallowing every error, then render:

```tsx
<section className="fl-metric-grid">...</section>
<section className="fl-dashboard-grid">
  <div className="fl-dashboard-main">...</div>
  <aside className="fl-dashboard-aside">...</aside>
</section>
```

The left area shows concrete workflow entry points; the right area shows service status and short next actions. Do not add fake AI-generated content or controls without behavior.

- [ ] **Step 5: Run a production build**

```bash
cd web && npm run build
```

Expected: shared components type-check through Vite and render without import errors.

### Task 4: Restyle every list and detail page, and restore the versions page

**Files:**
- Create: `web/src/pages/ProjectVersions.tsx`
- Modify: `web/src/pages/Projects.tsx`
- Modify: `web/src/pages/Requirements.tsx`
- Modify: `web/src/pages/RequirementDetail.tsx`
- Modify: `web/src/pages/Milestones.tsx`
- Modify: `web/src/pages/MilestoneDetail.tsx`
- Modify: `web/src/pages/Deliveries.tsx`
- Modify: `web/src/pages/DeliveryDetail.tsx`
- Modify: `web/src/pages/WatchInbox.tsx`
- Modify: `web/src/pages/Trash.tsx`
- Modify: `web/src/pages/Settings.tsx`
- Modify: `web/src/pages/VersionWorkbench.tsx`
- Modify: `web/src/pages/NotFound.tsx`

- [ ] **Step 1: Restore the project versions route**

Create a functional `ProjectVersions` page using the existing API and model:

```tsx
const visibleVersions = useMemo(
  () => filterVersions(versions, { query, status, order }),
  [versions, query, status, order],
);
```

The page must load project metadata and versions, provide search/status/order controls, show baseline and readable status text, and navigate rows to `/projects/:slug/versions/:versionNo`. It must preserve the 60-version behavior proven by the model tests.

- [ ] **Step 2: Apply list-page composition**

For Projects, Requirements, Milestones and Deliveries:

```tsx
<main className="fl-page">
  <PageHeader ... />
  <section className="fl-toolbar">...</section>
  <section className="fl-surface">...</section>
</main>
```

Use project cards only where a project summary benefits from them. Keep tables for requirements and milestones. Remove repeated inline layout styles in favor of `fl-*` classes.

- [ ] **Step 3: Apply detail-page composition**

For RequirementDetail, MilestoneDetail and DeliveryDetail, add `backTo`, wrap descriptions in `fl-detail-summary`, and place associated records in a separate `fl-detail-section` without nested decorative cards.

- [ ] **Step 4: Apply auxiliary-page composition**

For WatchInbox, Trash, Settings and NotFound, use the same page spacing, list surface, empty/error treatment and accessible actions. Settings remains read-only where the API currently exposes read-only data.

- [ ] **Step 5: Polish the version workbench**

Use `fl-workbench-tabs`, `fl-preview-frame`, `fl-spec` and `fl-code-block` classes. Render changes inside a semantic preformatted block, preserve DOMPurify sanitization, and add `backTo` to the versions list.

- [ ] **Step 6: Run model tests and build**

```bash
cd web && node --test src/pages/projectVersionsModel.test.js && npm run build
```

Expected: seven model tests pass and Vite production build completes.

### Task 5: Browser verification and visual regression evidence

**Files:**
- Create: `.codex-ui-regression/personal-workspace-desktop.png`
- Create: `.codex-ui-regression/personal-workspace-mobile.png`
- Create: `.codex-ui-regression/projects-desktop.png`

- [ ] **Step 1: Start or reuse the local frontend server**

```bash
cd web && npm run dev -- --host 127.0.0.1
```

Expected: Vite reports a local URL without taking an occupied port silently.

- [ ] **Step 2: Inspect rendered DOM before interaction**

Use Playwright in headless Chromium, navigate to the reported URL, wait for `networkidle`, capture the DOM title, selected navigation item, page heading and browser console errors.

- [ ] **Step 3: Capture desktop screenshots**

At 1440×900, capture the personal workbench and project list. Assert:

```python
assert page.locator('.fl-app-sider').is_visible()
assert page.locator('.fl-page').evaluate('(el) => el.scrollWidth <= el.clientWidth')
assert page.locator('h1').is_visible()
```

- [ ] **Step 4: Capture the mobile screenshot and test navigation**

At 390×844, assert the desktop sidebar is hidden, the menu trigger is visible, the drawer opens, and selecting “项目” navigates to `#/projects` without horizontal document overflow.

- [ ] **Step 5: Run the final verification set**

```bash
cd web && node --test src/pages/projectVersionsModel.test.js && npm run build
```

Expected: all tests pass, build completes, screenshots contain nonblank rendered content, and no new React runtime error remains.

### Task 6: Completion audit

**Files:**
- Inspect: `docs/superpowers/specs/2026-08-24-personal-workspace-react-redesign-design.md`
- Inspect: all files changed by Tasks 2–5

- [ ] **Step 1: Map every specification section to evidence**

Confirm application shell, dashboard, list pages, detail pages, settings/auxiliary pages, tokens, shared components, accessibility, API boundaries, responsive breakpoints and test requirements each have direct file or runtime evidence.

- [ ] **Step 2: Check the patch scope**

```bash
git diff --check
git status --short
git diff -- web/src web/index.html web/package.json web/vite.config.js
```

Expected: no whitespace errors; unrelated pre-existing user changes remain untouched and are reported separately.
