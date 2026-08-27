# Assess Task MCP Iteration Upgrade Design

Date: 2026-08-28  
Status: Approved design; implementation not started

## 1. Goal

Upgrade Flowlark's iteration module so Flowlark remains the source of truth for iteration planning while the supplied `assess-task-mcp` server acts as the execution and collaboration endpoint.

The completed integration must support the full iteration lifecycle:

- create and update a remote sprint;
- create and update one remote task per Flowlark requirement;
- move tasks into and out of the sprint;
- start, end, and cancel the sprint;
- detect optimistic-lock conflicts through the platform `revision` field;
- resume safely after partial failure;
- read platform-owned execution state without silently overwriting it.

The first release binds one Flowlark repository to one remote platform project and maps one Flowlark iteration to one remote sprint.

## 2. Decisions

1. **Flowlark is authoritative.** Iteration scope, planned dates, goal, requirement content, prototype versions, and delivery materials originate in Flowlark.
2. **The target platform is the execution endpoint.** Task execution status, actual time, work logs, comments, bugs, and activity history remain platform-owned.
3. **Use an in-process stdio MCP client.** Flowlark will adopt the official TypeScript MCP client instead of requiring a separate HTTP bridge.
4. **Raise the runtime floor to Node.js 20.** Flowlark currently declares Node.js `>=18.17`; the official MCP TypeScript client 2.x requires Node.js 20 or newer.
5. **Keep transport and platform semantics separate.** A generic MCP client manager owns protocol and process lifecycle. A dedicated `assess-task` adapter owns project, sprint, task, enum, and `revision` behavior.
6. **Preview every remote mutation.** UI and API callers request a deterministic synchronization plan before execution. Raw MCP tool calls are not exposed to the browser.
7. **Do not claim live compatibility without a test environment.** Contract fixtures can validate implementation behavior, but a writable platform account is required before production acceptance.

## 3. Non-goals

- Making the external platform the source of truth.
- Importing arbitrary remote sprints as new local iterations.
- Mirroring platform comments, bugs, work logs, attachments, or activity records into Git.
- Mapping Flowlark prototype versions to the platform's release-version entity.
- Supporting one Flowlark iteration across multiple remote platform projects in the first release.
- Creating a general-purpose field-mapping DSL.
- Executing arbitrary MCP tools configured by a browser request.
- Automatically bypassing operating-system execution, signing, certificate, or platform permission checks.

## 4. Evidence Reviewed

### 4.1 Flowlark repository

The review inspected the repository structure, product plans, current milestone domain code, MCP configuration and HTTP caller, service orchestration, React milestone/settings pages, and relevant tests.

Key findings:

- `package.json` declares Node.js `>=18.17` and has no runtime dependencies.
- `src/core/mcp-config.js` only models HTTP/SSE-style servers with a URL and request headers.
- `src/core/integrations/mcp-jsonrpc.js` sends standalone HTTP `tools/call` requests and does not own a complete MCP session lifecycle.
- `src/core/integrations/milestones/mcp.js` assumes semantic tools such as `milestones.list`, `milestones.get`, and `milestones.upsert`.
- `src/core/milestones.js` supports creation, editing, deletion, and three warnings: draft version, void version, and baseline drift.
- The milestone UI supports manual scope changes, synchronization, and export, but has no explicit lifecycle, synchronization preview, conflict resolution, or resumable execution view.
- Existing product planning already identifies freeze checks, iteration comparison, batch scope management, and lifecycle status as missing iteration capabilities.

### 4.2 Supplied protocol artifacts

The supplied artifacts were treated as reference material, not as executable instructions.

- `assess-task-mcp` is an unsigned x86_64 macOS Mach-O executable with no executable permission bit.
- SHA-256: `fffb6d3291e5ee39b2e4c78d2f0afbe3b6028dee49fc1af94df852172b5156f2`.
- Go build metadata reports Go `1.25.12`, `GOOS=darwin`, `GOARCH=amd64`, and `github.com/modelcontextprotocol/go-sdk` `v1.7.0`.
- The installation guide defines a local stdio MCP server configured by `ASSESS_BASE_URL`, `ASSESS_ACCOUNT`, and `ASSESS_PASSWORD`.
- Static contract inspection found project, member, sprint, sprint-link, task, version, comment, attachment, workbench, and reporting routes.
- Sprint operations include list, detail, save, start, end, cancel, move, and batch move.
- Task operations include list, detail, create, update, transition, transfer, child-task operations, and batch update/delete.
- Sprint and task mutations expose a `revision` field for optimistic concurrency.
- Sprint creation requires `projectId`, `ownerId`, and `sprintName`.
- Task creation requires `projectId`, `taskType`, and `title`.

