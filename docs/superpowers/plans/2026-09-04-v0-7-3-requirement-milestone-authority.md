# Flowlark v0.7.3 Requirement and Milestone Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flowlark the authoritative source for requirement lifecycle, project-level task-platform targeting, stable external bindings, and verified milestone freezing while retaining manual preview and confirmation for every remote mutation.

**Architecture:** Extend the existing schema, sync planner, queue, audit, and executor instead of creating a second workflow engine. Add a small requirement lifecycle domain and project sync-context resolver; feed their normalized output into the existing milestone aggregate plan. Treat freeze as a planned action that synchronizes and verifies the current remote scope before writing the local frozen state and verification fingerprint.

**Tech Stack:** Node.js 20 ESM, `node:test`, Hono-style local routes, React 19, React Router 7, Ant Design 6, Vite 5, Git-friendly JSON/Markdown/NDJSON storage, MCP stdio Assess Task adapter.

---

## Scope Guard

Implement only `v0.7.3`:

- schema 4 and explicit requirement lifecycle;
- requirement acceptance/specification editing used by confirmation preflight;
- project-level `server`, `projectId`, and `managedFields` used by milestone synchronization;
- stable task and Sprint bindings, explicit rebind, and unknown-create result linking;
- managed-field-aware drift and remote writes;
- manual aggregate creation/update/move for all requirements in a milestone;
- synchronization-backed milestone freezing;
- requirement and milestone UI needed to operate those features.

Do not implement:

- acceptance decisions, acceptance roles, feedback severity gates, or delivery-driven `pending-acceptance` transitions (`v0.7.4`);
- unattended remote execution, automatic Sprint ending, or automatic archival (`v0.7.5`);
- multiple external Sprint targets for one local milestone;
- an atomic remote batch-move operation; the existing multi-operation plan is the batch user action;
- a generic workflow engine or plugin framework;
- remote values silently overwriting Flowlark business fields.

## Fixed Decisions

1. Requirement statuses are `draft`, `confirmed`, `developing`, `pending-acceptance`, `completed`, and `archived`; only `draft → confirmed` is user-triggerable in this release, and only verified Sprint start may perform `confirmed → developing`.
2. Requirement entities store current status plus `statusChangedAt`, `statusChangedBy`, and `statusReason`; history remains append-only in the operation log, not an array in `requirement.json`.
3. Confirmation requires non-empty title, description, owner, and `requirements/<code>/spec.md`.
4. Every project in one milestone must resolve to the same `server`, `projectId`, and managed-field set. A mismatch blocks planning.
5. The selected project server controls the stdio runtime. The existing milestones capability supplies only tool names and mapping options.
6. Browser input cannot select a server, tool, operation body, actor, time, or status mapping.
7. Existing multi-requirement plan execution is the supported batch behavior; no new `tasks.move` operation kind is introduced.
8. `accept-remote` is removed from synchronization conflicts. Flowlark remains authoritative; adopting remote text requires an explicit local edit followed by a new plan. `restore-local` remains a high-risk confirmed operation.
9. Freeze becomes `plan(action: "freeze") → confirm → remote execute/read-back → local frozen`. Direct `reviewing → frozen` transition is rejected.
10. `trusted-auto` remains descriptive and cannot execute unattended.

## Success Criteria

1. Schema 1, 2, and 3 repositories reach schema 4 safely; a forced failure restores the original schema byte-for-byte.
2. Requirements default to `draft`; ordinary updates cannot mutate lifecycle fields.
3. Confirmation is impossible until title, description, owner, and specification are complete.
4. A project-level server/project target, not the global capability project, determines remote Sprint/task bindings.
5. Same-target cross-project milestones work; target or managed-field mismatches are blocked before a remote call.
6. The same remote task cannot be bound to two requirements in one server/project.
7. Unknown create results can be resolved by linking a verified remote object without replaying create.
8. Managed fields alone determine drift and update payloads; un-managed remote fields survive unchanged.
9. A milestone cannot become frozen unless the current plan is executed, remote state is read back, and a current `scopeHash` is stored.
10. Starting a verified Sprint advances included `confirmed` requirements to `developing`; failures never advance them.
11. All remote mutations remain previewed, manually confirmed, locked, audited, and hash/revision checked.
12. Full tests, production build, and 1440×900/390×844 browser smoke pass.

