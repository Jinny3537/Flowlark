# Version Index Overlap Fix

## Context

The version index uses a fixed 52px first column for version numbers. A value such as `v2.8.5.0` is wider than that track, so it visually intrudes into the adjacent title column.

## Goal

Keep the existing compact two-line version row while preventing the version number, title, and status label from overlapping at desktop and narrow viewport widths.

## Chosen Direction

Apply a CSS-only adjustment in `web/src/pages/ProjectVersions.module.css`:

- Widen the aligned version-number track enough for the current version format.
- Constrain version-number overflow to its own track.
- Preserve the title's existing single-line ellipsis and tooltip.
- Keep the status label visible and non-overlapping.
- Apply equivalent track sizing to the narrow-screen row layout.

## Scope

- No JSX, data, interaction, API, or global-style changes.
- No sidebar-width or row-height changes.
- No unrelated formatting or refactoring.

## Acceptance Criteria

- `v2.8.5.0` no longer touches or overlaps the title shown in the reported layout.
- Long titles remain on one line with ellipsis and retain the existing full-text tooltip.
- Status labels remain readable without overlapping adjacent content.
- The row stays compact and aligned across multiple versions.
- The production web build succeeds.
- Desktop and narrow-width visual checks show no horizontal overflow caused by the row.

## Verification

- Run the web production build.
- Inspect the version index at its desktop width and below the existing mobile breakpoint.
- Check a row containing `v2.8.5.0`, a long title, and a visible status label.
