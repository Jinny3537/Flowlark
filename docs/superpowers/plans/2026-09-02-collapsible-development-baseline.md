# Collapsible Development Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-expanded development-baseline command strip with an accessible, single-row summary that is collapsed by default and reveals the existing details and actions on demand.

**Architecture:** Keep the behavior local to `ProjectVersions`: one boolean state controls a native button and a hidden details container. Reuse all existing baseline data and action handlers without changing API calls, models, routing, or persistence; CSS only reshapes the existing strip and its responsive states.

**Tech Stack:** React 19, TypeScript/TSX, Ant Design 6, CSS Modules, Vite 5, Node.js 20+ test runner.

---

## File map

- Modify `web/src/pages/ProjectVersions.tsx`: add the disclosure state, accessible trigger, collapsed status tags, and the existing detail/action content behind the disclosure.
- Modify `web/src/pages/ProjectVersions.module.css`: make the collapsed row 44px tall on desktop, style focus/hover/chevron states, preserve the expanded layout, and keep narrow screens free of horizontal overflow.
- Do not modify `web/src/pages/projectVersionsModel.js`: all displayed values already come from `baseline`, `newCount`, `planning`, `commandBadges`, and existing handlers.
- Do not add a frontend test dependency: this repository has no component-test harness, and adding one for a local disclosure would exceed scope. Use production compilation, the existing Node suite, and browser interaction checks.

### Task 1: Add the accessible disclosure behavior

**Files:**
- Modify: `web/src/pages/ProjectVersions.tsx:19-36`
- Modify: `web/src/pages/ProjectVersions.tsx:99-103`
- Modify: `web/src/pages/ProjectVersions.tsx:714-774`

- [ ] **Step 1: Record the failing acceptance state**

Use the supplied screenshot and current source as the failing case. The current baseline strip renders metadata, change counts, badges, and actions unconditionally, so “collapsed on first render” fails: there is no `aria-expanded` trigger and the full strip pushes the version browser downward.

- [ ] **Step 2: Import the disclosure icon**

Add `DownOutlined` without reordering unrelated imports:

```tsx
import {
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

- [ ] **Step 3: Add local, non-persistent state**

Add the new state beside the existing baseline UI state:

```tsx
const [planningError, setPlanningError] = useState('');
const [historyOpen, setHistoryOpen] = useState(false);
const [baselineExpanded, setBaselineExpanded] = useState(false);
const [rollbackLoading, setRollbackLoading] = useState(false);
```

Do not add an effect, URL parameter, local-storage key, or preference field. Every new page mount starts collapsed.

- [ ] **Step 4: Replace the baseline strip markup**

Replace the current `versions.length` baseline-strip block with this disclosure. The trigger stays separate from expanded actions, avoiding nested interactive controls.

```tsx
{versions.length ? (
  <section className={styles.baselineStrip} aria-label="版本状态摘要">
    <button
      type="button"
      className={styles.baselineToggle}
      aria-expanded={baselineExpanded}
      aria-controls="development-baseline-details"
      onClick={() => setBaselineExpanded((expanded) => !expanded)}
    >
      <span className={styles.baselineSummary}>
        <span className={styles.baselineKicker}>{baseline ? '当前开发基线' : '基线状态'}</span>
        <strong className="fl-mono">{baseline ? versionNoOf(baseline) : '未设置'}</strong>
        <span className={styles.baselineTitle}>
          {baseline ? textOf(baseline.title, '未命名版本') : '尚未设置开发基线，请从已记录变更的版本中选择'}
        </span>
        {newCount > 0 ? <span className={styles.readMarker}>{newCount} 个新版本</span> : null}
      </span>
      {!baselineExpanded && commandBadges.length ? (
        <span className={styles.collapsedBadges}>
          {commandBadges.map((badge) => (
            <Tag key={badge.key} color={badge.color}>{badge.label}</Tag>
          ))}
        </span>
      ) : null}
      <DownOutlined
        className={`${styles.baselineChevron} ${baselineExpanded ? styles.baselineChevronExpanded : ''}`}
        aria-hidden
      />
    </button>

    <div
      id="development-baseline-details"
      className={styles.baselineDetails}
      hidden={!baselineExpanded}
    >
      <div className={styles.baselineContent}>
        {baseline ? (
          <span className={styles.baselineMeta}>
            {createdByOf(baseline)} · {fmtTime(baseline.baselineAt || createdAtOf(baseline))}
            {' · '}{baseline.requirementCount || baseline.requirements?.length || 0} 条需求
          </span>
        ) : null}
        {planning?.previousBaseline ? (
          <div className={styles.changeDigest} aria-label="相对上一基线的累计变更">
            <span>相对 {versionNoOf(planning.previousBaseline)}</span>
            <strong>新增 {planning.changeCounts?.ADD || 0}</strong>
            <strong>修改 {planning.changeCounts?.MODIFY || 0}</strong>
            <strong>删除 {planning.changeCounts?.REMOVE || 0}</strong>
            {planning.previousBaselineSource === 'local' ? <small>根据本地记录推断</small> : null}
          </div>
        ) : baseline ? <span className={styles.baselineMeta}>首个基线，暂无上一基线</span> : null}
        {commandBadges.length ? (
          <Space wrap size={[6, 6]} className={styles.commandBadges}>
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
          </Space>
        ) : null}
      </div>
      <Space wrap className={styles.commandActions}>
        {baseline ? <Button type="primary" onClick={() => openWorkbench(versionNoOf(baseline))}>打开当前基线</Button> : null}
        {compareTargets.baselineVsPrevious ? (
          <Button icon={<SwapOutlined />} onClick={() => openComparison(compareTargets.baselineVsPrevious)}>
            与上一基线比较
          </Button>
        ) : null}
        <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>基线历史</Button>
        {newCount > 0 ? (
          <Button size="small" onClick={() => void markRead(versionNoOf(versions[0]))}>标记最新为已读</Button>
        ) : null}
        {baseline && canRollback ? (
          <Button icon={<UndoOutlined />} loading={rollbackLoading} disabled={!canWrite} onClick={() => void rollbackBaseline()}>
            回滚上一版
          </Button>
        ) : null}
      </Space>
    </div>
  </section>
) : null}
```

- [ ] **Step 5: Compile the TSX change**

Run `npm --prefix web run build`.

Expected: Vite exits 0 and prints a successful production-build summary; there are no JSX, TypeScript, or missing-icon errors. Styling is completed in Task 2.

- [ ] **Step 6: Commit the behavior change**

```bash
git add web/src/pages/ProjectVersions.tsx
git commit -m "feat: collapse development baseline details"
```

Expected: the commit contains only `ProjectVersions.tsx`.

### Task 2: Compact the strip and preserve responsive behavior

**Files:**
- Modify: `web/src/pages/ProjectVersions.module.css:9-20`
- Modify: `web/src/pages/ProjectVersions.module.css:73-97`

- [ ] **Step 1: Confirm the pre-CSS failure**

With Task 1 complete, the disclosure works semantically, but the new classes are unstyled. The trigger therefore fails the 44px visual acceptance requirement until this task is complete.

- [ ] **Step 2: Replace the baseline style block**

Replace the current `.baselineStrip` through `.commandActions` rules with:

```css
.baselineStrip { min-width: 0; margin-bottom: var(--fl-s-4); border-left: 3px solid var(--fl-primary); border-radius: var(--fl-r-2); background: var(--fl-primary-bg); }
.baselineToggle { display: flex; width: 100%; min-height: 44px; align-items: center; gap: var(--fl-s-2); padding: 0 var(--fl-s-3); border: 0; border-radius: inherit; background: transparent; color: var(--fl-text); font: inherit; text-align: left; cursor: pointer; }
.baselineToggle:hover { background: color-mix(in srgb, var(--fl-primary-bg) 70%, var(--fl-surface)); }
.baselineToggle:focus-visible { outline: 2px solid var(--fl-primary); outline-offset: -2px; }
.baselineSummary { display: flex; min-width: 0; flex: 1; align-items: baseline; gap: var(--fl-s-2); }
.baselineSummary > strong { flex: none; }
.baselineContent { display: grid; min-width: 0; flex: 1; gap: var(--fl-s-2); }
.baselineKicker, .baselineLabel, .readMarker { flex: none; color: var(--fl-primary-deep); font-size: var(--fl-fs-2); font-weight: 700; }
.baselineTitle { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.baselineMeta { flex: none; color: var(--fl-text-2); font-size: var(--fl-fs-2); }
.collapsedBadges { display: flex; flex: none; align-items: center; gap: var(--fl-s-1); }
.collapsedBadges :global(.ant-tag) { margin: 0; }
.baselineChevron { flex: none; color: var(--fl-primary-deep); transition: transform 180ms ease; }
.baselineChevronExpanded { transform: rotate(180deg); }
.baselineDetails { display: flex; min-width: 0; align-items: flex-start; gap: var(--fl-s-5); padding: var(--fl-s-3); border-top: 1px solid var(--fl-primary-border); }
.baselineDetails[hidden] { display: none; }
.changeDigest { display: flex; align-items: center; flex-wrap: wrap; gap: var(--fl-s-2); color: var(--fl-text-2); font-size: var(--fl-fs-2); }
.changeDigest strong { color: var(--fl-text); font-size: var(--fl-fs-2); }
.changeDigest small { color: var(--fl-text-3); }
.commandBadges :global(.ant-btn) { height: auto; padding: 0; border: 0; background: transparent; box-shadow: none; }
.commandBadges :global(.ant-tag) { margin: 0; }
.commandActions { max-width: 480px; justify-content: flex-end; }
```

- [ ] **Step 3: Update responsive rules**

Replace the baseline-specific declarations inside `@media (max-width: 899px)` with:

```css
.baselineDetails { flex-wrap: wrap; }
.baselineContent, .baselineMeta, .commandActions { width: 100%; max-width: none; }
.commandActions { justify-content: flex-start; }
```

Add this at the start of `@media (max-width: 480px)`:

```css
.baselineToggle { display: grid; grid-template-columns: minmax(0, 1fr) auto; padding: var(--fl-s-2); }
.baselineSummary { grid-column: 1; grid-row: 1; }
.baselineTitle { display: none; }
.collapsedBadges { grid-column: 1 / -1; grid-row: 2; flex-wrap: wrap; }
.baselineChevron { grid-column: 2; grid-row: 1; }
```

The mobile row may grow to two compact lines when tags exist; it must never hide the baseline label/version or create horizontal scrolling.

- [ ] **Step 4: Build after styling**

Run `npm --prefix web run build`.

Expected: Vite exits 0; CSS Module resolution and syntax both pass.

- [ ] **Step 5: Commit the responsive styling**

```bash
git add web/src/pages/ProjectVersions.module.css
git commit -m "style: compact development baseline summary"
```

Expected: the commit contains only `ProjectVersions.module.css`.

### Task 3: Verify behavior and regressions

**Files:**
- Verify: `web/src/pages/ProjectVersions.tsx`
- Verify: `web/src/pages/ProjectVersions.module.css`

- [ ] **Step 1: Run automated checks**

Run `npm test`, then `npm --prefix web run build`.

Expected: all Node tests pass with zero failures; Vite exits 0 and generates `web/dist`.

- [ ] **Step 2: Start an isolated sample workspace**

```bash
FLOWLARK_UI_REPO="$(mktemp -d)"
node bin/flowlark.js init "$FLOWLARK_UI_REPO"
export FLOWLARK_REPO="$FLOWLARK_UI_REPO"
node bin/flowlark.js new "折叠基线测试" --code baseline-test
node bin/flowlark.js add web/index.html -p baseline-test -n v1 -t "首个基线版本"
node bin/flowlark.js baseline baseline-test v1
node bin/flowlark.js new "无基线测试" --code no-baseline
node bin/flowlark.js add web/index.html -p no-baseline -n v1 -t "未设基线版本"
unset FLOWLARK_REPO
REBUILD=1 ./start.sh "$FLOWLARK_UI_REPO" --port 7798 --no-open
```

Expected: `baseline-test` contains baseline `v1`, `no-baseline` contains one version without a baseline, and the workbench is available at `http://localhost:7798`. Preserve the printed temporary path so cleanup targets only that directory.

- [ ] **Step 3: Verify desktop behavior at 1440px**

Open `http://localhost:7798/#/projects/baseline-test` and verify:

1. “当前开发基线 v1 首个基线版本” is collapsed on first render.
2. The trigger is approximately 44px high and the version browser appears immediately below it.
3. Clicking changes `aria-expanded` to `true` and reveals maintainer/time, first-baseline text, tags, and all existing actions.
4. Clicking again hides details without a new baseline-data request.
5. Tab reaches the trigger; Enter and Space toggle it; focus remains visible.
6. Refreshing returns to the collapsed state; the console has no new errors.

- [ ] **Step 4: Verify the 390px state**

Verify that the baseline label, version, disclosure state, and tags remain readable; the title may hide; there is no horizontal scroll; expanded actions wrap; and the existing mobile version-detail drawer still opens.

- [ ] **Step 5: Verify the no-baseline edge state**

Open `http://localhost:7798/#/projects/no-baseline`.

Expected: the collapsed row reads “基线状态 · 未设置”; expanding reveals “基线历史”; the version list remains usable. Confirm in the final diff that the pre-existing `!canWrite` alert/disabled props and `planningError` warning/retry block remain unchanged, so this presentation-only change does not bypass either edge path.

- [ ] **Step 6: Review the final diff**

```bash
git diff HEAD~2 -- web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
git diff --check HEAD~2..HEAD
git status --short
```

Expected: every changed line belongs to the disclosure. No model, API, unrelated formatting, or pre-existing user file is included.