## File Map

### New files

- `src/core/requirement-lifecycle.js`
- `src/core/project-sync-context.js`
- `src/core/external-bindings.js`
- `test/requirement-lifecycle.test.js`
- `test/project-sync-context.test.js`
- `test/external-binding-api.test.js`
- `web/src/pages/requirementLifecycleModel.js`
- `web/src/pages/requirementLifecycleModel.test.js`
- `web/src/pages/syncOperationModel.js`
- `web/src/pages/syncOperationModel.test.js`

### Primary modified files

- `src/core/requirements.js`
- `src/core/milestones.js`
- `src/core/migrate.js`
- `src/core/repo.js`
- `src/core/json.js`
- `src/core/mcp-config.js`
- `src/core/milestone-sync-plan.js`
- `src/core/milestone-sync.js`
- `src/core/milestone-lifecycle.js`
- `src/core/service.js`
- `src/server/routes.js`
- `src/cli/cmd-requirements.js`
- `src/cli/help.js`
- `web/src/services/api.ts`
- `web/src/pages/Requirements.tsx`
- `web/src/pages/RequirementDetail.tsx`
- `web/src/pages/MilestoneDetail.tsx`
- `web/src/pages/MilestoneSyncPanel.tsx`
- `web/src/pages/ActiveScopeChangeDialog.tsx`
- `web/src/pages/ProjectSyncSettings.tsx`
- `web/src/pages/SyncCenter.tsx`
- `web/src/pages/projectSyncModel.js`
- `web/src/pages/milestoneSyncModel.js`
- `web/src/pages/syncCenterModel.js`
- `web/src/styles/global.css`
- `docs/STORAGE.md`
- `docs/ASSESS-TASK-MCP.md`
- `CHANGELOG.md`

## Task 0: Verify the v0.7.2 Baseline

**Files:** inspect only.

- [x] Run `git status --short` and verify only the pre-existing `.codex-ui-regression/` and `test-results/` paths are untracked.
- [x] Run `npm test`; expect all current tests to pass with zero failures.
- [x] Run `npm run build:web`; expect success with only the existing npm-audit and bundle-size warnings.
- [x] Record `git rev-parse --short HEAD`; do not tag, publish, or change package versions.

## Task 1: Add Requirement Lifecycle and Specification Storage

**Files:**

- Create: `src/core/requirement-lifecycle.js`
- Create: `test/requirement-lifecycle.test.js`
- Modify: `src/core/requirements.js`
- Modify: `src/core/service.js`
- Modify: `src/core/json.js`
- Modify: `test/requirements.test.js`

- [x] Write failing tests for default `draft`, lifecycle normalization, invalid transitions, and confirmation blockers.
- [x] Implement these public contracts:

```js
export const REQUIREMENT_STATUSES = new Set([
  'draft', 'confirmed', 'developing', 'pending-acceptance', 'completed', 'archived'
])
export function normalizeRequirementStatus(value)
export function transitionRequirementStatus(current, target, { system = false } = {})
export function confirmationPreflight(root, requirement)
```

- [x] `transitionRequirementStatus` must allow user `draft → confirmed`, allow system `confirmed → developing`, and reject every other v0.7.3 transition with structured errors.
- [x] Add `readRequirementSpec(root, code)` and `writeRequirementSpec(root, code, markdown)` to `requirements.js`; specification writes must not mutate lifecycle state.
- [x] Make `createRequirement` ignore/reject client-supplied `status`, `statusChanged*`, `statusOverride`, `external`, and `externalTasks`; initialize lifecycle fields from server time and `currentUser()` through the Hub.
- [x] Make ordinary `updateRequirement` reject lifecycle and binding fields with `REQUIREMENT_MANAGED_FIELD`.
- [x] Add a system-only lifecycle update helper that writes current status metadata atomically and never trusts actor/time from callers.
- [x] Add stable JSON key order for lifecycle fields.
- [x] Run:

```bash
node --test test/requirement-lifecycle.test.js test/requirements.test.js test/project-edit-api.test.js
```

- [x] Commit:

```bash
git add src/core/requirement-lifecycle.js src/core/requirements.js src/core/service.js src/core/json.js test/requirement-lifecycle.test.js test/requirements.test.js
git commit -m "feat: add authoritative requirement lifecycle"
```

## Task 2: Migrate Repositories Safely to Schema 4

**Files:**

- Modify: `src/core/repo.js`
- Modify: `src/core/migrate.js`
- Modify: `test/migrate.test.js`

- [x] Add failing tests for schema 3 → 4, schema 1 → 4, unknown legacy status, injected failure, and default rollback selection.
- [x] Raise `SCHEMA_VERSION` to `4`.
- [x] Implement `migrateToSchema4(root, options)` using the existing metadata backup and top-level symlink protection.
- [x] Map legacy states exactly:

```text
statusOverride ?? deriveRequirementStatus()
not_started/designing → draft
finalized/delivered   → confirmed
unknown               → migration failure
```

- [x] Set migration metadata to `statusChangedBy: "migration:schema4"`, current migration time, and `statusReason: "legacy-derived:<value>"`; remove `statusOverride`.
- [x] Validate every lifecycle status and reject duplicate `(provider, server, projectId, taskId)` bindings across requirements.
- [x] Extend `migrateToLatest` through schema 4 and retain whole-chain rollback to the initial schema.
- [x] Change parameterless `rollbackMigration` to select the latest valid backup by manifest timestamp, not only `schema-1-*` directories.
- [x] Run:

```bash
node --test test/migrate.test.js test/metadata-backup.test.js test/admin.test.js
```

- [x] Commit:

```bash
git add src/core/repo.js src/core/migrate.js test/migrate.test.js
git commit -m "feat: migrate requirement lifecycle to schema 4"
```

## Task 3: Resolve Project-Level Synchronization Context

**Files:**

- Create: `src/core/project-sync-context.js`
- Create: `test/project-sync-context.test.js`
- Modify: `src/core/mcp-config.js`
- Modify: `src/core/service.js`
- Modify: `test/mcp-config.test.js`
- Modify: `test/milestone-sync-api.test.js`

- [x] Write failing tests for one project, same-target projects, missing target, target mismatch, managed-field mismatch, disabled/non-stdio/non-assess server, and existing Sprint target mismatch.
- [x] Implement:

```js
export function resolveProjectSyncContext(root, milestone, mcpInfo)
```

Return normalized `{server, projectId, managedFields, capability, serverConfig}` or blockers with precise `repairTo` routes.

- [x] Require all milestone projects to use the same server, project ID, and sorted managed fields.
- [x] Treat the selected project server as authoritative; never fall back silently to the capability server.
- [x] Use milestones capability only for tool names and mapping options.
- [x] Validate selected server is enabled, stdio, and `adapter === "assess-task"`.
- [x] Refactor the service adapter connection so the resolved project server/runtime and project ID drive the session and adapter.
- [x] Preserve injected adapters in tests without creating a production fallback.
- [x] Ensure browser `mapping`, `server`, `projectId`, and tool fields remain ignored.
- [x] Run:

```bash
node --test test/project-sync-context.test.js test/mcp-config.test.js test/milestone-sync-api.test.js
```

- [x] Commit:

```bash
git add src/core/project-sync-context.js src/core/mcp-config.js src/core/service.js test/project-sync-context.test.js test/mcp-config.test.js test/milestone-sync-api.test.js
git commit -m "feat: resolve project synchronization targets"
```

## Task 4: Make Managed Fields Control Plans and Writes

**Files:**

