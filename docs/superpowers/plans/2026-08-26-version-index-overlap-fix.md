# Version Index Overlap Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent version numbers, titles, and status labels from overlapping while preserving the compact two-line version index row.

**Architecture:** Keep the existing React markup and change only the CSS Module that owns the version browser. Increase the aligned version-number track, clip unexpectedly long version numbers inside that track, preserve the existing title ellipsis, and mirror the track width in the narrow-screen layout.

**Tech Stack:** React 19, Ant Design 6, CSS Modules, Vite 5

---

### Task 1: Constrain version row columns

**Files:**
- Modify: `web/src/pages/ProjectVersions.module.css:26-35`
- Modify: `web/src/pages/ProjectVersions.module.css:70-74`

- [ ] **Step 1: Run the CSS contract check before the change**

Run from the repository root:

```bash
node --input-type=module -e "import fs from 'node:fs'; const css = fs.readFileSync('web/src/pages/ProjectVersions.module.css', 'utf8'); const checks = ['grid-template-columns: 84px minmax(0, 1fr) auto', '.indexVersion { min-width: 0; max-width: 100%; overflow: hidden;', '.indexState { display: flex; min-width: 0; justify-content: flex-end; white-space: nowrap;', '.indexRow { grid-template-columns: 84px minmax(0, 1fr); }']; const missing = checks.filter((value) => !css.includes(value)); if (missing.length) { console.error('Missing expected rules:', missing); process.exit(1); }"
```

Expected: FAIL with all four expected CSS rules reported as missing.

- [ ] **Step 2: Apply the minimal CSS change**

In `web/src/pages/ProjectVersions.module.css`, replace the affected rules with:

```css
.indexRow { display: grid; width: 100%; min-height: 68px; grid-template-columns: 84px minmax(0, 1fr) auto; align-items: center; gap: var(--fl-s-2); padding: var(--fl-s-3); border: 0; border-bottom: 1px solid var(--fl-line); border-left: 3px solid transparent; background: transparent; color: var(--fl-text); font: inherit; letter-spacing: 0; text-align: left; cursor: pointer; transition: background-color 180ms ease, border-color 180ms ease; }
.indexVersion { min-width: 0; max-width: 100%; overflow: hidden; color: var(--fl-ink); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.indexState { display: flex; min-width: 0; justify-content: flex-end; white-space: nowrap; }
```

Inside the existing `@media (max-width: 480px)` block, use:

```css
.indexRow { grid-template-columns: 84px minmax(0, 1fr); }
```

Do not change the existing `.indexTitle` rule; it already provides single-line ellipsis and the React component already wraps it in an Ant Design tooltip.

- [ ] **Step 3: Re-run the CSS contract check**

Run the same Node command from Step 1.

Expected: PASS with exit code 0 and no missing rules.

- [ ] **Step 4: Build the web application**

Run:

```bash
npm run build --prefix web
```

Expected: Vite completes successfully and writes the production bundle to `web/dist` without compilation errors.

- [ ] **Step 5: Perform responsive visual checks**

Open the project version page containing `v2.8.5.0` and inspect it at desktop width and at 390px viewport width.

Expected at desktop width:

- The version number ends before the title begins.
- The title truncates with ellipsis when space is limited.
- The status tag remains fully readable.
- The row height and 320px index width are unchanged.

Expected at 390px viewport width:

- The version number remains inside the 84px first column.
- The title remains on one line with ellipsis.
- The status moves to the existing second-row position without horizontal overflow.

- [ ] **Step 6: Review the scoped diff**

Run:

```bash
git diff --check -- web/src/pages/ProjectVersions.module.css
git diff -- web/src/pages/ProjectVersions.module.css
```

Expected: no whitespace errors; only the version track, version overflow, status wrapping, and mobile track rules differ.

- [ ] **Step 7: Commit the fix**

Run:

```bash
git add web/src/pages/ProjectVersions.module.css
git commit -m "fix: prevent version index text overlap"
```

Expected: one commit containing only `web/src/pages/ProjectVersions.module.css`.