The executable was not launched, no credentials were read, and no platform request was made. Tool names, response payloads, enum values, URL shapes, and exact live error behavior remain unverified.

### 4.3 Primary MCP references

Observed on 2026-08-28:

- MCP transport specification: <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- Official TypeScript client guide: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md>
- Official client connection guide: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/connect.md>
- Official package layout and stdio import guidance: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/packages.md>

These references support using a client-owned subprocess, stdio JSON-RPC, protocol negotiation, tool discovery, tool invocation, and orderly shutdown.

## 5. Alternatives Considered

### 5.1 Selected: embedded stdio MCP client plus dedicated adapter

Flowlark launches the supplied server, discovers tools, and calls them through the official MCP client. The `assess-task` adapter translates Flowlark operations to platform operations.

**Gain:** one installation flow, correct MCP lifecycle, unified diagnostics, direct ownership of retries and synchronization state.  
**Cost:** Node.js 20 minimum and an official runtime dependency.  
**Becomes wrong when:** Flowlark must remain runtime-dependency-free or the target environment cannot run Node.js 20.

### 5.2 Rejected: local stdio-to-HTTP sidecar

A separate bridge would expose the local MCP server through HTTP so the current Flowlark caller could remain mostly unchanged.

**Gain:** smaller immediate change to Flowlark's MCP client.  
**Cost:** a second process, port, configuration surface, secret boundary, log stream, and upgrade path.  
**Why rejected:** the operational burden is incompatible with Flowlark's low-friction local product model.

### 5.3 Deferred: generic mapping DSL

Tool names, fields, enums, and workflows could be declared entirely in `mcp.json`.

**Gain:** less platform-specific source code after several integrations exist.  
**Cost:** branching workflows, optimistic locking, high-risk confirmations, and partial recovery turn configuration into an unsafe programming language.  
**Why deferred:** abstraction should follow evidence from at least two real platform adapters.

## 6. Architecture

```text
React milestone/settings UI
           |
           v
Local HTTP API routes
           |
           v
MilestoneSyncService
  preflight -> plan -> confirm -> execute -> verify
           |
           v
AssessTaskAdapter
  projects / members / sprints / tasks / revisions / status
           |
           v
McpClientManager
  http + stdio / discovery / call / timeout / close
           |
           v
assess-task-mcp subprocess -> task-management platform
```

### 6.1 `McpClientManager`

Responsibilities:

- resolve an enabled MCP server and its machine-local runtime profile;
- create either an HTTP or stdio transport;
- connect and negotiate the protocol through the official MCP client;
- retrieve and cache `tools/list` for the connection lifetime;
- call an allowlisted tool with a timeout and abort signal;
- normalize structured content, text JSON, `isError`, protocol errors, process exits, and timeouts;
- cap and redact stderr diagnostic text;
- close stdin and terminate the child process when the request scope or Flowlark service ends;
- expose injectable client/session factories for tests.

The existing HTTP behavior remains available through the same interface. Migration must preserve existing requirement and generic MCP capability behavior.

### 6.2 `AssessTaskAdapter`

The adapter exposes semantic methods instead of raw tool calls:

- `probe()`;
- `listProjects()` and `getProjectCapabilities()`;
- `listProjectMembers()`;
- `listSprints()`, `getSprint()`, and `saveSprint()`;
- `listSprintTasks()`, `getTask()`, `createTask()`, and `updateTask()`;
- `moveTasks()`;
- `startSprint()`, `endSprint()`, and `cancelSprint()`.

At connection time the adapter validates discovered tools and their input schemas. Tool names are stored in the capability mapping after discovery; the adapter never chooses tools only by fuzzy name matching. Required fields and known schema hashes are checked before enabling writes.

### 6.3 `MilestoneSyncService`

The service owns:

- local iteration lifecycle validation;
- freeze preflight checks;
- ownership-aware local/remote comparison;
- deterministic synchronization-plan generation;
- confirmation-token creation and validation;
- dependency-ordered execution;
- per-step external-ID persistence;
- partial-failure journal and retry selection;
- post-write remote verification;
- final local lifecycle transition.

