# React Project Workbench Restoration Design

## Goal

Restore the complete project-version workbench and comparison experience in the active React frontend. The existing Vue `Workbench.vue` and `Compare.vue` implementations define the user-visible feature baseline. The migration must preserve the current repository data format and reuse the existing HTTP APIs.

The completed React routes must no longer depend on the Vue entrypoint:

- `/projects/:slug/versions/:versionNo`
- `/projects/:slug/compare`

## Scope

The workbench restoration includes:

- Project navigation, sibling-version switching, display status, review status, history, comparison, direct-link copying, new-window preview, HTML download, and baseline actions.
- Sandboxed prototype preview through the dedicated preview server.
- Offline-preview selection and offline bundle generation.
- Annotation selection and feedback-draft creation, listing, submission, screenshot access, and deletion.
- Inline prototype editing through the preview-server edit bridge.
- Full HTML replacement from source, local file, or public URL.
- Specification viewing, Markdown editing, template insertion, file import, and Git-history viewing.
- Change-log viewing, cumulative-range selection, and draft-version editing.
- Requirement viewing, external-link opening, and draft-version editing.
- Attachment upload, open/download, missing-file state, and deletion.
- Version metadata, tag editing, file information, external references, timestamps, and preview URL.
- Version Git history.
- Resizable desktop split view and a usable narrow-screen layout.

The comparison restoration includes:

- Version-to-version comparison with two real prototype frames.
- Prototype-to-business-system comparison.
- Version selection, swapping, direct opening, and downloading.
- Query-string persistence for mode, selected versions, system URL, and change-panel visibility.
- Optional synchronized horizontal viewport position.
- Cumulative changes for version comparison and current-version change notes for system comparison.
- Copyable deep links.

This design does not change backend storage, version lifecycle rules, preview-server behavior, Git semantics, or integration-provider behavior.

## Architecture

Use a native React implementation under the existing Vite, React Router, and Ant Design application. Do not mount the Vue application inside React and do not route project details back to the Vue entrypoint.

`VersionWorkbench.tsx` remains the route-level coordinator. It owns route parameters, core loading, permission state, the selected tab, current version data, sibling versions, and mutation refreshes. Focused React components own bounded interface areas:

- `PrototypeStage`: preview iframe, offline state, annotation mode, online-edit mode, full-width mode, and split controls.
- `WorkbenchDocuments`: right-side tabs and the state shared by their panels.
- `SpecificationPanel`: Markdown view/edit/import/template/history.
- `ChangesPanel`: direct and cumulative changes plus draft editing.
- `RequirementsPanel`: linked requirements plus draft editing.
- `AttachmentsPanel`: upload, open/download, missing state, and deletion.
- `VersionInfoPanel`: status, tags, paths, dependencies, timestamps, and preview link.
- `FeedbackPanel`: feedback list, screenshots, deep links, submission, and deletion.
- `PrototypeEditorDrawer`: source/file/URL replacement flow.
- `VersionHistoryDrawer`: Git history for the selected version.
- `FeedbackDrawer`: annotation-derived feedback creation and submission.

Components should be separated when they own independent state or a distinct API workflow. Small display-only fragments remain local to avoid creating abstractions without behavioral value.

`Compare.tsx` remains a separate route component because its full-height dual-frame layout, URL state, and viewport synchronization are independent of the workbench.

## Workbench Layout

The route uses a compact full-height tool layout rather than the general document-page layout.

The top toolbar contains:

- Back navigation and project identity.
- Sibling-version selector.
- Version display status and review-status control.
- History, side-by-side comparison, copy-link, new-window, and download actions.
- Baseline action or current-baseline indicator.

The main desktop stage is split into a prototype pane and a document pane. The prototype receives most of the initial width. A draggable divider persists its percentage in local storage and supports double-click reset. The document pane can be collapsed so the prototype fills the stage.

The prototype toolbar contains file metadata, offline preview, sandbox status, annotation feedback, online editing, HTML replacement, save, and full-width controls. External dependencies appear in a local alert with an expandable list and an offline-build action.

The document pane contains six tabs:

1. Specification
2. Changes
3. Requirements
4. Attachments
5. Version information
6. Feedback

Below 900px, the desktop split becomes a single-column workspace with an explicit preview/document switch. Controls remain keyboard reachable and at least 44 pixels high where used as primary touch targets. Dense desktop controls may retain the existing compact Ant Design sizing.

## Comparison Layout

The comparison route uses a full-height toolbar, summary strip, dual-frame stage, and optional explanation panel.

Two segmented modes are available:

- `versions`: both panes render archived prototype versions from the dedicated preview server.
- `system`: the left pane renders an archived prototype and the right pane attempts to render a validated HTTP or HTTPS business-system URL.

Each pane has its own identity, selector or URL field, open-in-new-window action, and download action where applicable. Version mode supports swapping panes. The route warns when the same version is selected on both sides. System mode explains that `X-Frame-Options` or CSP may prevent embedding and preserves the new-window fallback.

The explanation panel shows cumulative changes across the chronologically ordered version range or the selected prototype's own changes in system mode. Its visibility and the complete comparison selection are reflected in URL search parameters.

On narrow screens, the frames stack vertically with stable minimum heights. The page must not squeeze two unusable narrow frames into one row.

## Data Flow

On workbench entry, load project, current version, sibling versions, and health/permission state in parallel. The route renders only after these core resources resolve.

Tags, version history, specification history, and feedback drafts are supplementary. Load them independently after the core view is available. A failure in supplementary data must remain local to the related panel or drawer.

Prototype content is rendered from the dedicated preview origin:

`<current-protocol>//<current-host>:<previewPort>/p/<slug>/<versionNo>`

Use `offline=1` for offline preview and `edit=1` for edit mode. Do not replace the preview with `srcDoc`, because the preview server supplies the isolation boundary and edit bridge.

Route-parameter changes reset panel edit modes and start a new core load. Each load receives a monotonically increasing request identifier; stale responses are ignored so rapid version switching cannot overwrite the new route state.

After a successful mutation, refresh only the affected resources:

- HTML replacement refreshes the current version and reloads the preview frame.
- Specification save refreshes current version and specification history.
- Change save refreshes current version and the active cumulative view.
- Requirement save refreshes current version.
- Tag save refreshes current version and tag options.
- Attachment mutation refreshes current version without reloading the preview.
- Feedback mutation refreshes feedback drafts.
- Baseline mutation refreshes project and sibling-version state.

## Editing Rules

The service health response supplies repository write permission. The UI disables writing when `canWrite` is false and explains the read-only state.

Structural version content follows existing lifecycle rules:

- HTML, changes, and linked requirements are editable only when the version display key is `DRAFT` and the repository is writable.
- Specifications remain editable after version confirmation when the repository is writable.
- Tags and attachments follow the existing API permission rules and are not presented as structural prototype edits.
- Baseline, history, and void states are always displayed with readable text, not color alone.

The backend remains the final authority. API validation errors are shown near the active workflow and are not replaced with frontend-only assumptions.

## Prototype Editing

Online edit mode loads the preview URL with `edit=1`. When saving, the workbench sends `flowlark:get-edit-html` to the current iframe and accepts only the matching response identifier from that iframe window. A three-second timeout produces a recoverable error and preserves edit mode.

The source editor supports three modes:

- Complete HTML source in a monospace text area.
- Local `.html` or `.htm` file import within the configured size limit.
- Public HTTP or HTTPS URL import through the existing server endpoint.

Imported or edited HTML can be inspected with the existing HTML inspection endpoint to show file size and external dependencies. Empty HTML cannot be saved. A failed save keeps the draft and drawer open. A successful `replaceHtml` closes editing, resets offline selection, refreshes version metadata, and reloads the preview. The backend already clears any stale offline derivative.

## Document Workflows

Specification editing uses Markdown. It supports the existing six-section specification template, Markdown/text file import, current rendering, Git-history selection, and a clear warning when historical content is shown. Applying the template over non-empty content requires confirmation.

Changes show the current version by default and allow an older sibling as the cumulative start. Draft versions can edit structured change entries and save only non-empty content entries.

Requirements show code, title, and an available external link. Draft versions can edit structured requirement entries and save only entries with a non-empty code.

Attachments support upload, open, download, missing-file indication, and confirmed deletion. Attachment mutations must not reload the prototype frame.

Version information exposes the existing metadata and allows tag editing. Feedback shows only drafts matching the current project and version and retains screenshot and annotation deep links.

## Error Handling

- Core load failure keeps the workbench frame stable and offers retry.
- Supplementary failures stay inside their panel or drawer.
- Mutation buttons show loading and prevent duplicate submission.
- Failed saves retain drafts and keep their editors open.
- File imports validate extension and configured byte limit before reading.
- URL imports rely on server validation and display its error message.
- The preview stage provides a new-window fallback when embedding is unavailable.
- The online-edit bridge reports timeout without discarding edits.
- Destructive actions, including attachment or feedback deletion, template overwrite, and baseline replacement, require confirmation.
- Success and failure produce explicit Ant Design application-context messages.

## Accessibility and Responsive Behavior

- Interactive elements use semantic buttons, links, inputs, and selectors.
- Icon-only controls have accessible names and tooltips.
- Focus remains visible and follows the existing `--fl-*` token rules.
- Status is conveyed through text and color.
- Tabs, segmented controls, drawers, and modals remain keyboard operable.
- Loading states reserve the final layout dimensions where practical.
- The workbench and comparison routes have no page-level horizontal overflow at 390 pixels.
- Reduced-motion preferences disable non-essential transitions.

## Verification

Automated verification:

- Run `npm run build` in `web`.
- Run the root `npm test` suite.
- Add focused tests for pure workbench state helpers, including editability, preview URL construction, ordered comparison ranges, and stale-response protection where extracted into deterministic functions.

Page-level verification:

- Desktop workbench at 1280x900 and 1440x900.
- Mobile workbench at 390x844.
- Desktop and mobile comparison routes.
- Version switching, split dragging/reset, document collapse, and tab navigation.
- Online edit, source edit, local-file import, URL import, save success, save failure, and edit-bridge timeout.
- Specification, change, requirement, tag, attachment, feedback, history, offline, review, and baseline workflows.
- Version-to-version and prototype-to-system comparisons, URL restoration, swapping, viewport synchronization, and blocked-embed fallback.
- Read-only, draft, baseline, history, void, empty-content, external-resource, offline, fast-route-switch, and local supplementary-error states.
- Browser console errors, visible focus, text overflow, iframe rendering, and horizontal overflow.

## Acceptance Criteria

- Every user-visible capability in the existing Vue `Workbench.vue` and `Compare.vue` has a corresponding functional React workflow.
- The active React routes can view and save workbench data without executing the Vue entrypoint.
- Prototype preview, edit mode, and comparison render through the dedicated preview server with their existing sandbox boundaries.
- Editing permissions match backend lifecycle rules and read-only state.
- Failed writes preserve drafts and provide a retry path.
- Rapid version changes cannot show or save stale route data.
- Desktop and mobile layouts remain usable without incoherent overlap or page-level horizontal scrolling.
- The React production build and root test suite pass.