- Modify: `src/core/milestone-sync-plan.js`
- Modify: `src/core/milestone-sync.js`
- Modify: `src/core/integrations/assess-task/adapter.js`
- Modify: `test/milestone-sync-plan.test.js`
- Modify: `test/milestone-sync.test.js`
- Modify: `test/assess-task-adapter.test.js`

- [x] Add failing tests proving server, project ID, managed fields, requirement status, and remote revisions change plan hash.
- [x] Add `managedFields` and status mapping to planner input and the semantic hash.
- [x] For existing tasks compare only managed fields; preserve all remote non-managed values in update bodies.
- [x] Apply mappings:

```text
title       → task title / Sprint name
description → task description / Sprint goal
acceptance  → task acceptanceDoc
priority    → task priority
assignee    → task/Sprint owner
sprint      → task move operations
status      → task status through capability.options.statuses
delivery    → warning only in v0.7.3, no remote write
```

- [x] Block status-managed plans without an explicit mapping for every lifecycle state used by the plan.
- [x] Remove `accept-remote` planning and execution. Keep only `restore-local` for drift, marked high risk.
- [x] Keep create bodies complete enough for platform-required fields, while updates mutate only managed fields.
- [x] Keep one operation per task move; a single confirmed milestone plan remains the batch user action.
- [x] Run:

```bash
node --test test/milestone-sync-plan.test.js test/milestone-sync.test.js test/assess-task-adapter.test.js
```

- [x] Commit:

```bash
git add src/core/milestone-sync-plan.js src/core/milestone-sync.js src/core/integrations/assess-task/adapter.js test/milestone-sync-plan.test.js test/milestone-sync.test.js test/assess-task-adapter.test.js
git commit -m "feat: enforce managed synchronization fields"
```

## Task 5: Add Controlled Task and Sprint Bindings

**Files:**

- Create: `src/core/external-bindings.js`
- Create: `test/external-binding-api.test.js`
- Modify: `src/core/requirements.js`
- Modify: `src/core/milestones.js`
- Modify: `src/core/service.js`
- Modify: `src/server/routes.js`
- Modify: `test/requirements.test.js`
- Modify: `test/milestones.test.js`

- [x] Write failing tests for first bind, CAS rebind, duplicate task binding, wrong project, missing remote object, stale expected ID, and browser-supplied server/tool rejection.
- [x] Implement reverse uniqueness for `(server, projectId, taskId)` across all requirements.
- [x] Implement system-only CAS helpers:

```js
export function replaceExternalTask(root, code, binding, { expectedTaskId })
export function replaceExternalSprint(root, milestoneName, binding, { expectedSprintId })
```

- [x] Add server-owned binding preview endpoints that accept only project slug, remote ID, expected old ID, reason, and confirmation flag.
- [x] Resolve server/project from project sync context; fetch and verify the remote object before producing a high-risk queue plan.
- [x] Execute binding changes through a known `requirement` or `milestone-binding` queue entity, fixed dispatcher, hash revalidation, lock, and team audit.
- [x] Leave `lastSyncHash` empty after rebind so the next field synchronization requires `restore-local` confirmation.
- [x] Prevent ordinary requirement/milestone create/update routes from accepting binding fields.
- [x] Run:

```bash
node --test test/external-binding-api.test.js test/requirements.test.js test/milestones.test.js test/sync-center-api.test.js
```

- [x] Commit:

```bash
git add src/core/external-bindings.js src/core/requirements.js src/core/milestones.js src/core/service.js src/server/routes.js test/external-binding-api.test.js test/requirements.test.js test/milestones.test.js test/sync-center-api.test.js
git commit -m "feat: add controlled external bindings"
```

## Task 6: Resolve Unknown Create Results Without Replaying Create

**Files:**

- Modify: `src/core/service.js`
- Modify: `src/core/milestone-sync.js`
- Modify: `src/server/routes.js`
- Modify: `test/sync-center-api.test.js`
- Modify: `test/milestone-sync.test.js`

