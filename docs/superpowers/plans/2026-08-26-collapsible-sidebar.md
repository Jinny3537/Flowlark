# Collapsible Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent desktop sidebar collapse control that keeps a 72px icon rail while preserving existing mobile navigation.

**Architecture:** Keep the interaction owned by `AppShell`, use Ant Design `Sider` as a controlled component, and persist the browser-only preference in `localStorage`. Isolate stored-value parsing in a small pure model so invalid data has a deterministic fallback and can be tested with Node's built-in test runner.

**Tech Stack:** React 19, TypeScript/TSX, Ant Design 6, React Router 7, CSS, Node test runner, Vite 5.

---

### Task 1: Add the persisted-preference model

**Files:**
- Create: `web/src/components/appShellModel.js`
- Create: `web/src/components/appShellModel.test.js`

- [ ] **Step 1: Write the failing preference parser tests**

Create `web/src/components/appShellModel.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSiderCollapsed } from './appShellModel.js'

test('parses the persisted collapsed preference', () => {
  assert.equal(parseSiderCollapsed('true'), true)
  assert.equal(parseSiderCollapsed('false'), false)
})

test('defaults missing or invalid collapsed preferences to expanded', () => {
  assert.equal(parseSiderCollapsed(null), false)
  assert.equal(parseSiderCollapsed('collapsed'), false)
  assert.equal(parseSiderCollapsed('1'), false)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test web/src/components/appShellModel.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `appShellModel.js`.

- [ ] **Step 3: Implement the minimal preference parser**

Create `web/src/components/appShellModel.js`:

```js
export function parseSiderCollapsed(value) {
  return value === 'true'
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
node --test web/src/components/appShellModel.test.js
```

Expected: 2 tests pass, 0 tests fail.

- [ ] **Step 5: Commit the model and tests**

```bash
git add web/src/components/appShellModel.js web/src/components/appShellModel.test.js
git commit -m "test: define sidebar preference parsing"
```

### Task 2: Make the desktop sidebar collapsible

**Files:**
- Modify: `web/src/components/AppShell.tsx:3-25,56-119,207-245`
- Modify: `web/src/styles/global.css:205-341`

- [ ] **Step 1: Add the icon, model import, key, and lazy state initializer**

In `web/src/components/AppShell.tsx`, add `DoubleLeftOutlined` and `DoubleRightOutlined` to the icon imports, import the parser, and add the storage key:

```tsx
import {
  AppstoreOutlined,
  BellOutlined,
  BranchesOutlined,
  CalendarOutlined,
  DeleteOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  FileTextOutlined,
  FolderOutlined,
  InboxOutlined,
  MenuOutlined,
  PlusOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
} from '@ant-design/icons';
```

```tsx
import { parseSiderCollapsed } from './appShellModel.js';

const { Header, Sider, Content } = Layout;
const SIDER_COLLAPSED_KEY = 'flowlark:sider-collapsed';
```

Immediately after `const mobile = !screens.md;`, initialize the state without touching storage during later renders:

```tsx
  const [siderCollapsed, setSiderCollapsed] = useState(() => {
    try {
      return parseSiderCollapsed(window.localStorage.getItem(SIDER_COLLAPSED_KEY));
    } catch {
      return false;
    }
  });
```

- [ ] **Step 2: Add the toggle handler and menu collapse hint**

Before `const menu = useMemo`, add:

```tsx
  const toggleSider = () => {
    const nextCollapsed = !siderCollapsed;
    setSiderCollapsed(nextCollapsed);
    try {
      window.localStorage.setItem(SIDER_COLLAPSED_KEY, String(nextCollapsed));
    } catch {
      // The current-session UI state still works when storage is unavailable.
    }
  };
```

Pass the desktop collapse state into the memoized menu while ensuring the mobile drawer remains expanded:

```tsx
  const menu = useMemo(() => (
    <Menu
      className="fl-app-menu"
      mode="inline"
      inlineCollapsed={!mobile && siderCollapsed}
      selectedKeys={[selected]}
      items={navigation}
      onClick={({ key }) => navigate(`/${key}`)}
    />
  ), [mobile, navigate, selected, siderCollapsed]);
```

- [ ] **Step 3: Control the desktop Sider and render compact brand/status content**

Replace the desktop `Sider` block with:

```tsx
      {!mobile ? (
        <Sider
          width={240}
          collapsedWidth={72}
          collapsed={siderCollapsed}
          trigger={null}
          theme="light"
          className={`fl-app-sider ${siderCollapsed ? 'is-collapsed' : ''}`}
        >
          <div className="fl-sider-inner">
            <Tooltip title={siderCollapsed ? 'Flowlark · 回到工作台' : undefined} placement="right">
              {brand}
            </Tooltip>
            <nav id="fl-primary-navigation" className="fl-primary-nav" aria-label="主要导航">{menu}</nav>
            <Tooltip title={siderCollapsed ? (health ? '本地服务运行中' : '本地服务未连接') : undefined} placement="right">
              <div className="fl-sider-status">
                <Badge status={health ? 'success' : 'default'} />
                {!siderCollapsed ? <span>{health ? '本地服务运行中' : '本地服务未连接'}</span> : null}
              </div>
            </Tooltip>
          </div>
        </Sider>
      ) : null}
```

- [ ] **Step 4: Add the accessible desktop trigger to the header**

Inside `.fl-header-leading`, after the mobile menu button and before the mobile brand, add:

```tsx
            {!mobile ? (
              <Tooltip title={siderCollapsed ? '展开菜单' : '折叠菜单'}>
                <Button
                  className="fl-header-icon fl-sider-toggle"
                  type="text"
                  icon={siderCollapsed ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
                  aria-label={siderCollapsed ? '展开菜单' : '折叠菜单'}
                  aria-controls="fl-primary-navigation"
                  aria-expanded={!siderCollapsed}
                  onClick={toggleSider}
                />
              </Tooltip>
            ) : null}
```

- [ ] **Step 5: Add only the collapse-specific styles**

Append these rules beside the existing sidebar styles in `web/src/styles/global.css`:

```css
.fl-app-sider .ant-layout-sider-children {
  overflow: hidden;
}

.fl-app-sider.is-collapsed .fl-brand {
  justify-content: center;
  margin-inline: var(--pw-space-10);
  padding-inline: 0;
}

.fl-app-sider.is-collapsed .fl-brand-copy {
  display: none;
}

.fl-app-sider.is-collapsed .fl-app-menu .ant-menu-item-divider {
  margin-inline: var(--pw-space-16);
}

.fl-app-sider.is-collapsed .fl-sider-status {
  justify-content: center;
  margin-inline: var(--pw-space-12);
  padding-inline: var(--pw-space-8);
}

.fl-sider-toggle {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
}
```

- [ ] **Step 6: Build the frontend**

Run:

```bash
npm --prefix web run build
```

Expected: Vite completes successfully and writes `web/dist` without TypeScript or bundling errors.

- [ ] **Step 7: Commit the UI implementation**

```bash
git add web/src/components/AppShell.tsx web/src/styles/global.css
git commit -m "feat: add collapsible desktop sidebar"
```

### Task 3: Verify behavior and regressions

**Files:**
- Verify: `web/src/components/AppShell.tsx`
- Verify: `web/src/styles/global.css`
- Verify: `web/src/components/appShellModel.test.js`

- [ ] **Step 1: Run all automated tests**

Run:

```bash
npm test
```

Expected: all Node tests pass with 0 failures.

- [ ] **Step 2: Re-run the production build from the repository root**

Run:

```bash
npm run build:web
```

Expected: dependency installation and Vite production build complete successfully.

- [ ] **Step 3: Perform desktop browser checks**

At 1440px and 1024px widths, verify:

1. Initial state is 240px when no preference exists.
2. The header trigger collapses the sidebar to 72px and changes its label to “展开菜单”.
3. Brand copy and service text disappear while their Tooltips remain available.
4. Every navigation icon remains clickable, selected state follows the route, and main content expands.
5. Refresh preserves the collapsed state; expanding and refreshing preserves the expanded state.
6. Keyboard focus is visible on the trigger and navigation items.
7. The console has no runtime errors.

- [ ] **Step 4: Perform mobile browser checks**

At 767px and 390px widths, verify:

1. The desktop sidebar and its collapse trigger are absent.
2. The existing menu button opens the drawer with full labels.
3. Navigation closes the drawer after route changes.
4. There is no horizontal page overflow or console error.

- [ ] **Step 5: Inspect the final diff and working tree**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only unrelated pre-existing untracked regression artifacts remain outside the feature commits.
