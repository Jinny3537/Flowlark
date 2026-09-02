# Fullscreen Prototype Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workbench's constrained inline prototype editing mode with a dedicated full-screen route that edits text and common text formatting, protects unsaved changes, and saves through the existing HTML replacement API.

**Architecture:** Keep the prototype on the isolated preview port and extend its injected edit bridge with a small, allowlisted `postMessage` protocol. A new React route owns loading, permissions, the full-screen canvas, toolbar state, save/exit behavior, and message validation; the existing workbench only navigates into that route.

**Tech Stack:** Node.js HTTP server, React 19, React Router 7, Ant Design 6, CSS Modules, browser `postMessage`, Node test runner, Vite.

---

## File map

- `src/server/index.js`: inject and run the isolated edit bridge, execute allowlisted commands, track selection/dirty state, and serialize clean HTML.
- `test/server.test.js`: prove edit bridge injection, command allowlisting, and cleanup instructions are present only in edit previews.
- `web/src/pages/workbench/workbenchModel.js`: generate the encoded editor route.
- `web/src/pages/workbench/workbenchModel.test.js`: prove route generation for non-ASCII project/version identifiers.
- `web/src/pages/PrototypeEditor.tsx`: route-level loader, permission gate, iframe communication, formatting toolbar, save, and exit protection.
- `web/src/pages/workbench/PrototypeEditor.module.css`: full-screen editor layout and responsive toolbar behavior.
- `web/src/main.tsx`: render the editor route outside `AppShell`.
- `web/src/pages/VersionWorkbench.tsx`: navigate from the existing workbench to the new editor.
- `web/src/pages/workbench/PrototypeStage.tsx`: remove the old inline edit state and keep preview, annotation, offline, and source replacement controls.

### Task 1: Add a tested editor route helper

**Files:**
- Modify: `web/src/pages/workbench/workbenchModel.test.js`
- Modify: `web/src/pages/workbench/workbenchModel.js`

- [ ] **Step 1: Write the failing route test**

Add `prototypeEditorRoute` to the test import and add:

```js
test('builds an encoded full-screen prototype editor route', () => {
  assert.equal(
    prototypeEditorRoute('订单 原型', 'v1.0 beta'),
    '/projects/%E8%AE%A2%E5%8D%95%20%E5%8E%9F%E5%9E%8B/versions/v1.0%20beta/edit'
  )
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node --test web/src/pages/workbench/workbenchModel.test.js
```

Expected: FAIL because `prototypeEditorRoute` is not exported.

- [ ] **Step 3: Implement the route helper**

Add to `workbenchModel.js`:

```js
export function prototypeEditorRoute(slug, versionNo) {
  return `/projects/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionNo)}/edit`
}
```

- [ ] **Step 4: Run the focused test and verify success**

Run:

```bash
node --test web/src/pages/workbench/workbenchModel.test.js
```

Expected: all workbench model tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/workbench/workbenchModel.js web/src/pages/workbench/workbenchModel.test.js
git commit -m "test: define fullscreen prototype editor route"
```

### Task 2: Extend the isolated edit bridge

**Files:**
- Modify: `test/server.test.js`
- Modify: `src/server/index.js`

- [ ] **Step 1: Strengthen the failing bridge test**

Extend the existing “编辑预览仍走预览端口” test with assertions for the new protocol and cleanup markers, and add a normal-preview assertion:

```js
t.assert.match(body, /flowlark:edit-command/)
t.assert.match(body, /flowlark:edit-dirty/)
t.assert.match(body, /flowlark:edit-state/)
t.assert.match(body, /flowlark-edit-style/)
t.assert.match(body, /ALLOWED_COMMANDS/)
t.assert.match(body, /data-flowlark-edit-target/)