- [x] Add failing tests for paused `sprint.create` and `task.create` records linked to valid, invalid, occupied, and wrong-project remote IDs.
- [x] Add fixed endpoint:

```text
POST /api/sync/:id/link-result
{ "operationKey": "sprint:SYNC-42:create", "remoteId": 123, "reason": "人工核对平台结果" }
```

- [x] Accept only a paused milestone record and an exact step whose error is `MCP_SYNC_LINK_REQUIRED`.
- [x] Resolve the project context server-side, fetch the candidate object, validate project ownership and projection identity, and enforce binding uniqueness.
- [x] Persist the verified binding and `remoteResult`, move the step to `remote-complete`, and append before/after audit.
- [x] Require the user to press retry afterward; retry uses the stored remote result and never calls create again.
- [x] Run:

```bash
node --test test/sync-center-api.test.js test/milestone-sync.test.js test/external-binding-api.test.js
```

- [x] Commit:

```bash
git add src/core/service.js src/core/milestone-sync.js src/server/routes.js test/sync-center-api.test.js test/milestone-sync.test.js test/external-binding-api.test.js
git commit -m "feat: link uncertain remote create results"
```

## Task 7: Make Freeze a Verified Synchronization Action

**Files:**

- Modify: `src/core/milestone-sync-plan.js`
- Modify: `src/core/milestone-sync.js`
- Modify: `src/core/milestone-lifecycle.js`
- Modify: `src/core/milestones.js`
- Modify: `src/core/service.js`
- Modify: `test/milestone-lifecycle.test.js`
- Modify: `test/milestone-sync-plan.test.js`
- Modify: `test/milestone-sync.test.js`
- Modify: `test/milestone-sync-api.test.js`

- [x] Add failing tests for empty milestone, unconfirmed requirement, missing requirement spec, missing project target, mismatched targets, missing task/Sprint binding, stale local scope, remote drift, and direct freeze rejection.
- [x] Add deterministic `sourceHash` covering milestone business fields, sorted scope, requirement lifecycle/projections, stable bindings, project targets, managed fields, and Sprint ID.
- [x] Add `freeze` to normalized plan actions and append a local `milestone.freeze` operation after remote work.
- [x] Rebuild and revalidate the freeze plan under the existing milestone lock before execution.
- [x] After all remote operations and final remote read-back succeed, atomically write `external.scopeHash`, `external.verifiedAt`, and local `status: "frozen"`.
- [x] Reject direct `reviewing → frozen` with `MILESTONE_FREEZE_REQUIRES_SYNC_PLAN`.
- [x] Make freeze preflight use current source hash and project context; a historical completed journal alone is insufficient.
- [x] Give every blocker a precise repair route: requirement, version workbench, project sync settings, MCP settings, sync center, or milestone scope.
- [x] On verified Sprint start, transition included `confirmed` requirements to `developing`; failures or unknown results leave them unchanged.
- [x] Run:

```bash
node --test test/milestone-lifecycle.test.js test/milestone-sync-plan.test.js test/milestone-sync.test.js test/milestone-sync-api.test.js
```

- [x] Commit:

```bash
git add src/core/milestone-sync-plan.js src/core/milestone-sync.js src/core/milestone-lifecycle.js src/core/milestones.js src/core/service.js test/milestone-lifecycle.test.js test/milestone-sync-plan.test.js test/milestone-sync.test.js test/milestone-sync-api.test.js
git commit -m "feat: verify remote scope before freezing"
```

## Task 8: Expose Requirement Lifecycle, Specification, and Binding APIs

**Files:**

- Modify: `src/core/service.js`
- Modify: `src/server/routes.js`
- Modify: `src/cli/cmd-requirements.js`
- Modify: `src/cli/help.js`
- Modify: `web/src/services/api.ts`
- Modify: `test/v04-api.test.js`
- Modify: `test/external-binding-api.test.js`

- [x] Add fixed API routes:

```text
GET  /api/requirements/:code/confirmation-preflight
POST /api/requirements/:code/transition
GET  /api/requirements/:code/spec
PUT  /api/requirements/:code/spec
POST /api/requirements/:code/task-binding/plan
```