No React component or HTTP route may call the adapter directly.

## 7. Configuration and Secret Storage

### 7.1 Repository configuration

`mcp.json` advances to schema version 2. It remains Git-tracked and contains only shareable logical configuration:

```json
{
  "schemaVersion": 2,
  "servers": [
    {
      "id": "assess-task-local",
      "name": "R&D task platform",
      "type": "stdio",
      "adapter": "assess-task",
      "runtimeProfile": "assess-task-local",
      "timeoutMs": 15000,
      "enabled": true
    }
  ],
  "capabilities": {
    "milestones": {
      "enabled": true,
      "server": "assess-task-local",
      "project": "123",
      "tools": {}
    }
  }
}
```

The final saved `tools` object is populated from an explicitly reviewed discovery result. It maps semantic operation keys to exact discovered tool names.

### 7.2 Machine-local runtime profile

`$FLOWLARK_HOME/mcp-runtime.json` stores per-workspace, per-server runtime values and is created with user-only file permissions:

- canonical workspace path;
- runtime profile ID;
- absolute executable path;
- argument array;
- platform base URL;
- platform account;
- expected executable SHA-256, when supplied;
- last successful local diagnostic time.

The platform password is stored separately in the operating-system credential store under the workspace and server identity. It is injected only into the child process environment as `ASSESS_PASSWORD`.

The child environment contains the required `ASSESS_*` variables plus a minimal safe inherited environment. Repository configuration, API responses, logs, diagnostics, and operation journals never contain the password.

## 8. Domain Model

### 8.1 Milestone fields

Milestones add:

- `goal`: delivery goal text;
- `owner`: stable local owner label;
- `status`: `planning`, `reviewing`, `frozen`, `active`, `delivered`, `archived`, or `canceled`;
- extended `external` synchronization metadata.

Example:

```json
{
  "name": "2026-S12",
  "title": "Order bulk operations",
  "goal": "Deliver reviewed order batch operations",
  "owner": "zhangsan",
  "status": "frozen",
  "startAt": "2026-08-01",
  "endAt": "2026-08-21",
  "items": [],
  "external": {
    "provider": "assess-task",
    "server": "assess-task-local",
    "projectId": 123,
    "sprintId": 456,
    "revision": 7,
    "remoteStatus": "active",
    "url": "",
    "lastSyncHash": "sha256:...",
    "syncedAt": "2026-08-28T01:00:00.000Z"
  }
}
```

Old milestone files default to `planning`, with empty `goal` and `owner`. No automatic remote write occurs during migration.

### 8.2 Requirement task bindings

Requirements add `externalTasks`, an array separate from the existing `external` source record:

```json
[
  {
    "provider": "assess-task",
    "server": "assess-task-local",
    "projectId": 123,
    "taskId": 789,
    "revision": 4,
    "remoteStatus": 2,
    "url": "",
    "lastSyncHash": "sha256:...",
    "syncedAt": "2026-08-28T01:00:00.000Z"
  }
]
```

A task binding is unique by `provider + server + projectId`. One requirement may therefore be used by another platform or another remote project later without overwriting its original source metadata.

## 9. Field Mapping

### 9.1 Flowlark milestone to platform sprint

| Flowlark | Platform | Rule |
| --- | --- | --- |
| `title` | `sprintName` | Fall back to `name`; reject output longer than 64 characters. |
| `goal` | `sprintGoal` | Preserve as user-authored text. |
| `startAt` | `planStartDate` | Convert date-only value using the configured workspace timezone. |
| `endAt` | `planEndDate` | Convert date-only value using the same timezone. |
| selected member | `ownerId` | Resolve only from an explicit platform member selection. |
| capability project | `projectId` | One remote project per repository in release one. |
| `external.sprintId` | `id` | Persist immediately after successful creation. |
| remote read | `revision` | Refresh before every write; never reuse blindly. |

The precise accepted timestamp representation must be verified during live integration. Until then, adapter fixtures use RFC 3339 date-time strings with an explicit offset and round-trip them back to Flowlark date-only values without shifting the calendar date.

### 9.2 Flowlark requirement to platform task

Each distinct requirement code in a milestone produces one task, even if the requirement appears in multiple milestone items.