const normal = await fetch(`${previewBase}/p/ord/v1.0`)
t.assert.doesNotMatch(await normal.text(), /flowlark-edit-bridge/)
```

- [ ] **Step 2: Run the server test and verify failure**

Run:

```bash
node --test test/server.test.js
```

Expected: FAIL because the bridge does not yet expose command, dirty, state, style, or target markers.

- [ ] **Step 3: Replace the injected bridge with selection-safe, allowlisted editing**

Keep `editablePreviewHtml(buf)` as the single injection boundary. Its bridge must define:

```js
const ALLOWED_COMMANDS = new Set([
  'bold', 'italic', 'underline', 'fontSize', 'foreColor',
  'justifyLeft', 'justifyCenter', 'justifyRight'
])
```

The injected script must:

```js
let savedRange = null
let dirty = false

const rememberSelection = () => {
  const selection = window.getSelection()
  if (selection && selection.rangeCount && document.body.contains(selection.anchorNode)) {
    savedRange = selection.getRangeAt(0).cloneRange()
  }
}

const restoreSelection = () => {
  if (!savedRange) return
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(savedRange)
}

const post = (payload) => window.parent.postMessage(payload, '*')

const formatState = () => ({
  bold: document.queryCommandState('bold'),
  italic: document.queryCommandState('italic'),
  underline: document.queryCommandState('underline'),
  justifyLeft: document.queryCommandState('justifyLeft'),
  justifyCenter: document.queryCommandState('justifyCenter'),
  justifyRight: document.queryCommandState('justifyRight'),
  fontSize: document.queryCommandValue('fontSize'),
  foreColor: document.queryCommandValue('foreColor')
})
```

On `selectionchange`, remember the range and send `flowlark:edit-state`. On `input`, set dirty and send `flowlark:edit-dirty` once. On `flowlark:edit-command`, reject commands outside `ALLOWED_COMMANDS`; otherwise restore the range, call `document.execCommand(command, false, value || null)`, remember the resulting range, mark dirty when successful, and reply with `flowlark:edit-command-result` plus current state.

Inject a style element with id `flowlark-edit-style` and rules for common text elements plus `[data-flowlark-edit-target]`. Pointer movement/clicking may set that attribute only on the closest text-bearing element.

Before serialization:

```js
const bridge = document.getElementById('flowlark-edit-bridge')
const style = document.getElementById('flowlark-edit-style')
const targets = [...document.querySelectorAll('[data-flowlark-edit-target]')]
if (bridge) bridge.remove()
if (style) style.remove()
targets.forEach((node) => node.removeAttribute('data-flowlark-edit-target'))
```

After producing `document.documentElement.outerHTML`, restore those editor-only nodes/attributes for the still-open session. Preserve the existing removal/restoration of `contenteditable` on `body`.

- [ ] **Step 4: Run server tests**

Run:

```bash
node --test test/server.test.js
```

Expected: all server tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/index.js test/server.test.js
git commit -m "feat: extend isolated prototype edit bridge"
```

### Task 3: Build the full-screen editor route

**Files:**
- Create: `web/src/pages/PrototypeEditor.tsx`
- Create: `web/src/pages/workbench/PrototypeEditor.module.css`

- [ ] **Step 1: Create the route-level state and permission gate**

`PrototypeEditor.tsx` must load project, version, and health with a guarded request keyed by `${slug}\0${versionNo}`. Derive:

```ts
const workbenchRoute = `/projects/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionNo)}`;
const editable = canEditStructure({
  canWrite: health?.canWrite !== false,
  version,
  lockBaseline: health?.rules?.lockBaseline !== false,
});
const editorSrc = previewUrl({
  protocol: window.location.protocol,
  hostname: window.location.hostname,
  previewPort: health?.previewPort || 7789,
  slug,
  versionNo,
  edit: true,
});
```

While loading, render a full-view `Spin`. On load failure render `Alert` with “重试” and “返回工作台”. When `editable` is false, render an informational `Result` and do not render the edit iframe.

- [ ] **Step 2: Implement validated iframe messaging**

