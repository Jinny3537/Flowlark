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

## Legacy API Reference Audit

```bash
rg -o "api\.[A-Za-z0-9_]+" web/src/App.vue web/src/views web/src/components web/src/store.js --glob '*.vue' --glob '*.js' | sed 's/.*api\.//' | sort -u
rg -o "api\.[A-Za-z0-9_]+" web/src/main.tsx web/src/pages web/src/components web/src/services web/src/utils --glob '*.tsx' --glob '*.ts' --glob '*.js' | sed 's/.*api\.//' | sort -u
```

2026-08-25: legacy source 106 unique API names; active React 65 unique API names; raw counts include unreachable legacy code.