| Flowlark | Platform | Rule |
| --- | --- | --- |
| `code + title` | `title` | Format `[CODE] title`; reject output longer than 255 characters. |
| `description` plus version references | `descriptionDoc` | Include all linked prototype project/version references for this iteration. |
| requirement specification | `acceptanceDoc` | Send only when non-empty. |
| `priority` | `priority` | Use a reviewed mapping table; an unknown value blocks synchronization. |
| `owner` | `assigneeId` | Use an explicit member mapping; missing mapping is a warning and leaves the task unassigned. |
| `dueDate` | `planEndDate` | Fall back to the milestone end date. |
| milestone start | `planStartDate` | Use the milestone start date. |
| configured default | `taskType` | Required; never infer an enum. |
| remote sprint | `currentSprintId` | Set during create, update, or move. |

Flowlark prototype versions are references in task content and delivery links. They are not mapped to the platform release-version entity.

## 10. Ownership and Drift

Flowlark-owned values:

- sprint name, goal, planned dates, owner, and scope;
- task title, requirement description, acceptance content, priority, planned dates, and planned assignee;
- requested sprint lifecycle transition.

Platform-owned values:

- task workflow status;
- actual dates and time spent;
- comments, activity, bugs, attachments, and execution notes.

An out-of-band platform change to a Flowlark-owned field creates drift. Synchronization stops that object's write and offers two explicit choices:

- restore the reviewed Flowlark value to the platform; or
- accept the platform value by creating a local edit that the user can review in Git.

An out-of-band platform lifecycle change is displayed as a conflict. Flowlark does not silently reverse it.

## 11. Lifecycle

```text
planning -> reviewing -> frozen -> active -> delivered -> archived
    |           |           |
    +-----------+-----------+-> canceled
```

Allowed transitions:

- `planning -> reviewing` after required dates, goal, owner, and platform mappings exist;
- `reviewing -> planning` for ordinary revision;
- `reviewing -> frozen` after all freeze blockers are resolved and the final synchronization verifies;
- `frozen -> reviewing` only before remote start and with an audit reason;
- `frozen -> active` after remote `start` succeeds and is verified;
- `active -> delivered` after unfinished work is explicitly handled, remote `end` succeeds, and verification passes;
- `delivered -> archived` as a local-only organization action;
- `planning`, `reviewing`, `frozen`, or `active -> canceled` after remote cancellation when a remote sprint exists, otherwise as a local cancellation;
- active scope changes through a dedicated action with a required reason, never through ordinary item editing.

Canceled and archived iterations are terminal in release one.

## 12. Freeze Preflight

Freeze is blocked by:

- draft or void prototype versions;
- baseline drift;
- unconfirmed review state;
- missing requirement, project, or version;
- missing required specification or change explanation according to existing version rules;
- duplicate or conflicting requirement binding;
- unavailable MCP server or failed current-user check;
- missing remote project capability;
- missing sprint owner, default task type, or priority mapping;
- missing required tool or incompatible input schema;
- a task binding pointing to another remote project;
- a deleted or inaccessible remote sprint/task;
- unresolved local/remote drift.

Every blocker includes an object identifier, a human-readable explanation, and a local or settings-page repair route.

## 13. Synchronization Protocol

### 13.1 Plan

The planner reads local data and current remote objects, refreshes revisions, and emits ordered operations:

- create/update sprint;
- create/update task;
- move task into or out of sprint;
- skip unchanged object;
- resolve conflict;
- start/end/cancel sprint.

Each operation has a stable key, before/after summary, risk level, required confirmation, and dependency list. The complete plan has a content hash and expiration time. Execution rejects a changed or expired plan.

### 13.2 Confirm

Ordinary synchronization uses one confirmation. Start, end, cancel, and active-scope changes use a second high-risk confirmation that shows affected tasks and requires an operation reason where the platform supports or requires one.

### 13.3 Execute

Execution order is:

1. save or refresh sprint;
2. create/update tasks;
3. batch-move tasks;
4. perform the lifecycle transition;
5. read back sprint and tasks;
6. transition local milestone status.

External IDs and revisions are persisted after each successful remote operation. Local lifecycle status changes only after the entire plan is verified.

### 13.4 Partial failure and retry

The local and remote systems cannot share a transaction. Flowlark therefore uses a durable local execution journal under `.flowlark/cache/mcp-sync/`:

- completed steps retain their external bindings;
- failed and pending steps remain retryable;
- retry generates a fresh remote read and revision check;
- completed steps are skipped only when remote verification still matches;
- no automatic compensating delete is attempted;
- if a create may have succeeded before the local ID was persisted, Flowlark stops and asks the user to select a remote candidate instead of creating another object.

The execution journal stores no password, access token, raw process environment, or unrestricted platform response.

## 14. API and UI

### 14.1 MCP settings

The settings flow contains:

1. transport and adapter selection;
2. executable selection;
3. local executable diagnostics;
4. local platform address/account/password entry;
5. read-only connection and identity test;
6. remote project selection;
7. sprint owner, default task type, priority, and member mapping;
8. tool-contract review and write enablement.

Executable diagnostics report existence, regular-file status, execute permission, CPU architecture, signing status, actual SHA-256, expected SHA-256 match, and last modification time. Missing execute permission and architecture mismatch are blockers. An unsigned macOS binary is a visible security warning and follows organization policy; Flowlark does not disable Gatekeeper or security tooling.

### 14.2 Milestone list and detail

The list adds lifecycle, sync health, drift, and last-synchronized time.

The detail page adds:

- remote project/sprint identity and link;
- freeze-preflight summary;
- generate-plan action;
- operation table grouped as create, update, move, conflict, unchanged, and lifecycle;
- confirmation and reason collection;
- progress display;
- partial-failure detail and retry;
- lifecycle actions appropriate to current status;
- remote platform-owned execution summary.

The existing local-only edit, export, and read-only permission behaviors remain available when MCP is disabled or unavailable.

## 15. Security

- Spawn with an argument array and `shell: false`; never execute a concatenated command string.
- Resolve and validate the configured executable before spawn.
- Pass only an allowlisted inherited environment plus required `ASSESS_*` values.
- Store the password only in the operating-system credential store.
- Redact credentials, authorization values, and known sensitive response fields from diagnostics.
- Cap stdout message size, stderr capture, execution time, and in-flight operations.
- Reject non-MCP stdout content as a protocol error.
- Allow the adapter to invoke only reviewed operation mappings.
- Never accept an arbitrary tool name from an HTTP request or React payload.
- Require platform capability checks before enabling writes.
- Require explicit confirmation for destructive or lifecycle actions.
- Preserve platform-side authorization; never retry with another identity or attempt privilege escalation.

## 16. Testing

### 16.1 Automated transport tests

Use a test-owned stdio fixture process, not the supplied binary, to verify:

- process launch and environment allowlist;
- protocol negotiation and tool discovery;
- tool call success, structured content, text JSON, and `isError`;
- fragmented stdout messages;
- invalid stdout content;
- bounded stderr capture and redaction;
- timeout, abort, process exit, and cleanup;
- concurrent calls and request correlation;
- HTTP transport regression compatibility.

### 16.2 Adapter contract tests

Fixtures derived from the statically inspected schemas verify:

- required sprint and task fields;
- project/member selection;
- date conversion without calendar-date drift;
- requirement deduplication;
- priority, member, and task-type mappings;
- fresh revision reads;
- sprint start/end/cancel bodies;
- task movement payloads;
- unknown enum and incompatible schema rejection.

### 16.3 Orchestrator tests

Verify:

- stable plan generation and plan-hash rejection after local change;
- no remote mutation before confirmation;
- dependency ordering;
- immediate external-ID persistence;
- rerun without duplicate creation;
- partial failure and resume;
- stale revision conflict;
- out-of-band drift handling;
- dangerous-operation confirmation;
- lifecycle transition rules;
- local-only degradation when MCP is unavailable.

### 16.4 UI tests

Verify settings diagnostics, secret redaction, project/member/mapping selection, preflight repair links, plan preview, confirmation, progress, failure retention, retry, read-only mode, responsive layout, and keyboard access.

### 16.5 Live acceptance gate

Production acceptance requires a disposable remote project and writable non-administrator account. The live checklist is:

1. discover the exact released tool set and archive a redacted schema fixture;
2. verify current identity and project permissions;
3. create one sprint and three requirement tasks;
4. update fields and verify no duplicates;
5. move a task into and out of the sprint;
6. provoke and observe a stale-revision conflict;
7. start the sprint;
8. test unfinished-task confirmation behavior;
9. end a sprint and separately cancel another sprint;
10. verify password and sensitive data never appear in Git or diagnostics.

Until this gate passes, release notes must say “implementation and simulated contract verification complete; target-platform live verification pending.”