Use an iframe ref and accept messages only when:

```ts
if (event.source !== frameRef.current?.contentWindow) return;
```

Track `ready`, `dirty`, `saving`, and:

```ts
type EditorState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  justifyLeft: boolean;
  justifyCenter: boolean;
  justifyRight: boolean;
  fontSize: string;
  foreColor: string;
};
```

Define the toolbar choices and color fallback in the same file:

```ts
const fontSizeOptions = [
  { value: '1', label: '12px' },
  { value: '2', label: '14px' },
  { value: '3', label: '16px' },
  { value: '4', label: '18px' },
  { value: '5', label: '24px' },
  { value: '6', label: '32px' },
  { value: '7', label: '48px' },
];

function normalizeColor(value: string) {
  const match = String(value || '').match(/^#([0-9a-f]{6})$/i);
  return match ? match[0] : '#151b18';
}

const normalizedColor = normalizeColor(state.foreColor);
```

Handle `flowlark:edit-ready`, `flowlark:edit-dirty`, `flowlark:edit-state`, and failed `flowlark:edit-command-result`. Send formatting requests with generated IDs:

```ts
frameRef.current?.contentWindow?.postMessage({
  type: 'flowlark:edit-command',
  id: messageId(),
  command,
  value,
}, '*');
```

- [ ] **Step 3: Implement save and exit protection**

Request edited HTML using the existing `flowlark:get-edit-html` / `flowlark:edit-html` protocol with a 3-second timeout. On save:

```ts
function readEditedHtml(frame: HTMLIFrameElement | null) {
  return new Promise<string>((resolve, reject) => {
    const frameWindow = frame?.contentWindow;
    if (!frameWindow) return reject(new Error('NO_FRAME'));
    const id = messageId();
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data && typeof event.data === 'object' ? event.data : {};
      if (event.source !== frameWindow || data.type !== 'flowlark:edit-html' || data.id !== id) return;
      cleanup();
      resolve(String(data.html || ''));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('EDIT_HTML_TIMEOUT'));
    }, 3000);
    window.addEventListener('message', onMessage);
    frameWindow.postMessage({ type: 'flowlark:get-edit-html', id }, '*');
  });
}
```

On save:

```ts
const html = await readEditedHtml(frameRef.current);
await api.replaceHtml(slug, versionNo, html);
message.success('原型已保存');
setDirty(false);
navigate(workbenchRoute, { replace: true });
```

If saving fails, keep the iframe mounted, preserve `dirty`, and show the error. Add `beforeunload` only while `dirty` is true. The page exit button calls `Modal.confirm` with “放弃修改” and “继续编辑” when dirty; otherwise it navigates directly.

- [ ] **Step 4: Implement the semantic toolbar and layout**

The JSX must include:

```tsx
<header className={styles.header}>
  <div className={styles.identity}>
    <strong>实时编辑</strong>
    <span>{projectName} / {versionNo}</span>
    {dirty ? <Tag color="warning">未保存</Tag> : <Tag>已同步</Tag>}
  </div>
  <Button onClick={exitEditor}>退出编辑</Button>
</header>

<iframe ref={frameRef} className={styles.frame} src={editorSrc} ... />

<div className={styles.toolbar} role="toolbar" aria-label="文字格式工具栏">
  <Tooltip title="加粗">
    <Button icon={<BoldOutlined />} aria-label="加粗" aria-pressed={state.bold}
      type={state.bold ? 'primary' : 'default'} onMouseDown={(event) => event.preventDefault()}
      onClick={() => sendCommand('bold')} />
  </Tooltip>
  <Tooltip title="斜体">
    <Button icon={<ItalicOutlined />} aria-label="斜体" aria-pressed={state.italic}
      type={state.italic ? 'primary' : 'default'} onMouseDown={(event) => event.preventDefault()}
      onClick={() => sendCommand('italic')} />
  </Tooltip>
  <Tooltip title="下划线">
    <Button icon={<UnderlineOutlined />} aria-label="下划线" aria-pressed={state.underline}
      type={state.underline ? 'primary' : 'default'} onMouseDown={(event) => event.preventDefault()}
      onClick={() => sendCommand('underline')} />
  </Tooltip>
  <Select aria-label="字号" value={state.fontSize || '3'} options={fontSizeOptions}
    onChange={(value) => sendCommand('fontSize', value)} />
  <input className={styles.colorInput} type="color" aria-label="文字颜色"
    value={normalizedColor} onChange={(event) => sendCommand('foreColor', event.target.value)} />
  <Button icon={<AlignLeftOutlined />} aria-label="左对齐" aria-pressed={state.justifyLeft}
    onMouseDown={(event) => event.preventDefault()} onClick={() => sendCommand('justifyLeft')} />
  <Button icon={<AlignCenterOutlined />} aria-label="居中" aria-pressed={state.justifyCenter}
    onMouseDown={(event) => event.preventDefault()} onClick={() => sendCommand('justifyCenter')} />
  <Button icon={<AlignRightOutlined />} aria-label="右对齐" aria-pressed={state.justifyRight}
    onMouseDown={(event) => event.preventDefault()} onClick={() => sendCommand('justifyRight')} />
  <Button type="primary" loading={saving} disabled={!ready} onClick={save}>完成</Button>
</div>
```

Use Ant Design icons rather than text glyphs for alignment. Formatting buttons use `onMouseDown={(event) => event.preventDefault()}` so the parent control does not unnecessarily disturb the iframe selection.

`PrototypeEditor.module.css` must set a `100dvh` flex column, a 56px high header, a flexing canvas, a borderless 100% iframe, and a fixed/absolute bottom-centered toolbar with 44px controls. Below 720px, keep the header compact and make the toolbar max-width `calc(100vw - 24px)` with horizontal scrolling. Add a `prefers-reduced-motion` rule.

- [ ] **Step 5: Build to catch TypeScript and CSS errors**

Run:

```bash
npm run build:web
```

Expected: Vite build completes without TypeScript/import errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/PrototypeEditor.tsx web/src/pages/workbench/PrototypeEditor.module.css
git commit -m "feat: add fullscreen prototype editor page"
```

### Task 4: Route the editor outside the app shell and remove inline editing

**Files:**
- Modify: `web/src/main.tsx`
- Modify: `web/src/pages/VersionWorkbench.tsx`
- Modify: `web/src/pages/workbench/PrototypeStage.tsx`

- [ ] **Step 1: Add the shell-free route**

Import `PrototypeEditor`. Split routing so the editor route is matched before the shell fallback:

```tsx
function RootRoutes() {
  return (
    <Routes>
      <Route path="/projects/:slug/versions/:versionNo/edit" element={<PrototypeEditor />} />
      <Route path="*" element={<AppRoutes />} />
    </Routes>
  );
}
```

Keep the existing route table inside `AppRoutes` and render `<RootRoutes />` inside the existing `HashRouter` and `AppRuntimeProvider`.

- [ ] **Step 2: Change the workbench entry action**

In `VersionWorkbench.tsx`, import `prototypeEditorRoute`. Replace inline edit toggling with:

```ts
const openPrototypeEditor = () => {
  if (!editable) {
    message.info('只有编辑中版本可以在线编辑');
    return;
  }
  navigate(prototypeEditorRoute(slug, versionNo));
};
```

Remove `prototypeEditMode`, `editPreviewSrc`, `stageRef`, `htmlSaving`, `togglePrototypeEdit`, and `savePrototypeEdit`. Pass `onOpenPrototypeEditor={openPrototypeEditor}` into `PrototypeStage`.

- [ ] **Step 3: Simplify the preview stage**

In `PrototypeStage.tsx`:

- remove `PrototypeStageHandle`, `forwardRef`, `useImperativeHandle`, the edit iframe HTML reader, and inline edit props;
- rename the entry callback to `onOpenPrototypeEditor`;
- keep the “在线编辑” button, but make it a normal navigation action;
- always render `src={previewSrc}`;
- keep annotation, offline preview, source replacement, full-width preview, and offline build behavior unchanged.

The entry button remains:

```tsx
<Button
  size="small"
  icon={<EditOutlined />}
  disabled={!editable}
  onClick={onOpenPrototypeEditor}
