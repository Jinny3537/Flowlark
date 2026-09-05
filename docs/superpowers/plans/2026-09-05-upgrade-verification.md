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
- `/api/mcp/requirement-pool/template` now returns the canonical starter manifest contract with HTTP transport, required tool mappings, field/status mappings, explicit read-only safety and keychain secret placeholders only. The template itself passes manifest preview validation and contains no plaintext token.
- `/api/mcp/requirement-pool/schema` now returns the JSON Schema contract for platform teams and integrators, covering manifest version, platform identity, HTTP/SSE transport, required tools, field/status maps, secret declarations and read-only safety.
- MCP Center now has a minimal file-or-paste preview UI for requirement-pool configuration JSON. It can load the canonical starter template, links to the JSON Schema contract, validates uploaded JSON file type and a 256KB size limit, shows platform/server/tool/secrets summary, blockers and warnings, imports only when the preview is not blocked, and provides a separate integration status/connection-test check.
- Requirement-pool status now provides inline local secret entry for each missing `${secret:name}` placeholder. Saving uses the existing local MCP server secret endpoint keyed by the placeholder name, so the credential remains machine-local and does not depend on the currently edited service form.
- Formal delivery snapshots now freeze requirement-pool source summaries (`code`, title, provider, external key, URL, status and sync time) alongside scoped requirements, so accepted delivery evidence can be traced back to the imported external requirement object.
- Delivery Detail now shows the frozen requirement source list for formal deliveries, with local/external source tags, external ID, sync time and source URL when available.
- External requirements can now be refreshed one by one from the requirement pool. A failed refresh preserves local data and records a redacted `external.syncStatus=failed` failure with code, message, hint and attempt time; the requirement list and detail page surface that state.
- The requirement sync endpoint now supports list refresh through `/api/requirements/sync` with `mode: list`, using the configured requirement-pool search/list result to create new local external requirement references and update existing ones.
- The Requirements page now exposes this path as “刷新需求池列表”, returning created/updated/failed counts instead of only refreshing requirements that were already imported locally.
- Full-list refresh now marks existing external requirements that disappear from the returned requirement-pool list as unavailable, preserving the local record and surfacing `REQUIREMENT_REMOTE_MISSING` instead of deleting or silently treating it as synchronized.
- Existing-requirement batch refresh now keeps `failed[].code` as the requirement code and reports the integration problem separately as `failed[].errorCode`, so callers can identify both the affected requirement and the cause.
- Requirement Detail now provides a direct “关联版本” action that selects an existing project/version and calls the existing requirement-link API. The linked version stores a reference to the requirement code while the requirement record keeps its requirement-pool source metadata as the authority.
- Requirement Detail now also exposes a direct “加入迭代” action from the milestone membership section. It routes to the existing editable milestone selection flow with the current requirement preselected, so imported requirement-pool items can be organized into an iteration without duplicating the external requirement as local master data.
- The real-platform smoke harness now derives required local credential environment variable names directly from normalized header placeholders such as `${secret:name}`. When `FLOWLARK_V075_SECRET_NAME` is present, the harness injects a temporary `${env:...}` reference into its disposable repository, so secret values are not written to `mcp.json` and the script does not depend on platform-specific keychain writes.
- The real-platform smoke harness now reports missing header credentials as actionable environment variable names, so a failed probe caused by `${secret:name}` tells the operator to set the matching `FLOWLARK_V075_SECRET_NAME` instead of returning an empty blocker summary.
- The real-platform smoke harness now supports `--inspect-only`, which validates the manifest contract and secret placeholder normalization without starting a Flowlark server or connecting to the external requirement pool.
- `scripts/smoke-v075-mcp-ui.mjs` now defines a browser smoke for the MCP Settings requirement-pool path: template load, manifest preview/import, missing secret UI, environment-secret connection probe, page errors and desktop/mobile overflow. It intentionally does not click the Keychain save action, to avoid writing secrets to the operator machine during smoke verification.
- The Requirements import dialog now routes “打开集成配置” directly to `/settings/mcp`, and the MCP UI smoke includes that entrypoint so users do not land on the generic workspace settings page when setup is required.
- The Requirements import dialog now provides the default v0.7.5 configuration path itself: load a template, paste or choose a requirement-pool manifest JSON, preview blockers/warnings and import the MCP configuration before searching external requirements. The MCP Center remains the advanced settings and diagnostics path.
- `package.json` now exposes `smoke:v075:requirement-pool` and `smoke:v075:mcp-ui` so the real-platform and browser acceptance harnesses are discoverable through npm scripts.
- Focused verification for MCP config import, existing requirement MCP search/import/comment, HTTP routing and UI manifest parsing: 51/51 passed.
- Focused verification for requirement-pool status diagnostics, missing local secret gating, HTTP status routing and MCP Center parsing: 53/53 passed.
- Focused verification for delivery snapshot source freezing and formal release mail flow: 24/24 passed.
- Focused verification for single external requirement refresh, unreachable remote persistence, HTTP route and list projection: 42/42 passed.
- Focused verification for requirement-pool list refresh, remote-missing marking, batch failure payloads and source projection: 10/10 passed.
- Focused verification for requirement-pool manifest file validation and MCP settings model parsing: 7/7 passed.
- Focused verification for requirement-pool template/schema generation, HTTP template/schema routing and MCP settings model parsing: 59/59 passed.
- Focused verification for imported requirement-pool demand linking into a prototype version, retaining external source authority and exercising the v0.7.5 real-platform acceptance harness against a local MCP fixture: 6/6 passed.
- Full suite after the requirement-pool configuration foundation, MCP Center import UI, delivery source freezing, integration diagnostics, single-requirement refresh, requirement-pool list refresh, remote-missing marking, manifest file selection, canonical template loading, schema publication, direct version linking and smoke harness coverage: 710/710 passed, zero failures.
- Focused verification after adding inline requirement-pool secret entry: `node --test test/mcp-config.test.js test/server.test.js test/v07-upgrade.test.js` passed 58/58 and `npm run build:web` passed.
- Full suite after adding inline requirement-pool secret entry: `node --test` passed 710/710, zero failures.
- Follow-up focused verification after adding the direct iteration-entry action: `node --test test/v07-upgrade.test.js` passed 6/6 and `npm run build:web` passed.
- Focused verification after smoke harness secret-env injection: `node --check scripts/smoke-v075-requirement-pool.mjs` passed and `node --test test/v07-upgrade.test.js` passed 7/7.
- Broader focused verification after smoke harness secret-env injection: `node --test test/mcp-config.test.js test/server.test.js test/v07-upgrade.test.js` passed 59/59.
- Full suite after smoke harness secret-env injection: `node --test` passed 711/711, zero failures.
- Focused verification after smoke harness missing-secret diagnostics: `node --check scripts/smoke-v075-requirement-pool.mjs` passed and `node --test test/v07-upgrade.test.js` passed 8/8.
- Broader focused verification after smoke harness missing-secret diagnostics: `node --test test/mcp-config.test.js test/server.test.js test/v07-upgrade.test.js` passed 60/60.
- Full suite after smoke harness missing-secret diagnostics: `node --test` passed 712/712, zero failures.
- Syntax/dependency guard verification for the MCP Settings UI smoke: `node --check scripts/smoke-v075-mcp-ui.mjs` passed; running without `PLAYWRIGHT_MODULE` exits 2 with a clear dependency message. Browser execution initially required installing Playwright in an isolated temporary directory.
- Focused verification after routing the Requirements import dialog to MCP settings: `npm run build:web` passed, `node --check scripts/smoke-v075-mcp-ui.mjs` passed and `node --test test/v07-upgrade.test.js` passed 8/8.
- Smoke script entrypoint verification: `package.json` parses, `node --check scripts/smoke-v075-mcp-ui.mjs` and `node --check scripts/smoke-v075-requirement-pool.mjs` passed, `npm run smoke:v075:requirement-pool -- --help` and `npm run smoke:v075:mcp-ui -- --help` both exit 0, and `npm run smoke:v075:mcp-ui` without `PLAYWRIGHT_MODULE` exits 2 with the documented dependency message.
- Actual MCP Settings browser smoke after installing Playwright/Chromium in `/tmp/flowlark-playwright-s3dUGW`: `PLAYWRIGHT_MODULE=/tmp/flowlark-playwright-s3dUGW/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/flowlark-playwright-s3dUGW/browsers npm run smoke:v075:mcp-ui` passed. It verified the Requirements import entrypoint, template load, manifest preview/import, missing-secret UI, env-secret connection probe, desktop/mobile layout and zero page errors. The harness now uses regex button locators and main-content text assertions to avoid Ant Design icon accessible-name and duplicate message/alert strict-mode false failures.
- Focused verification after adding the direct requirement-page configuration import: `npm run build:web` passed, `node --test test/v07-upgrade.test.js test/mcp-config.test.js web/src/pages/requirementsModel.test.js` passed 32/32, and `PLAYWRIGHT_MODULE=/tmp/flowlark-playwright-s3dUGW/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/flowlark-playwright-s3dUGW/browsers npm run smoke:v075:mcp-ui` passed with `requirements-direct-config-import`, `settings-advanced-entrypoint`, manifest preview/import, missing-secret UI, env-secret probe, desktop/mobile layout and zero page errors.
- Focused and full verification after adding npm smoke entrypoints: `npm run build:web` passed, `node --test test/v07-upgrade.test.js` passed 8/8, `git diff --check` passed and `node --test` passed 712/712, zero failures.
- README now documents the v0.7.5 requirement-pool MCP setup path, accepted secret placeholders, local secret entry, list/detail refresh behavior, frozen delivery source evidence, real-platform smoke entry and MCP settings browser smoke entry. `docs/REQUIREMENT-POOL-MCP.md` now gives platform teams the manifest contract, secret rules, tool call arguments, accepted response aliases and acceptance checklist. The stale “requirement-pool API integration is not done” README wording was replaced with the current read-only/reference boundary.
- `docs/examples/requirement-pool-manifest.example.json` now provides a copyable requirement-pool manifest, and `test/mcp-config.test.js` reads that file to verify it remains importable, warning-free and free of plaintext credentials.
- Full suite after adding the copyable requirement-pool manifest example: `node --test` passed 713/713, zero failures.
- Focused verification after adding `--inspect-only`: `node --check scripts/smoke-v075-requirement-pool.mjs` passed, `npm run smoke:v075:requirement-pool -- --manifest docs/examples/requirement-pool-manifest.example.json --inspect-only` passed, `node --test test/v07-upgrade.test.js test/mcp-config.test.js` passed 26/26, and `git diff --check` passed.
- Full suite after adding `--inspect-only`: `node --test` passed 714/714, zero failures.
- Project sync UI copy no longer promises `trusted-auto` activation in v0.7.5. It now states that unattended execution requires a later release with qualification and read-back acceptance.
- Focused verification after updating `trusted-auto` copy: `node --test web/src/pages/projectSyncModel.test.js test/sync-policy.test.js test/project-edit-api.test.js test/milestone-sync-api.test.js` passed 28/28, `node --test test/v07-upgrade.test.js` passed 8/8, `npm run build:web` passed, `git diff --check` passed, and the source grep no longer finds v0.7.5 activation promises in current UI/docs.
- Full suite after updating the `trusted-auto` copy: `node --test` passed 712/712, zero failures.
- `scripts/smoke-v075-requirement-pool.mjs` now provides the real-platform acceptance harness. Given a platform manifest and local credentials, it runs the product path in a temporary repository: manifest inspect/import, connection probe, list refresh, single detail refresh, version linking, iteration scoping and formal delivery snapshot source verification. The harness itself is covered by a local MCP fixture test.
- `npm run build:web` passed. Existing dependency audit notices (one moderate, one high) and Vite bundle-size warning remain.

This does not complete real platform acceptance. A real v0.7.5 exit still requires a sample platform JSON, credentials entered locally, connection test, requirement list/detail pull, manual version association and delivery snapshot evidence against a test requirement pool.

Run the real-platform acceptance harness only with a disposable requirement-pool project:

```sh
FLOWLARK_V075_MANIFEST=/path/to/requirement-pool.json \
FLOWLARK_V075_QUERY="safe test requirement" \
FLOWLARK_V075_SECRET_DEMAND_POOL_MCP="token-if-manifest-uses-secret" \
npm run smoke:v075:requirement-pool -- --keep
```