## 17. Delivery Roadmap

### P0: transport foundation

- raise Node.js engine to `>=20`;
- add and pin the official MCP client 2.x dependency;
- unify HTTP and stdio sessions behind `McpClientManager`;
- add local runtime-profile and credential handling;
- add process and transport tests.

Exit signal: a test stdio server can be discovered, called, timed out, and closed without leaking a child process or secret.

### P1: read-only assess adapter

- add tool discovery and schema validation;
- query current user, projects, capabilities, members, sprints, and tasks;
- add normalization and read-only settings diagnostics;
- capture adapter contract fixtures.

Exit signal: Flowlark can show the selected platform identity, project, sprint, task range, and write-capability status without performing a mutation.

### P2: synchronization planning and writes

- extend milestone and requirement schemas;
- implement field ownership and diffing;
- generate and confirm synchronization plans;
- create/update sprints and tasks;
- move tasks and persist external bindings;
- add execution journals and retry.

Exit signal: all simulated create/update/move flows are idempotent and recover from injected partial failures.

### P3: lifecycle and product UI

- add lifecycle transitions and freeze preflight;
- add list/detail synchronization views;
- add high-risk confirmations and drift handling;
- update CLI/API/help/docs and migration coverage;
- run the complete regression suite.

Exit signal: simulated start/end/cancel flows obey local rules, platform revisions, permissions, and confirmation requirements without regressing local-only iterations.

### P4: live integration and release

- obtain a disposable test project and writable test account;
- run the live acceptance gate;
- correct response normalization, tool mappings, enum mappings, and date serialization from observed evidence;
- freeze the redacted contract fixture and compatibility note;
- publish only after all blockers are closed.

Exit signal: the complete lifecycle passes twice without duplicate remote objects, silent overwrite, leaked credentials, or manual database repair.

## 18. Success Criteria

- A user can configure the supplied stdio MCP without committing a binary path, account, or password.
- Every remote mutation is represented in a reviewed, unexpired synchronization plan.
- One local iteration creates exactly one remote sprint in the configured project.
- One distinct local requirement creates exactly one remote task in that project.
- Repeating an unchanged synchronization creates no additional remote object.
- A stale `revision` never causes a silent overwrite.
- A partial failure can be retried from verified unfinished steps.
- Start, end, cancel, and active-scope change actions require the correct local state and explicit confirmation.
- Platform-owned execution data remains visible and is not overwritten by local synchronization.
- MCP failure does not break local milestone viewing, editing, export, or Git workflows.
- Existing HTTP MCP requirement and milestone tests continue to pass.
- No secret appears in Git-tracked files, operation journals, API responses, or user-visible error details.
- Live acceptance is visibly blocked until a writable test environment exists.

## 19. Risks and Failure Conditions

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Live tool names or response bodies differ from static evidence | Adapter cannot normalize results | Dynamic discovery, schema validation, redacted fixture capture, and P4 live gate. |
| Platform enum meanings are unavailable | Incorrect task type, priority, or status | Require explicit values from live discovery/user selection; block unknown mappings. |
| Date-time semantics differ | Planned dates shift by one day | Explicit workspace timezone, round-trip tests, and live date verification. |
| Crash after remote create but before ID persistence | Duplicate risk | Stop automatic creation and require candidate linking on ambiguous retry. |
| Platform edits Flowlark-owned fields | Silent data loss risk | Drift conflict with explicit restore or accept action. |
| Official SDK or protocol changes | Compatibility maintenance | Pin the dependency, isolate it behind `McpClientManager`, and retain protocol fixtures. |
| Node.js 20 is unacceptable to users | Installation regression | This invalidates the selected approach; use the sidecar alternative or a separately distributed desktop runtime. |
| One repository must span multiple remote projects | Data model cannot represent all remote sprints | This invalidates the release-one cardinality; design one-to-many bindings before implementation. |
| Organization rejects unsigned binaries | MCP cannot be launched | Require a signed/notarized build from the platform publisher; do not bypass security policy. |

## 20. Implementation Boundary

The implementation should make focused changes to MCP transport/configuration, the `assess-task` adapter, milestone synchronization/lifecycle, related API/UI surfaces, schema migration, tests, and documentation. It must not refactor unrelated project, prototype editor, search, Git, notification, or delivery modules.

The next step after user review is a file-by-file implementation plan. No business-code implementation is authorized by this design document alone.