>
  在线编辑
</Button>
```

- [ ] **Step 4: Run focused tests and build**

Run:

```bash
node --test web/src/pages/workbench/workbenchModel.test.js test/server.test.js
npm run build:web
```

Expected: all focused tests PASS and Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/main.tsx web/src/pages/VersionWorkbench.tsx web/src/pages/workbench/PrototypeStage.tsx
git commit -m "feat: open prototype editing in fullscreen route"
```

### Task 5: Run regression and browser verification

**Files:**
- Modify only if verification reveals an in-scope defect.

- [ ] **Step 1: Run the full automated suite**

Run:

```bash
npm test
npm run build:web
```

Expected: all Node tests PASS and the production web build succeeds.

- [ ] **Step 2: Start a disposable Flowlark workspace and browser session**

Create a temporary workspace with the public core API and run the server on free ports. Do not use or mutate the repository's ignored `data/` workspace:

```bash
export FLOWLARK_EDITOR_QA_ROOT="$(mktemp -d /tmp/flowlark-editor-qa.XXXXXX)"
node --input-type=module -e "import { initRepo } from './src/core/repo.js'; import { Hub } from './src/core/service.js'; const root=process.env.FLOWLARK_EDITOR_QA_ROOT; initRepo(root,{name:'Editor QA'}); const hub=new Hub(root); hub.createProject({name:'编辑器验证',code:'editor-qa'}); hub.addVersion('editor-qa',{versionNo:'v1.0',title:'文字格式验证',html:'<!doctype html><html><body><h1>原始标题</h1><p>可编辑段落</p></body></html>'});"
```

Start the server through a small foreground Node process using `startServer(FLOWLARK_EDITOR_QA_ROOT, { port: 0, previewPort: 0 })`, print its resolved URL, and keep the process alive for the browser run.

- [ ] **Step 3: Verify the user path in a browser**

Confirm with Playwright or the in-app browser:

1. Open a draft version workbench and click “在线编辑”.
2. Confirm the URL ends in `/edit` and the normal app sidebar/header are absent.
3. Edit text, apply bold and center alignment, and confirm “未保存” appears.
4. Click “退出编辑” and confirm the discard dialog appears; continue editing.
5. Click “完成”, confirm return to the workbench, and confirm the preview shows saved content/formatting.
6. Confirm ordinary preview, annotation, and “修改原型” remain reachable.
7. Confirm the browser console contains no new errors.

- [ ] **Step 4: Inspect scope and diff hygiene**

Run:

```bash
git status --short
git diff --check HEAD~4..HEAD
```

Expected: only task files and pre-existing user changes are present; there are no whitespace errors. Do not stage or alter the pre-existing `AppShell.tsx`, `NotFound.tsx`, `.codex-ui-regression/`, or `test-results/` changes.

- [ ] **Step 5: Final corrective commit only if needed**

If browser verification required in-scope corrections:

```bash
git add -- src/server/index.js test/server.test.js web/src/main.tsx web/src/pages/VersionWorkbench.tsx web/src/pages/PrototypeEditor.tsx web/src/pages/workbench/PrototypeEditor.module.css web/src/pages/workbench/PrototypeStage.tsx web/src/pages/workbench/workbenchModel.js web/src/pages/workbench/workbenchModel.test.js
git commit -m "fix: complete fullscreen prototype editor verification"
```

Otherwise, do not create an empty commit.