- [x] Route lifecycle writes through Hub methods that derive actor/time, enforce preflight, and log structured from/to/reason fields.
- [x] Reject non-object bodies safely and retain read-only LAN 403 behavior for all writes.
- [x] Add CLI commands `flowlark req confirm <code>` and `flowlark req spec <code> --edit`; both must call the same Hub methods as HTTP.
- [x] Add corresponding typed Web API methods; do not accept server/tool/operation fields.
- [x] Run:

```bash
node --test test/v04-api.test.js test/requirements.test.js test/external-binding-api.test.js test/cli.test.js
```

- [x] Commit:

```bash
git add src/core/service.js src/server/routes.js src/cli/cmd-requirements.js src/cli/help.js web/src/services/api.ts test/v04-api.test.js test/external-binding-api.test.js test/cli.test.js
git commit -m "feat: expose requirement authority workflows"
```

## Task 9: Build Requirement Lifecycle UI

**Files:**

- Create: `web/src/pages/requirementLifecycleModel.js`
- Create: `web/src/pages/requirementLifecycleModel.test.js`
- Modify: `web/src/pages/requirementsModel.js`
- Modify: `web/src/pages/requirementsModel.test.js`
- Modify: `web/src/pages/Requirements.tsx`
- Modify: `web/src/pages/RequirementDetail.tsx`
- Modify: `web/src/styles/global.css`

- [ ] Write pure model tests for lifecycle labels, separate prototype-progress labels, primary actions, external-binding states, and read-only guards.
- [ ] Requirement list columns must show lifecycle, prototype progress, milestone membership, external binding, and synchronization status without using color alone.
- [ ] Requirement detail must show one primary action: `draft → 确认需求`, `confirmed → 加入迭代`, `developing → 查看迭代`.
- [ ] Add editable acceptance/specification Markdown with inline save feedback and confirmation blockers anchored on the same page.
- [ ] Add external main-task card with current binding, remote status, last sync, drift state, preview/rebind actions, and audit link.
- [ ] Add milestone membership list and rename the existing version area to “原型进度与关联版本”.
- [ ] In read-only mode retain all inspection data and disable confirmation, editing, binding, and scope actions with visible reasons.
- [ ] At 390px use a single-column detail, full-width ≥44px actions, and no page-level horizontal overflow.
- [ ] Run:

```bash
node --test web/src/pages/requirementLifecycleModel.test.js web/src/pages/requirementsModel.test.js
npm run build:web
```

- [ ] Commit:

```bash
git add web/src/pages/requirementLifecycleModel.js web/src/pages/requirementLifecycleModel.test.js web/src/pages/requirementsModel.js web/src/pages/requirementsModel.test.js web/src/pages/Requirements.tsx web/src/pages/RequirementDetail.tsx web/src/styles/global.css
git commit -m "feat: add requirement lifecycle workspace"
```

## Task 10: Upgrade Milestone and Project Synchronization UI

**Files:**

- Create: `web/src/pages/syncOperationModel.js`
- Create: `web/src/pages/syncOperationModel.test.js`
- Modify: `web/src/pages/MilestoneDetail.tsx`
- Modify: `web/src/pages/MilestoneSyncPanel.tsx`
- Modify: `web/src/pages/ActiveScopeChangeDialog.tsx`
- Modify: `web/src/pages/ProjectSyncSettings.tsx`
- Modify: `web/src/pages/projectSyncModel.js`
- Modify: `web/src/pages/projectSyncModel.test.js`
- Modify: `web/src/pages/SyncCenter.tsx`
- Modify: `web/src/pages/syncCenterModel.js`
- Modify: `web/src/pages/syncCenterModel.test.js`
- Modify: `web/src/styles/global.css`

