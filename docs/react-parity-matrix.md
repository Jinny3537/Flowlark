# React Parity Matrix

Status values: `verified`, `gap`, `delete-unreachable`.

| Area | Reachable Vue behavior | API / boundary | React target | Initial status |
|---|---|---|---|---|
| Shell | navigation, quick create, Ctrl/Cmd+K, notification detail/retry, runtime/read-only/LAN/update status | health, notifications, update check | AppShell | gap |
| Git | doctor, initialize, identity, permission refresh, sync, conflict choose/mark/continue/abort, brief | git/* | GitDrawer | gap |
| Projects | list and create projects | projects | Projects | verified |
| Versions | list/filter/detail, create from file/paste/URL, inspect dependencies, impact suggestion | versions, import, impact | ProjectVersions + NewVersionDialog | gap |
| Workbench | preview/edit/spec/change/requirement/tag/attachment/feedback/history/offline/review/baseline | versions/* | VersionWorkbench | verified |
| Compare | version/version and prototype/system comparison with URL restoration | preview + cumulative | Compare | verified |
| Search | current/all workspaces, saved views, structured filters, object routing | search, workspace-search, views | Search | gap |
| Requirements | create/filter, external search/import/sync/token | requirements + integrations/requirements | Requirements | gap |
| Requirement detail | edit, export, linked-version navigation | requirement + export | RequirementDetail | gap |
| Milestones | create, optional sync, bulk sync | milestones + sync | Milestones | gap |
| Milestone detail | add/remove scope item, export, external sync | milestone + export | MilestoneDetail | gap |
| Deliveries | create snapshot, notification retry, webhook test/save | snapshots + notifications | Deliveries | gap |
| Delivery detail | frozen snapshot detail | snapshots | DeliveryDetail | verified |
| Watch inbox | show errors, open archived version, retry failed item | watch/inbox | WatchInbox | gap |
| Trash | restore deleted version | trash + restore | Trash | gap |
| Settings | schema config, LAN, Git remote | config + lan + git/remote | Settings | verified |
| Workspaces | register, clone, remove, rebuild index | workspaces + workspace-index | Settings/WorkspaceSection | gap |
| Software update | status, fetch, dirty guard, pull, restart notice | update/software | Settings/SoftwareUpdateSection | gap |
| Operation log | paginated semantic actions | oplog | Settings/OperationLog | gap |
| MCP | service CRUD, secret set/delete, capability CRUD/test | mcp/* | Settings/McpSection | gap |
| Setup wizard | no route or production entry | drafts/version | none | delete-unreachable |

## Task 5 Verification Evidence

2026-08-25:

- `node --test web/src/components/gitModel.test.js`: 3 tests passed, covering doctor/conflict stage precedence, application and remote read-only guards, and all four sync labels.
- `cd web && npm run build`: production build passed; only the existing chunk-size warning remains.
- Code-path review confirms the React shell now exposes Ctrl/Cmd+K, notification detail/retry, explicit online/read-only/LAN/version/update labels, cached/quick/full Git status wording, and all planned Git assistant API actions.
- Remaining manual verification: exercise all four state groups (`no-git`, `no-repo`, missing identity, and conflict-or-ready) against fixtures or mocked responses, including both the conflicted and ready subpaths, clipboard denial, and notification retry failure. Shell and Git therefore remain `gap`; they must not be changed to `verified` until this evidence is recorded.

## Task 6 Verification Evidence

2026-08-25:

- `node --test web/src/components/newVersionModel.test.js`: 3 tests passed, covering `.html` / `.htm` acceptance, extension and byte-limit rejection, UTF-8 source size summaries, and external-dependency counts.
- `cd web && npm run build`: production build passed; only the existing chunk-size warning remains.
- Code-path review confirms one React `NewVersionDialog` now serves both the shell and the project-fixed version entry. It covers file reads plus `inspectHtml`, paste inspection on blur and submit, server-side URL import, dependency disclosure, change and requirement editors, impact suggestions, filtered create payloads, created-version routing/selection, and API-error handling that leaves the dialog and draft open.
- Remaining UI verification: exercise file, paste, and public-URL imports in a browser; invalid extension, oversized file, invalid HTML, and import failure; dependency-list expansion; impact results and the no-result state; successful creation from both entries; and save-failure draft retention at desktop and 390px widths. Versions therefore remains `gap` until this evidence is recorded.

## Task 7 Verification Evidence

2026-08-25:

- `node --test web/src/pages/searchModel.test.js`: 3 tests passed, covering cross-workspace normalization, requirement/milestone/version/project routing, URL encoding, and safe fallback when result identifiers are missing.
- `node --test test/search.test.js test/requirements.test.js test/views.test.js test/mcp-config.test.js test/workspace-index.test.js`: 33 focused contract tests passed for search, requirement data, saved views, MCP requirement operations, and cross-workspace indexing.
- `cd web && npm run build`: production build passed; only the existing chunk-size warning remains.
- Code-path review confirms current and cross-workspace search, project/requirement/milestone/field filters, saved-view create/apply behavior, cross-workspace source disclosure and navigation guard, full local requirement creation fields, MCP token/search/import/sync actions, requirement editing/export, read-only guards, linked-version navigation, and operation errors that preserve open forms and drafts.
- Remaining UI verification: exercise current and cross-workspace result sets against a built workspace index; create and reapply both current and cross-workspace saved views; confirm the foreign-workspace source notice; exercise every structured filter; create a requirement and force a save failure to confirm draft retention; use a configured MCP provider to save a token, search, import, and sync including partial failure counts; edit and export a requirement; open each linked version; and check the three pages at desktop and 390px widths. Search, Requirements, and Requirement detail therefore remain `gap` until this evidence is recorded.

## Task 8 Verification Evidence

2026-08-25:

- `node --test web/src/pages/milestoneModel.test.js`: 2 tests passed, covering persisted scope-field normalization and exact item removal.
- `node --test test/milestones.test.js test/v04-api.test.js test/mcp-config.test.js`: 8 focused contract tests passed for milestone validation and warnings, HTTP creation, and MCP pull/push synchronization.
- `cd web && npm run build`: production build passed; only the existing chunk-size warning remains.
- Code-path review confirms create with optional post-create sync, a payload that excludes the UI-only `syncExternal` field, bulk sync counts, read-only guards, requirement/project/version scope selection, draft-preserving operation errors, warning text, linked workbench navigation, add/remove writes, export, and single-milestone sync.
- Remaining UI verification: exercise create with and without synchronization; bulk synchronization with both success and partial-failure results; add/remove using real requirement, project, and version data; export and single synchronization; operation failures with retained modal drafts; read-only disabled states; and both pages at desktop and 390px widths. Milestones and Milestone detail therefore remain `gap` until this evidence is recorded.

## Task 9 Verification Evidence

2026-08-25:

- React code-path review confirms delivery snapshot creation and notification-queue retry remain available with write guards and explicit failures; notification settings now support the backend's canonical `wecom`, `dingtalk`, and `slack` providers, password-style Webhook entry, test and save actions, and failure-retained form input.
- React code-path review confirms the watch inbox uses `WATCH_STATUS`, renders filename/project/suggested version/error/collection time, navigates archived items to the version workbench, and exposes a write-aware failed-item retry with an explicit operation error.
- React code-path review confirms trash restoration requires confirmation, explains the restored editing state, reports failures without removing the retained item, reloads only after success, and is disabled in read-only mode.
- `node --test test/notifications.test.js test/watch.test.js test/rules.test.js`: 43 tests passed, covering all three notification providers, pending retry retention, watch inbox failure details, trash restore, conflict refusal, and restored content.
- `node --test web/src/domain/status.test.js`: 3 tests passed, including canonical watch labels and readable unknown-state fallback.
- `cd web && npm run build`: production build passed; only the existing chunk-size warning remains.
- Remaining browser verification: exercise snapshot success/failure draft retention; notification test/save success and failure, saved-value clearing, partial retry failures, and read-only states; archived watch navigation plus retry success/failure/read-only states; trash confirmation plus restore success/failure item retention/read-only states; and all three pages at desktop and 390px widths. Deliveries, Watch inbox, and Trash therefore remain `gap` until this evidence is recorded.

## Task 10 Verification Evidence

2026-08-25:

- React code-path review confirms workspace registration and cloning share one validated, draft-preserving form; the mirror choice sends the backend's canonical `mode` value; remove requires confirmation; rebuild reports the returned record count; and all workspace writes are disabled in read-only mode.
- React code-path review confirms software status loads on mount, remote refresh uses the same loader, availability and dirty state are both shown in text, pull is disabled when unavailable, dirty, read-only, or applying, and the pull request runs only after confirmation. Operation failures use the Ant Design `App` message context.
- React code-path review confirms `/settings/oplog` renders the semantic action mapping, absolute time, actor, project, detail, retryable load error, 20-row pagination, and 760px horizontal table scroll. The existing `/oplog` compatibility redirect targets this section.
- `node --test test/workspaces.test.js test/setup.test.js test/workspace-index.test.js test/updater.test.js test/admin.test.js test/rules.test.js`: 79 focused backend tests passed, covering registration/removal, setup registration, cross-workspace indexing without repository writes, update status and fast-forward pull, and operation-log persistence/semantics.
- `node --test web/src/domain/status.test.js`: 3 tests passed, including semantic operation-label/color mapping and unknown-action fallback.
- `cd web && npm run build`: production build passed; only the existing chunk-size warning remains.
- Backend contract note: workspace registration consumes `mode: "mirror" | "normal"` rather than a lone `mirror` boolean, while workspace-index rebuild returns `{ builtAt, records }` and no index-file path. The React implementation follows those actual shapes and reports `records.length`.
- Remaining browser verification: exercise existing registration, clone, remove, rebuild, API-failure draft retention, and read-only controls against disposable workspaces; exercise update fetch, dirty guard, confirmation, failed pull, and successful fast-forward pull against a disposable software clone; inspect operation-log retry, empty data, and more than 20 rows; and check all three sections at desktop and 390px widths. Workspaces, Software update, and Operation log therefore remain `gap` until this evidence is recorded.

## Task 11 Verification Evidence

2026-08-25:

- `node --test web/src/pages/settings/mcpModel.test.js`: 3 tests passed, covering server/header round trips, rejection of non-object request-header JSON, and normalized capability tool mappings.
- `node --test test/mcp-config.test.js`: 5 focused backend tests passed for requirement and milestone validation/integration plus extension capability save, test, and delete behavior.
- `cd web && npm run build`: production build passed; only the existing chunk-size warning remains.
- Browser verification against a disposable real Flowlark workspace and local MCP fixture confirmed invalid header JSON is announced inline while service drafts remain intact; service add/edit and ID locking; requirement and milestone save/test with returned identities; missing-server save errors, disabled-server test errors, and extension-save errors with retained drafts; extension add/test with stable action names; empty password-style secret fields that never echo configuration data; visible service/extension deletion confirmation text; mirror-mode read-only disabling for service, capability, test, and delete actions; no console warnings/errors; and no page-level horizontal overflow at 390px.
- React code-path review confirms service and extension removal require confirmation; secret save/delete never render an API return value and clear the input only after success; all API/JSON failures retain their form values; and server options include disabled-state text rather than relying on color alone.
- Remaining browser verification: execute service and extension deletion through their confirmation dialogs; set and delete a disposable macOS Keychain secret, including failure retention; force service-save, capability-save, extension-save, removal, and initial-load API failures; and confirm the resulting retry states. MCP therefore remains `gap` until this evidence is recorded.

## Legacy API Reference Audit

```bash
rg -o "api\.[A-Za-z0-9_]+" web/src/App.vue web/src/views web/src/components web/src/store.js --glob '*.vue' --glob '*.js' | sed 's/.*api\.//' | sort -u
rg -o "api\.[A-Za-z0-9_]+" web/src/main.tsx web/src/pages web/src/components web/src/services web/src/utils --glob '*.tsx' --glob '*.ts' --glob '*.js' | sed 's/.*api\.//' | sort -u
```

2026-08-25: legacy source 106 unique API names; active React 65 unique API names; raw counts include unreachable legacy code.
