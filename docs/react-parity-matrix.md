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

## Legacy API Reference Audit

```bash
rg -o "api\.[A-Za-z0-9_]+" web/src/App.vue web/src/views web/src/components web/src/store.js --glob '*.vue' --glob '*.js' | sed 's/.*api\.//' | sort -u
rg -o "api\.[A-Za-z0-9_]+" web/src/main.tsx web/src/pages web/src/components web/src/services web/src/utils --glob '*.tsx' --glob '*.ts' --glob '*.js' | sed 's/.*api\.//' | sort -u
```

2026-08-25: legacy source 106 unique API names; active React 65 unique API names; raw counts include unreachable legacy code.
