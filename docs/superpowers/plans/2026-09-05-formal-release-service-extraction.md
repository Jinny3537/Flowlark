# Formal Release Service Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the formal-release workflow out of `src/core/service.js` into a focused functional domain service without changing any public contract or persisted data.

**Architecture:** Add `src/core/formal-release-service.js` with four exported operations and private workflow helpers. `Hub` remains the public façade and creates a fresh explicit context for each call so runtime configuration and adapters never become stale. Existing release-mail and API tests act as characterization tests for this behavior-preserving refactor.

**Tech Stack:** Node.js 20 ESM, synchronous filesystem-backed domain modules, `node:test`, Hono API façade, React/Vite build verification.

---

## File map

- Create: `src/core/formal-release-service.js` — formal-release validation, orchestration, delivery lifecycle, and mail retry workflow.
- Modify: `src/core/service.js` — construct the explicit context and delegate the four existing public methods.
- Verify: `test/release-mail.test.js` — workflow order, resumability, idempotency, lifecycle, recipient privacy, and retry behavior.
- Verify: `test/release-mail-api.test.js` — unchanged HTTP contract.
- Reference: `src/core/release-mail.js` — mail templates and queue persistence; do not change.
- Reference: `src/core/formal-release-run.js` — step journal persistence; do not change.

## Task 1: Establish the characterization baseline

**Files:**
- Test: `test/release-mail.test.js`
- Test: `test/release-mail-api.test.js`

- [ ] **Step 1: Confirm the worktree boundary**

Run:

```bash
git status --short
```

Expected: record all pre-existing changes. Do not edit, stage, or commit files outside this plan.

- [ ] **Step 2: Run the focused characterization tests**

Run:

```bash
node --test test/release-mail.test.js test/release-mail-api.test.js
```

Expected: PASS. If the baseline is not green, stop and report the pre-existing failure before refactoring.

- [ ] **Step 3: Record the current public surface**

Confirm these `Hub` signatures remain unchanged throughout the plan:

```js
async preflightMilestoneFormalRelease(name, slug, versionNo, input = {})
async formalReleaseMilestoneVersion(name, slug, versionNo, input = {})
listReleaseMails()
async retryReleaseMail(id)
```

Expected: no code change and no commit for this task.

## Task 2: Extract target validation and preflight

**Files:**
- Create: `src/core/formal-release-service.js`
- Modify: `src/core/service.js:592-659`
- Modify: `src/core/service.js:1337-1485`
- Modify: `src/core/service.js:3725-3751`
- Test: `test/release-mail.test.js`

- [ ] **Step 1: Create the preflight service boundary**

Create `src/core/formal-release-service.js` with these imports and public entry point:

```js
import { err } from './errors.js'
import * as store from './store.js'
import * as rules from './rules.js'
import * as milestones from './milestones.js'
import * as requirements from './requirements.js'
import * as releaseMail from './release-mail.js'
import { currentUser } from './repo.js'

export async function preflightMilestoneFormalRelease(context, name, slug, versionNo, input = {}) {
  assertMilestoneFormalReleaseTarget(context.root, name, slug, versionNo)
  return publicFormalReleasePreflight(await prepareFormalRelease(context, slug, versionNo, input))
}
```

Copy the bodies of the following existing functions into this file without changing their conditions, error codes, messages, ordering, or return fields. Keep the original private methods temporarily because the not-yet-extracted execution path still calls them; Task 4 removes the originals after every caller has moved.

```js
function assertMilestoneFormalReleaseTarget(root, name, slug, versionNo)
async function prepareFormalRelease(context, slug, versionNo, input = {})
function validReleaseTime(value)
function publicFormalReleasePreflight(value)
```

Apply these exact receiver substitutions inside the moved bodies:

```js
this.root                         -> context.root
this.settings                     -> context.settings
this.wecomMcp                     -> context.wecomMcp
this.gitSyncOverride              -> context.gitSyncOverride
this.gitIdentity()                -> context.gitIdentity()
this.gitConflicts()               -> context.gitConflicts()
this.gitInProgress()              -> context.gitInProgress()
this.gitRemote()                  -> context.gitRemote()
this.listVersions(slug, options)  -> context.listVersions(slug, options)
```

Inside target validation, replace `reqx` with the imported `requirements` namespace and retain direct `store` and `milestones` calls.

- [ ] **Step 2: Add the service import and context factory to `Hub`**

Add this import to `src/core/service.js`:

```js
import {
  formalReleaseMilestoneVersion as runFormalRelease,
  listReleaseMails as readFormalReleaseMails,
  preflightMilestoneFormalRelease as preflightFormalRelease,
  retryReleaseMail as retryFormalReleaseMail
} from './formal-release-service.js'
```

Add this private method near the other `Hub` private adapters:

```js
#formalReleaseContext() {
  return {
    root: this.root,
    settings: this.settings,
    wecomMcp: this.wecomMcp,
    gitSyncOverride: this.gitSyncOverride,
    gitIdentity: () => this.gitIdentity(),
    gitConflicts: () => this.gitConflicts(),
    gitInProgress: () => this.gitInProgress(),
    gitRemote: () => this.gitRemote(),
    gitSync: (options) => this.gitSync(options),
    listVersions: (slug, options) => this.listVersions(slug, options),
    setBaseline: (slug, versionNo) => this.setBaseline(slug, versionNo),
    getVersion: (slug, versionNo) => this.getVersion(slug, versionNo),
    appendLog: (...args) => this.#log(...args),
    withLock: (key, fn) => withMilestoneSyncLock(this.root, key, fn)
  }
}
```

The context must be constructed per call; do not cache it in the constructor.

- [ ] **Step 3: Delegate the public preflight method**

Replace the current method with:

```js
async preflightMilestoneFormalRelease(name, slug, versionNo, input = {}) {
  return preflightFormalRelease(this.#formalReleaseContext(), name, slug, versionNo, input)
}
```

Keep `#assertMilestoneFormalReleaseTarget`, `#prepareFormalRelease`, and the file-level helpers in `service.js` during this intermediate commit. They are still required by `#formalRelease`; Task 4 deletes them after the execution path delegates to the new module.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test test/release-mail.test.js test/release-mail-api.test.js
```

Expected: PASS with the same test count as Task 1.

- [ ] **Step 5: Commit the preflight extraction**

```bash
git add src/core/formal-release-service.js src/core/service.js
git commit -m "refactor: extract formal release preflight"
```

## Task 3: Extract mail listing, sending, and retry

**Files:**
- Modify: `src/core/formal-release-service.js`
- Modify: `src/core/service.js:1680-1749`
- Test: `test/release-mail.test.js:643-688`
- Test: `test/release-mail-api.test.js`

- [ ] **Step 1: Add the mail operations to the domain service**

Add the public wrappers:

```js
export function listReleaseMails(context) {
  return releaseMail.listReleaseMails(context.root).map(releaseMail.publicReleaseMail)
}

export async function retryReleaseMail(context, id) {
  const task = releaseMail.readReleaseMail(context.root, id)
  const baselineNo = store.readBaseline(context.root, task.project)
  const version = store.readVersion(context.root, task.project, task.version)
  if (baselineNo !== task.version || version.baselineAt !== task.baselineAt) {
    throw err.conflict('RELEASE_BASELINE_CHANGED', '当前基线已变化，不能自动重试这封发版邮件', '请人工核对版本后重新正式发版')
  }
  const run = findFormalReleaseRunByMail(context.root, task)
  return sendReleaseMailTask(context, task, {
    releaseRunId: run?.id || null,
    snapshot: run?.steps.snapshot?.name || null
  })
}
```

Add these imports:

```js
import {
  findFormalReleaseRunByMail,
  markFormalReleaseStep,
  publicFormalReleaseRun
} from './formal-release-run.js'
import { readDeliverySnapshot } from './delivery-snapshots.js'
```

Copy `#sendReleaseMailTask` to a private module function with this signature:

```js
async function sendReleaseMailTask(
  context,
  task,
  { git = { ok: true, skipped: true }, snapshot = null, releaseRunId = null } = {}
)
```

Within its unchanged body, replace `this.root` with `context.root`, `this.wecomMcp` with `context.wecomMcp`, and `this.#deliveryForSnapshot(snapshot)` with `deliveryForSnapshot(context.root, snapshot)`.

Add the delivery lookup helpers with their current behavior:

```js
function milestoneDelivery(milestone, slug, versionNo) {
  return (milestone.deliveries || []).find((entry) =>
    entry.project === slug && entry.version === versionNo) || null
}

function deliveryForSnapshot(root, snapshotName) {
  const snapshot = readDeliverySnapshot(root, snapshotName)
  const milestone = milestones.readMilestone(root, snapshot.milestone)
  return milestoneDelivery(milestone, snapshot.project, snapshot.version)
}
```

