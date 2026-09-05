# Upgrade verification evidence

The active objective remains v0.7.5. Passing these checks does not establish completion of v0.7.4 acceptance or v0.7.5 automation.

## v0.7.3 integration

- Previous full suite at `3fcb30b`: 622 tests passed, zero failures (prior turn output).
- Current browser run after fixing the Sync Center confirmation payload: passed at 1440×900 and 390×844.
- The browser run uses an isolated temporary repository and fake adapter, and cleans up its own data and server processes.
- Verified actual UI actions: requirement specification save, requirement confirmation, milestone freeze, and queued requirement binding execution.
- Verified read-only requirement editing/specification controls, five primary routes with no page-level horizontal overflow, and no page JavaScript errors.
- Build passed; existing dependency audit notices (one moderate, one high) and bundle-size warning remain.
- Production MCP credentials/permissions, unknown-create recovery UI, complete read-only action matrix and final security review remain separate checks. The fake adapter smoke does not establish compatibility with a live platform.

Reproduce the browser check using a local Playwright installation:

```sh
npm run build:web
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/smoke-v073.mjs
```

The previous interrupted final-review agent did not deliver a final report. Do not mark that review complete based only on its dispatch.

## v0.7.4 data foundation

- Schema 5 migration, backup, rules, committed snapshot materials, decision history and feedback/API focused run: 77/77 passed.
- Full suite after integrating the data foundation: 678/678 passed, zero failures.
- New tests prove that uncommitted edits cannot enter committed release snapshots, later project rules cannot alter historical rules, and required approvals remain blocked until blocking feedback is resolved.
- Release continuation, delivery lifecycle/remote completion integration and v0.7.5 automatic execution are not yet implemented by this foundation.

## v0.7.4 acceptance UI

- `scripts/smoke-v074.mjs` seeds a committed delivery snapshot and verifies actual browser submissions from all three required roles.
- Adding a blocking feedback item changes readiness to false; resolving it with a reason restores readiness. Both operations were performed through the UI.
- Delivery and project settings have no page-level horizontal overflow at 1440×900 and 390×844. Mirror mode disables decision and feedback writes. No page JavaScript errors were observed.
- Frozen material downloads return verified bytes as attachments, including in read-only mode. Binary attachment preservation after local deletion is covered by a storage test.
- The smoke does not yet exercise formal release creation of that snapshot; that integration remains Task 5.
- Final full test run with the acceptance UI/models and material downloads: 684/684 passed, zero failures.
- An earlier full run had two `fetch failed` errors; isolated reproduction identified `ECONNRESET` when the in-process HTTP fixture reused an idle connection after synchronous repository work. The test client now sends `Connection: close` for each request, without retries or altered business assertions. The focused file passed 18/18 before the final full run.
- Concurrent worktree changes to `src/core/milestone-sync.js` and the separate 0.8 roadmap were preserved outside this phase's commits.

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/smoke-v074.mjs
```

## v0.7.4 formal release integration

- Formal milestone release now persists a local release-run under `.flowlark/cache/formal-release-runs` and records baseline, Git, immutable snapshot, lifecycle and mail steps with resumable evidence.
- The release path creates delivery snapshots from the verified Git HEAD after baseline sync, records `milestone.deliveries`, and moves delivered requirements to `pending-acceptance`.
- Repeated release requests after the milestone becomes `delivered` are allowed only when an existing delivery snapshot proves the same project/version release. New releases from non-active milestones remain blocked.
- Mail retry now links back to the release-run, so a pending mail can complete the existing run without replaying baseline, Git or snapshot work.
- Acceptance decisions now update requirement lifecycle: all required approvals with no blocking feedback move requirements to `completed`; a required rejection moves pending requirements back to `developing`.
- Git synchronization now treats `requirements`, `milestones`, `snapshots`, `acceptances` and `views` as Flowlark-owned paths. This is required for release commits to contain the milestone scope and requirement specifications used by immutable delivery snapshots.
- Verified focused release, acceptance and lifecycle runs: 19/19 and 23/23 passed.
- Full suite after formal release integration: 685/685 passed, zero failures.
- `npm run build:web` passed. Existing dependency audit notices (one moderate, one high) and Vite bundle-size warning remain.

```sh
node --test test/release-mail.test.js test/release-mail-api.test.js test/acceptances.test.js
node --test
npm run build:web
git diff --check
```

Remaining v0.7.4 scope:

- External delivery/status preview, verified external task closure, Sprint end and archive gates are not yet implemented.
- Failure injection currently covers Git and mail for formal release. Snapshot, lifecycle and external/archive step failures still need dedicated recovery tests.
- Milestone and requirement UI summaries for formal release continuation are still incomplete.
