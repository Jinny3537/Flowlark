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
- Formal release creation of delivery snapshots is covered by the focused release/API tests below; the browser smoke now covers delivery detail, requirement delivery summaries and the delivered-to-external-completion continuation UI.
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
- Delivery completion now has a dedicated service/API wrapper: it blocks until frozen delivery evidence passes local acceptance, then reuses the sync queue to preview managed task status updates and Sprint end execution with plan hash, revision, lock, read-back and audit protection.
- Milestone detail now routes the delivered-but-not-externally-closed state to the delivery-completion plan, and requirement detail shows delivery snapshot, acceptance and external read-back summaries from response-layer derived data. Browser smoke verifies the route and action at 1440×900 and 390×844.
- Milestone archive is now gated by every scoped delivery snapshot passing acceptance, all scoped requirements being `completed`, a verified ended external Sprint status, and verified closed external task statuses.
- Git synchronization now treats `requirements`, `milestones`, `snapshots`, `acceptances` and `views` as Flowlark-owned paths. This is required for release commits to contain the milestone scope and requirement specifications used by immutable delivery snapshots.
- Verified focused release, acceptance, archive, delivery-completion, lifecycle and sync-recovery runs: 19/19, 23/23, 55/55, 28/28, 71/71 and 67/67 passed.
- Snapshot write failure now preserves completed baseline/Git evidence and retries without replaying either step. Lifecycle failure after snapshot preserves the frozen snapshot evidence and retries without replaying baseline, Git or snapshot work. Delivery-completion remote failure now preserves the closed task and resumes Sprint end without closing the task a second time.
- Full suite after formal release integration, delivery-completion wrapper, archive gate and recovery hardening: 690/690 passed, zero failures.
- `npm run build:web` passed. Existing dependency audit notices (one moderate, one high) and Vite bundle-size warning remain.

```sh
node --test test/release-mail.test.js test/release-mail-api.test.js test/acceptances.test.js
node --test
npm run build:web
git diff --check
```

Remaining v0.7.4 scope:

- Failure injection covers Git, snapshot and mail for formal release, plus delivery-completion remote recovery and existing sync-center step recovery. Archive gate failures are covered as blocking validations; product/security review still needs a final pass before v0.7.5 qualification.

## v0.7.5 requirement-pool MCP configuration foundation

- v0.7.5 scope was narrowed to the updated requirement-pool integration route: import a platform-provided configuration JSON before expanding automatic write-back.
- Requirement-pool manifests now have a server/capability preview and import path that validates `manifestVersion`, platform/server identifiers, HTTP/SSE endpoint URL, required requirement tools (`test`, `search`, `get`) and secret handling.
- Inline plaintext secrets in secret fields, Authorization headers and URL credentials are rejected. Missing field/status mappings remain warnings because they degrade the integration to raw read-only references instead of corrupting data.
- Import writes the existing `mcp.json` structure only: a MCP server plus the built-in `requirements` capability with platform, field, status and safety metadata under capability options.
- HTTP endpoints expose the same rules at `/api/mcp/requirement-pool/inspect` and `/api/mcp/requirement-pool/import`; `/api/mcp/requirement-pool/status` reports configured platform, bound server, required tools, missing local secrets, warnings and optional read-only connection-test results.
- MCP Center now has a minimal paste-and-preview UI for requirement-pool configuration JSON. It shows platform/server/tool/secrets summary, blockers and warnings, imports only when the preview is not blocked, and provides a separate integration status/connection-test check.
- Formal delivery snapshots now freeze requirement-pool source summaries (`code`, title, provider, external key, URL, status and sync time) alongside scoped requirements, so accepted delivery evidence can be traced back to the imported external requirement object.
- Delivery Detail now shows the frozen requirement source list for formal deliveries, with local/external source tags, external ID, sync time and source URL when available.
- Focused verification for MCP config import, existing requirement MCP search/import/comment, HTTP routing and UI manifest parsing: 51/51 passed.
- Focused verification for requirement-pool status diagnostics, missing local secret gating, HTTP status routing and MCP Center parsing: 53/53 passed.
- Focused verification for delivery snapshot source freezing and formal release mail flow: 24/24 passed.
- Full suite after the requirement-pool configuration foundation, MCP Center import UI, delivery source freezing and integration diagnostics: 698/698 passed, zero failures.
- `npm run build:web` passed. Existing dependency audit notices (one moderate, one high) and Vite bundle-size warning remain.

This does not complete real platform acceptance. A real v0.7.5 exit still requires a sample platform JSON, credentials entered locally, connection test, requirement list/detail pull, manual version association and delivery snapshot evidence against a test requirement pool.
