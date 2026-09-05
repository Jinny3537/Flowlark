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

- [x] Reject invalid/duplicate roles, unsupported rules, missing required roles and malformed decisions.
- [x] Latest valid record per role wins. Resolve equal timestamps deterministically by record ID.
- [x] Any required rejection fails acceptance; required pending or open conditions prevent passing. Optional decisions never block.
- [x] Waivers require a reason. Conditional approval needs every condition closed. Unresolved blocking feedback prevents passing.
- [x] Verify input immutability and every aggregation branch with `node --test test/acceptance-rules.test.js`.

## 2. Schema 5 and project rules

Files: `src/core/repo.js`, `migrate.js`, `service.js`, `json.js`, `test/migrate.test.js`, `test/projects-api.test.js`.

- [x] Add `project.acceptance` defaults, milestone `deliveries: []`, and distinguish legacy snapshots without inventing historical evidence.
- [x] Add schema 4→5 migration using the existing metadata backup and whole-chain rollback. Validate snapshot and acceptance references before advancing the schema.
- [x] Reject symlinked metadata paths; preserve HTML, version specs, requirement specs and attachments byte-for-byte.
- [x] Expose validated rules through project reads/writes. Historical snapshots retain their copied rules after project settings change.

```sh
node --test test/migrate.test.js test/migrate-schema5.test.js test/metadata-backup.test.js test/acceptance-rules-api.test.js
```

## 3. Immutable delivery materials

Core storage is implemented in `delivery-snapshots.js`, covered by `delivery-snapshots.test.js`, and now integrated into formal milestone release through `formal-release-run.js`.

Files: add `src/core/delivery-snapshots.js`, `test/delivery-snapshots.test.js`; integrate `snapshots.js` and the formal release service.

```js
createDeliverySnapshot(root, { milestone, project, version, releaseCommit })
readDeliverySnapshot(root, name)
verifyDeliverySnapshot(root, name)
```

- [x] Derive identity from the release and reject mismatched repeated requests.
- [x] Copy version specification, changelog, requirement metadata/specifications and acceptance rules. Include HTML/attachment hashes and preserve retrievable released bytes.
- [x] Write snapshots exclusively, without update/delete endpoints. Verify overall content hash and individual material integrity.
- [x] Refuse legacy snapshots as acceptance evidence. Show current feedback separately from immutable release contents.

## 4. Append-only decisions and feedback

Files: add `src/core/acceptances.js`, `delivery-feedback.js` and corresponding tests; extend `store.js`, `service.js`, `routes.js`.

- [x] Append decisions under `acceptances/<snapshot>/<record-id>.json`; derive actor/time/ID server-side and bind each decision to the snapshot hash and frozen role definition.
- [x] No decision edit/delete route. Revisions are new records; condition closure also creates a new decision.
- [x] Persist feedback against a delivery snapshot with blocker/important/normal severity. Resolve with actor, timestamp and reason; preserve history.
- [x] Validate all bodies and references; preserve read-only access and reject writes in LAN/mirror/Git read-only modes.

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
- [x] Persist and resume the local sequence through baseline → Git → immutable snapshot → notification → local completion.
- [x] Verify completed artifacts before retry; no repeated baseline, Git, snapshot or mail after partial failure.
- [x] Git failure prevents snapshot and delivery-state writes. Mail failure retains the snapshot and resumes at the incomplete step.
- [x] Delivered requirements enter pending-acceptance; required rejection returns them to developing. Acceptance pass moves them to completed. Record all transitions with evidence and actor.
- [x] A multi-project milestone becomes delivered only after all scoped project versions have release snapshots.
- [x] External delivery/status preview and remote close/end continuation is handled by the delivery-completion sync wrapper in Task 6.

## 6. Manual external completion and archive gates

Files: milestone planner/executor, acceptance aggregation, service/routes and relevant sync tests.

- [x] Generate delivery/status previews using managed fields and frozen snapshot evidence.
- [x] Complete acceptance locally when its frozen rule and feedback gates pass; separately show external write progress through the sync queue.
- [x] Archive requires all deliveries accepted, no blocking feedback, verified external task closure and verified Sprint end.
- [x] Use explicit manual confirmation, plan/source hashes, revisions, locks, read-back and audit for the delivery-completion path.
- [x] Cancellation remains manual. No automatic worker is activated in v0.7.4.

## 7. User-facing workflow

Files: project settings, delivery detail, requirement detail, milestone detail, formal release dialog and API types.

- [x] Edit roles/required roles in project settings.
- [x] Show immutable material integrity, acceptance matrix/history and blocking feedback in delivery detail.
- [x] Expose release continuation and the next valid action in milestone detail. Add delivery/acceptance summaries to requirements.
- [ ] All error states retain local evidence; disabled actions explain the actual unsatisfied gate.
- [ ] Verify the complete workflow at 1440×900 and 390×844, including read-only navigation and writes denied.

## 8. Release verification

- [ ] Tests cover default/custom roles, rejection, waiver, conditional completion, blockers, cross-project aggregation and append-only history.
- [x] Tests cover default/custom roles, rejection, waiver, conditional completion, blockers, append-only history and release-driven requirement lifecycle.
- [x] Tests cover delivery-completion preview, local acceptance gate, managed task status update, Sprint end execution, read-back persistence and archive handoff.
- [ ] Inject a failure after every release and archive step; prove retries never replay completed side effects.
- [x] Injected Git and mail failures prove release retries do not replay completed baseline/Git/snapshot/mail side effects in the implemented local release sequence.
- [ ] Verify initialization, migration, rollback, offline reading and old snapshot compatibility.
- [ ] Run full tests/build and product/security review, update STORAGE/MCP documentation and CHANGELOG, and record the evidence.
- [ ] Only after manual acceptance/release/archive works end-to-end, implement v0.7.5 qualification, automatic synchronization, health reporting and recovery.
