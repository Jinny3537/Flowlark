# Version Timeline Redesign

## Context

The current project version page becomes visually unbalanced on wide screens. The baseline banner stretches across the available width while the actual version history remains a narrow column aligned to the left. This makes the baseline appear more important than the history and wastes most of the viewport.

Projects may contain more than 50 versions. The primary job of this page is therefore to browse, locate, and compare historical versions efficiently. Opening the current baseline remains important, but it is supporting context rather than the dominant visual element.

## Goals

- Make version history the primary page content.
- Support efficient scanning and navigation across 50 or more versions.
- Use wide desktop space coherently without stretching individual components edge to edge.
- Preserve all existing version actions and permission behavior.
- Provide a usable mobile layout without compressing two desktop columns.

## Non-goals

- No backend API or data format changes.
- No changes to Workbench, Compare, or cumulative-change page behavior.
- No new component library or third-party dependency.
- No global redesign of other Flowlark pages.
- No pagination or server-side search in this iteration.

## Chosen Direction

Use a master-detail version browser.

The page is constrained to a centered maximum width of 1440px. A compact project header and baseline strip sit above a two-column workspace. The left column is a searchable version index. The right column shows the selected version's details and actions.

This direction was selected over a dense table and a grouped vertical timeline because it supports focused review of one version while preserving fast access to a large history.

## Page Structure

### Project header

The header occupies one compact row:

- Left: breadcrumb, project name, and project slug.
- Right: show-void toggle, compare, cumulative changes, and create-version action.
- Create version remains the only primary action in the page header.

On narrow screens, the project identity and actions wrap into separate rows without horizontal scrolling.

### Baseline strip

The current baseline is shown as a compact horizontal strip approximately 56px high. It includes:

- Explicit "current baseline" text.
- Version number and title.
- Confirmation time and author.
- A single "Open Workbench" action.

The strip uses the existing primary semantic tokens but does not use a large card or oversized empty area. If no baseline exists, the current warning Alert remains in this position.

### Desktop master-detail workspace

At viewports 900px and wider, the main area uses a two-column CSS Grid:

- Version index: 320px wide.
- Version details: `minmax(0, 1fr)`.

The workspace fills the usable page width. Both columns use `min-width: 0` to prevent overflow. The version index has its own scroll region so the selected version details remain visible while browsing a long history.

### Mobile workspace

Below 900px, the page displays only the version index as the primary content. Selecting a version opens an Arco Drawer containing the same summary and actions as the desktop detail pane.

The existing direct route to Workbench is preserved through an explicit "Open Workbench" button. Selecting a version no longer immediately navigates away from the history page.

## Version Index

The index toolbar remains visible at the top of the left column and contains:

- Text search across version number, title, author, tags, and requirement codes available in list data.
- Status filter with an "all" option and the statuses returned by the existing display model.
- Sort control for newest-first and oldest-first.

Filtering is client-side because `listVersions` already returns the complete lightweight version list. No detail endpoint is called during filtering.

Each row has a stable height and a consistent hierarchy:

- Version number in monospace.
- Title on one line with ellipsis when necessary and a native tooltip containing the full text.
- Status label as text plus semantic color.
- Relative update time.
- Baseline, new, and last-read markers when applicable.

The selected row uses a primary-color left indicator and a subtle semantic background. The current baseline always includes readable baseline text so color is not the only indicator.

Keyboard behavior:

- Up and Down move the selection through the filtered list.
- Enter opens the selected version in Workbench.
- Focus remains visible and is not moved when details finish loading.

## Version Detail

The detail pane is an unframed content area rather than a card nested inside the page surface.

Its header contains:

- Version number, title, display status, and baseline state.
- Author, creation time, change count, requirement count, and external dependency count.
- "Open Workbench" as the primary action.
- Set-baseline or rollback as the secondary action when permitted.
- Existing read, compare, download, void, reopen, and delete actions in an overflow menu.

The body contains two sections:

1. Change log, using the existing change location and description data.
2. Linked requirements, using existing requirement code and title data.

Empty sections show a compact explicit state such as "No change log recorded" or "No linked requirements" rather than disappearing.

## State and Data Flow

The page retains the existing project, version-list, read-state, and modal state. It adds:

- `query`: current search text.
- `statusFilter`: selected display status or all.
- `sortOrder`: newest-first or oldest-first.
- `selectedVersionNo`: current index selection.
- `selectedVersion`: loaded full version details.
- `detailLoading` and `detailError`.
- A component-local `Map` keyed by version number for loaded detail data.

After the list loads, the newest visible version is selected by default. If the current selection still exists after a reload, it remains selected.

Selecting a version performs the following flow:

1. Update `selectedVersionNo` immediately so row selection feels responsive.
2. Use cached detail data when available.
3. Otherwise call the existing `api.getVersion(slug, versionNo)` endpoint.
4. Ignore an older response if the user selected another version before it completed.
5. Cache a successful response for subsequent selection.

Actions that mutate version state continue to call the existing APIs. After a successful mutation, the list and selected details reload, and the affected cache entry is invalidated.

## Loading, Empty, and Error States

- Initial page load uses the existing page spinner or a layout-matched skeleton without shifting the final layout.
- Detail loading keeps the right pane dimensions stable and shows a header/body skeleton.
- Detail failure displays the error in the detail pane with a retry button. It does not replace the whole page.
- A project with no versions keeps the existing empty state and first-upload action.
- A filter with no matches shows "No matching versions" and a clear-filters action.
- Read-only mode keeps existing Alerts and disables all write actions semantically.
- Void versions are excluded by default and become available through the existing toggle.

## Visual Rules

- Use existing `--fl-*` tokens exclusively for color, spacing, radius, shadow, and typography.
- Keep page content centered with a maximum width of 1440px.
- Do not add global `.arco-*` overrides.
- Do not introduce nested cards. The index is a bounded navigation surface; the detail pane is unframed.
- Keep version numbers and numeric metadata tabular or monospace.
- Status always uses both text and color.
- Interactive transitions use existing duration and easing tokens and do not shift layout bounds.

## Accessibility

- The version index is keyboard navigable with visible focus.
- Selected state is exposed with `aria-selected`.
- The version list and detail pane have descriptive region labels.
- Icon-only overflow buttons retain accessible names.
- Truncated titles expose their complete text through a tooltip available to pointer and keyboard users.
- Drawer focus is managed by Arco and returns to the triggering row when closed.
- No information is conveyed only through color.

## Acceptance Criteria

- At 1440px and wider, the baseline strip, version index, and detail pane share one centered content grid with no large unused horizontal gap.
- At 390px, the page has no horizontal overflow and version details open in a usable Drawer.
- A list of 50 or more versions remains searchable, filterable, sortable, and independently scrollable.
- Selecting versions does not navigate away or cause layout movement.
- A stale detail response cannot overwrite a newer selection.
- All existing version actions remain available and respect write permissions.
- No visible Alert has empty text.
- The page produces no Flowlark runtime warnings or uncaught errors.
- Production build succeeds.

## Verification

- Run the production build.
- Run desktop screenshots at 1280x900, 1440x900, and an ultra-wide viewport.
- Run mobile screenshots at 390x844.
- Verify search, status filtering, sorting, keyboard selection, and Drawer behavior.
- Verify selection races by switching versions before a delayed detail request resolves.
- Verify baseline, read-only, no-baseline, no-version, no-filter-result, void-version, loading, and detail-error states.
- Check horizontal overflow, page errors, console warnings, and visible Alert text in Playwright.