- [ ] **Step 2: Delegate the two public `Hub` mail methods**

Replace them with:

```js
listReleaseMails() {
  return readFormalReleaseMails(this.#formalReleaseContext())
}

async retryReleaseMail(id) {
  this.#assertWritable('重试发版邮件')
  return retryFormalReleaseMail(this.#formalReleaseContext(), id)
}
```

Keep `#sendReleaseMailTask` and `#deliveryForSnapshot` in `service.js` during this intermediate commit because `#formalRelease` still calls them. Task 4 removes the originals after the orchestration caller moves.

- [ ] **Step 3: Run mail-focused tests**

Run:

```bash
node --test test/release-mail.test.js test/release-mail-api.test.js
```

Expected: PASS. Specifically, mail failure remains pending, retry sends only mail, duplicate sends remain idempotent, and public payloads contain no internal recipient identifiers.

- [ ] **Step 4: Commit the mail extraction**

```bash
git add src/core/formal-release-service.js src/core/service.js
git commit -m "refactor: move formal release mail workflow"
```

## Task 4: Extract the formal-release orchestration and delivery transition

**Files:**
- Modify: `src/core/formal-release-service.js`
- Modify: `src/core/service.js:640-660`
- Modify: `src/core/service.js:1487-1678`
- Modify: `src/core/service.js:3419-3472`
- Test: `test/release-mail.test.js:254-663`

- [ ] **Step 1: Add orchestration dependencies**

Extend the new module imports to include:

```js
import * as gitx from './git.js'
import {
  createDeliverySnapshot,
  readDeliverySnapshot,
  verifyDeliverySnapshot
} from './delivery-snapshots.js'
import {
  ensureFormalReleaseRun,
  findFormalReleaseRun,
  findFormalReleaseRunByMail,
  markFormalReleaseStep,
  publicFormalReleaseRun
} from './formal-release-run.js'
```

Keep each imported symbol listed once after merging imports from Task 3.

- [ ] **Step 2: Add the public orchestration entry point**

Implement this outer method so validation remains before lock acquisition, matching the current order:

```js
export async function formalReleaseMilestoneVersion(context, name, slug, versionNo, input = {}) {
  const item = milestones.readMilestone(context.root, name)
  const delivery = milestoneDelivery(item, slug, versionNo)
  if (item.status !== 'active' && !delivery) {
    throw err.conflict(
      'MILESTONE_FORMAL_RELEASE_STATUS_INVALID',
      `迭代「${item.name}」只有在进行中状态才能正式发版`
    )
  }
  if (item.status === 'active') {
    assertMilestoneFormalReleaseTarget(context.root, name, slug, versionNo)
  } else if (!item.items.some((entry) => entry.project === slug && entry.version === versionNo)) {
    throw err.conflict(
      'MILESTONE_FORMAL_RELEASE_OUT_OF_SCOPE',
      `${slug}/${versionNo} 不在迭代「${item.name}」的版本范围内`,
      '先核对迭代版本范围'
    )
  }
  return context.withLock(`formal-release:${name}:${slug}:${versionNo}`, () =>
    executeFormalRelease(context, name, slug, versionNo, input))
}
```

Move `#formalRelease` into the module as:

```js
async function executeFormalRelease(context, milestoneName, slug, versionNo, input = {})
```

Preserve every branch and statement order. Apply these exact substitutions:

```js
this.root                                      -> context.root
this.#milestoneDelivery(...)                   -> milestoneDelivery(...)
this.#prepareFormalRelease(...)                -> prepareFormalRelease(context, ...)
this.setBaseline(slug, versionNo)               -> context.setBaseline(slug, versionNo)
this.getVersion(slug, versionNo)                -> context.getVersion(slug, versionNo)
this.gitSyncOverride                            -> context.gitSyncOverride
this.gitSync(options)                           -> context.gitSync(options)
this.#currentGitHead()                          -> currentGitHead(context.root)
this.#completeReleaseLifecycle(...)             -> completeReleaseLifecycle(context, ...)
this.#sendReleaseMailTask(task, options)         -> sendReleaseMailTask(context, task, options)
```

- [ ] **Step 3: Move release-only delivery helpers**

Move `#currentGitHead`, `#milestoneDelivery`, and `#completeReleaseLifecycle` from `service.js` into private functions in the new module. Use these signatures:

```js
function currentGitHead(root)
function milestoneDelivery(milestone, slug, versionNo)
function completeReleaseLifecycle(context, milestoneName, slug, versionNo, snapshotName, releaseRunId)
```

Inside `completeReleaseLifecycle`, replace `this.root` with `context.root` and both `this.#log(...)` calls with `context.appendLog(...)`. Keep the requirement lifecycle transition order and audit payloads byte-for-byte equivalent.

Move the existing file-level Git helpers into the new module unchanged:

```js
function gitResultFailed(result)
function firstFailedGitStep(result)
```

- [ ] **Step 4: Delegate the public `Hub` execution method**

Replace it with:

```js
async formalReleaseMilestoneVersion(name, slug, versionNo, input = {}) {
  this.#assertWritable('正式发版')
  return runFormalRelease(this.#formalReleaseContext(), name, slug, versionNo, input)
}
```

After the public execution method delegates successfully, delete all temporary duplicate release logic from `service.js`: `#assertMilestoneFormalReleaseTarget`, `#prepareFormalRelease`, `#formalRelease`, `#sendReleaseMailTask`, `#currentGitHead`, `#milestoneDelivery`, `#deliveryForSnapshot`, `#completeReleaseLifecycle`, `validReleaseTime`, `gitResultFailed`, `firstFailedGitStep`, and `publicFormalReleasePreflight`.

- [ ] **Step 5: Run workflow characterization tests**

Run:

```bash
node --test test/release-mail.test.js test/release-mail-api.test.js
```

Expected: PASS. Verify the output includes the Git-failure resume, snapshot-failure resume, lifecycle-failure resume, mail retry, duplicate release, and recipient privacy cases.

- [ ] **Step 6: Commit the orchestration extraction**

```bash
git add src/core/formal-release-service.js src/core/service.js
git commit -m "refactor: extract formal release orchestration"
```

## Task 5: Remove obsolete imports and run complete verification

**Files:**
- Modify: `src/core/service.js:1-75`
- Verify: `src/core/formal-release-service.js`
- Verify: `src/core/service.js`

- [ ] **Step 1: Remove only imports made unused by this extraction**

Remove the `formal-release-run.js` import block from `service.js` when no symbols remain in use. Narrow the delivery snapshot import from:

```js
import { createDeliverySnapshot, readDeliverySnapshot, verifyDeliverySnapshot } from './delivery-snapshots.js'
```

to:

```js
import { readDeliverySnapshot, verifyDeliverySnapshot } from './delivery-snapshots.js'
```

Keep `release-mail.js`, `git.js`, `milestones.js`, `requirements.js`, `currentUser`, and `withMilestoneSyncLock` imports if their non-release callers still require them. Confirm each with `rg` before removal.

- [ ] **Step 2: Confirm the service boundary**

Run:

```bash
rg -n "#prepareFormalRelease\\(|#formalRelease\\(|#sendReleaseMailTask\\(|#currentGitHead\\(|#milestoneDelivery\\(|#deliveryForSnapshot\\(|#completeReleaseLifecycle\\(|publicFormalReleasePreflight\\(|validReleaseTime\\(|gitResultFailed\\(|firstFailedGitStep\\(" src/core/service.js
```

Expected: no matches.

Run:

```bash
wc -l src/core/service.js src/core/formal-release-service.js
```

Expected: `service.js` is approximately 450–500 lines shorter than the Task 1 baseline, and the new module contains the extracted workflow.

- [ ] **Step 3: Run syntax and whitespace checks**

```bash
node --check src/core/formal-release-service.js
node --check src/core/service.js
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Run focused and full tests**

```bash
node --test test/release-mail.test.js test/release-mail-api.test.js
npm test
```

Expected: all focused and full tests pass with zero failures.

- [ ] **Step 5: Build the frontend contract consumer**

Run:

```bash
cd web && npm run build
```

Expected: Vite build exits 0. Existing bundle-size warnings are acceptable; new errors are not.

- [ ] **Step 6: Review scope and commit cleanup**

Run:

```bash
git diff --stat
git status --short
```

Expected: implementation changes are limited to `src/core/formal-release-service.js` and `src/core/service.js`; unrelated pre-existing changes remain untouched.

If cleanup changed either implementation file, commit it:

```bash
git add src/core/formal-release-service.js src/core/service.js
git commit -m "refactor: finalize formal release service boundary"
```

If there is no cleanup diff after Task 4, do not create an empty commit.
