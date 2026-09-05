# v0.7.4 Delivery and Acceptance Implementation Plan

> Execution continues in the authorized upgrade task. Implement and verify each unit before integrating the next; the parent goal remains v0.7.5.

**Goal:** Deliver immutable release evidence, configurable multi-role acceptance, feedback gates and manually confirmed external completion.

**Architecture:** Keep file storage and the existing Hub/API boundaries. Freeze acceptance rules and release materials in delivery snapshots, append one file per acceptance decision, and derive current acceptance from those records. Reuse the existing remote sync queue for platform writes; use a dedicated release-run record for baseline/Git/snapshot/mail recovery.

**Tech Stack:** Node.js ES modules and node:test, JSON/Markdown repository storage, React/Ant Design, existing Assess Task adapter.

**Source:** `docs/superpowers/specs/2026-09-04-v0-7-1-to-v0-7-5-product-upgrade-design.md`, sections 5.4, 6, 7, 9, 11–17.

## 0. Preserve the v0.7.3 baseline

- [ ] Finish the 0.7.3 browser smoke and outstanding review evidence before claiming its release gate complete.
- [ ] Keep user regression artifacts out of commits. Version manifests remain unchanged until release verification.

```sh
node --test
npm run build:web
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/smoke-v073.mjs
git diff --check
```

## 1. Acceptance rules and aggregation

Files: create `src/core/acceptance-rules.js`, `test/acceptance-rules.test.js`.

```js
normalizeAcceptanceRules(undefined)
// { roles: [{id:'product',name:'产品',required:true},
// {id:'development',name:'研发',required:true},
// {id:'qa',name:'测试',required:true}], rule:{type:'all-required'} }
aggregateAcceptance(rules, records, { blockingFeedback: 0 })
// { status, ready, roles, blockers }
```

- [ ] Reject invalid/duplicate roles, unsupported rules, missing required roles and malformed decisions.
- [ ] Latest valid record per role wins. Resolve equal timestamps deterministically by record ID.
- [ ] Any required rejection fails acceptance; required pending or open conditions prevent passing. Optional decisions never block.
- [ ] Waivers require a reason. Conditional approval needs every condition closed. Unresolved blocking feedback prevents passing.
- [ ] Verify input immutability and every aggregation branch with `node --test test/acceptance-rules.test.js`.

## 2. Schema 5 and project rules

Files: `src/core/repo.js`, `migrate.js`, `service.js`, `json.js`, `test/migrate.test.js`, `test/projects-api.test.js`.

- [ ] Add `project.acceptance` defaults, milestone `deliveries: []`, and distinguish legacy snapshots without inventing historical evidence.
- [ ] Add schema 4→5 migration using the existing metadata backup and whole-chain rollback. Validate snapshot and acceptance references before advancing the schema.
- [ ] Reject symlinked metadata paths; preserve HTML, version specs, requirement specs and attachments byte-for-byte.
- [ ] Expose validated rules through project reads/writes. Historical snapshots retain their copied rules after project settings change.

```sh
node --test test/migrate.test.js test/metadata-backup.test.js test/project-api.test.js
```

## 3. Immutable delivery materials

Files: add `src/core/delivery-snapshots.js`, `test/delivery-snapshots.test.js`; integrate `snapshots.js` and the formal release service.

```js
createDeliverySnapshot(root, { milestone, project, version, releaseCommit })
readDeliverySnapshot(root, name)
verifyDeliverySnapshot(root, name)
```

- [ ] Derive identity from the release and reject mismatched repeated requests.
- [ ] Copy version specification, changelog, requirement metadata/specifications and acceptance rules. Include HTML/attachment hashes and preserve retrievable released bytes.
- [ ] Write snapshots exclusively, without update/delete endpoints. Verify overall content hash and individual material integrity.
- [ ] Refuse legacy snapshots as acceptance evidence. Show current feedback separately from immutable release contents.

## 4. Append-only decisions and feedback

Files: add `src/core/acceptances.js`, `delivery-feedback.js` and corresponding tests; extend `store.js`, `service.js`, `routes.js`.

- [ ] Append decisions under `acceptances/<snapshot>/<record-id>.json`; derive actor/time/ID server-side and bind each decision to the snapshot hash and frozen role definition.
- [ ] No decision edit/delete route. Revisions are new records; condition closure also creates a new decision.
- [ ] Persist feedback against a delivery snapshot with blocker/important/normal severity. Resolve with actor, timestamp and reason; preserve history.
- [ ] Validate all bodies and references; preserve read-only access and reject writes in LAN/mirror/Git read-only modes.

```text
GET/PUT /api/projects/:slug/acceptance-rules
GET /api/snapshots/:name/acceptance
POST /api/snapshots/:name/acceptances
GET/POST /api/snapshots/:name/feedback
POST /api/snapshots/:name/feedback/:id/resolve
```

## 5. Release continuation and lifecycle

Files: add `src/core/formal-release-run.js` and tests; extend formal release methods in `service.js` and lifecycle modules.

- [ ] Persist the sequence: preflight → baseline → Git → immutable snapshot → notification → external preview → local completion.
- [ ] Verify completed artifacts before retry; no repeated baseline, snapshot, mail or external create after partial failure.
- [ ] Git failure prevents snapshot and delivery-state writes. Later failures retain the snapshot and resume at the incomplete step.
- [ ] Delivered requirements enter pending-acceptance; required rejection returns them to developing. Record all transitions with evidence and actor.
- [ ] A multi-project milestone becomes delivered only after all scoped project versions have release snapshots.

## 6. Manual external completion and archive gates

Files: milestone planner/executor, acceptance aggregation, service/routes and relevant sync tests.

- [ ] Generate delivery/status previews using managed fields and frozen snapshot evidence.
- [ ] Complete acceptance locally when its frozen rule and feedback gates pass; separately show external write progress.
- [ ] Archive requires all deliveries accepted, no blocking feedback, verified external task closure and verified Sprint end.
- [ ] Use explicit manual confirmation, plan/source hashes, revisions, locks, read-back and audit. Preserve partial successes and safe recovery.
- [ ] Cancellation remains manual. No automatic worker is activated in v0.7.4.

## 7. User-facing workflow

Files: project settings, delivery detail, requirement detail, milestone detail, formal release dialog and API types.

- [ ] Edit roles/required roles in project settings.
- [ ] Show immutable material integrity, acceptance matrix/history and blocking feedback in delivery detail.
- [ ] Expose release continuation and the next valid action in milestone detail. Add delivery/acceptance summaries to requirements.
- [ ] All error states retain local evidence; disabled actions explain the actual unsatisfied gate.
- [ ] Verify the complete workflow at 1440×900 and 390×844, including read-only navigation and writes denied.

## 8. Release verification

- [ ] Tests cover default/custom roles, rejection, waiver, conditional completion, blockers, cross-project aggregation and append-only history.
- [ ] Inject a failure after every release and archive step; prove retries never replay completed side effects.
- [ ] Verify initialization, migration, rollback, offline reading and old snapshot compatibility.
- [ ] Run full tests/build and product/security review, update STORAGE/MCP documentation and CHANGELOG, and record the evidence.
- [ ] Only after manual acceptance/release/archive works end-to-end, implement v0.7.5 qualification, automatic synchronization, health reporting and recovery.