- [ ] Add pure operation-presenter tests for create, managed update, move in/out, restore-local drift, freeze, and link-required states.
- [ ] Replace raw operation kind/JSON summaries in milestone and active-scope dialogs with shared readable descriptions.
- [ ] Change the reviewing-stage primary action to “预览并冻结”; direct local freeze must disappear.
- [ ] Group freeze blockers by requirement, version, project target, and remote synchronization; each row has one repair link.
- [ ] Project sync settings must remove the v0.7.2 preparation copy, show connection/permission state, and explain that settings now affect plans.
- [ ] Keep `trusted-auto` visible but disabled and unsaveable; only manual mode is operational.
- [ ] Warn and invalidate outstanding previews before changing server, project ID, or managed fields.
- [ ] Sync Center must understand requirement/binding entities, drift, and link-required recovery while keeping high-risk actions non-batch.
- [ ] Preserve visible text labels, keyboard focus, ≥44px touch targets, and responsive drawers/modals.
- [ ] Run:

```bash
node --test web/src/pages/syncOperationModel.test.js web/src/pages/projectSyncModel.test.js web/src/pages/syncCenterModel.test.js web/src/pages/milestoneSyncModel.test.js
npm run build:web
```

- [ ] Commit:

```bash
git add web/src/pages/syncOperationModel.js web/src/pages/syncOperationModel.test.js web/src/pages/MilestoneDetail.tsx web/src/pages/MilestoneSyncPanel.tsx web/src/pages/ActiveScopeChangeDialog.tsx web/src/pages/ProjectSyncSettings.tsx web/src/pages/projectSyncModel.js web/src/pages/projectSyncModel.test.js web/src/pages/SyncCenter.tsx web/src/pages/syncCenterModel.js web/src/pages/syncCenterModel.test.js web/src/styles/global.css
git commit -m "feat: upgrade milestone authority workflows"
```

## Task 11: Document and Verify v0.7.3

**Files:**

- Modify: `docs/STORAGE.md`
- Modify: `docs/ASSESS-TASK-MCP.md`
- Modify: `CHANGELOG.md`
- Modify: this plan only to check completed steps.

- [ ] Document schema 4 lifecycle fields, migration mapping, specification file, controlled bindings, project sync context, managed fields, link-result recovery, and verified freeze.
- [ ] State clearly that `pending-acceptance/completed/archived` are reserved and not user-triggerable in v0.7.3.
- [ ] State clearly that `trusted-auto` remains disabled and Sprint end/archive remain manual future work.
- [ ] Run all new and affected focused tests.
- [ ] Run `npm test`; require zero failures.
- [ ] Run `npm run build:web`; require success.
- [ ] Browser-smoke at 1440×900 and 390×844:
  - create and complete a draft requirement;
  - edit its specification and confirm it;
  - configure project sync target;
  - add requirement/version to a milestone;
  - preview and execute freeze against a fake MCP server;
  - inspect managed-field changes and audit;
  - verify read-only mode disables every write action;
  - verify no console error or page-level overflow.
- [ ] Run `git diff --check main...HEAD`, inspect `git status --short`, and confirm user-owned regression artifacts remain untouched.
- [ ] Perform two-stage final review: product/spec coverage, then security/code quality.
- [ ] Commit documentation and verification notes.

## Final Review Checklist

- [ ] Schema 4 migration and rollback are proven for schema 1/2/3.
- [ ] Lifecycle status has one source of truth and ordinary edits cannot change it.
- [ ] Requirement confirmation is operable from CLI and Web.
- [ ] Project sync targets and managed fields affect the actual plan and hash.
- [ ] External bindings are verified, unique, CAS-protected, and auditable.
- [ ] Unknown create results can be linked without replaying create.
- [ ] Freeze requires current remote verification and writes a current scope fingerprint.
- [ ] Sprint start alone advances confirmed requirements to developing.
- [ ] No remote value silently overwrites Flowlark business data.
- [ ] All remote mutations remain manual, locked, hash-checked, revision-checked, and audited.
- [ ] No v0.7.4 acceptance or v0.7.5 automation behavior was introduced.
- [ ] Full tests, build, desktop/mobile smoke, and final review pass.
