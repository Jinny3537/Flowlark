# Flowlark Arco UI Redesign Design

Date: 2026-08-23

## Purpose

Refactor Flowlark's full web UI and interaction design into a coherent workflow console for a local-first prototype version repository and product collaboration workbench.

The redesign covers all `web/src/views` pages and shared UI components. It changes the UI framework from Ant Design Vue to Arco Design Vue while preserving the existing Vue application architecture and business behavior.

## Confirmed Direction

Use the "workflow console" direction selected during visual review:

- Prioritize what the user needs to handle today: prototype versions, reviews, delivery risks, notification retries, and Git state.
- Keep Flowlark as a work-focused local prototype repository, not a marketing page.
- Preserve the existing Flowlark brand direction: light workspace, dense dashboard spacing, teal `--fl-*` semantic tokens, restrained depth, and clear text labels for state.
- Use subtle transitions only for spatial or state changes.

## Technical Direction

The frontend keeps:

- Vue 3
- Vite
- Vue Router
- Pinia
- Existing API layer and backend routes
- Existing route semantics
- Existing local-first data flow

The frontend migrates from:

- `ant-design-vue`
- `@ant-design/icons-vue`

To:

- Arco Design Vue
- Arco icon set or a single compatible icon family selected during implementation

The migration should not rewrite backend, CLI, storage, route contracts, or Pinia data ownership.

## Design System Updates

Update `DESIGN.md` and `design-system/flowlark/MASTER.md` to replace Ant Design Vue references with Arco Design Vue.

Preserve:

- `--fl-*` semantic tokens
- Flowlark teal primary color
- Dense dashboard spacing scale
- Light-first workspace
- Accessibility baseline
- Text labels alongside state colors
- `prefers-reduced-motion` support

Do not add dark mode in this redesign. Keep token structure compatible with a later dark mode.

## Global App Shell

The app shell has three layers.

### Top Bar

Top bar contains only global, high-frequency functions:

- Flowlark brand and current workspace context
- Global search
- Quick create
- Todo and notification status
- Git status
- Runtime status
- Settings entry

Responsive behavior:

- On narrow screens, hide repository path, auxiliary status copy, and low-frequency text labels first.
- Preserve search, status awareness, and core create/action entry points.
- Icon-only controls must have accessible names.

### Sidebar

Primary sidebar follows the Flowlark workflow:

1. Personal workbench
2. Projects
3. Requirements
4. Milestones
5. Deliveries
6. Draft inbox

Auxiliary entries such as trash, operation log, and settings should not compete with primary workflow navigation.

### Content Area

Every page uses a consistent page skeleton:

- Page title
- Short page description
- Primary action
- Status summary
- Main content region

Deeper pages should use breadcrumbs or equivalent parent context when the route has three or more hierarchy levels.

## Page Templates

### Console Template

Applies to `ActionCenter`.

Use compact cards and lists to show:

- Today's pending work
- Review risks
- Delivery notification retries
- Git state
- Quick actions

Avoid decorative hero sections. The page should scan like an operations console.

### List Template

Applies to:

- `ProjectList`
- `RequirementList`
- `MilestoneList`
- `DeliveryList`
- `WatchInbox`
- `Trash`
- `SearchPanel`

Structure:

- Page header
- Status metrics
- Search/filter/action bar
- Main list

Desktop can use dense tables or compact cards. Mobile should switch to card flow instead of forcing horizontal layouts, except where tabular comparison is essential and wrapped in explicit horizontal scroll.

### Detail Template

Applies to:

- `RequirementDetail`
- `MilestoneDetail`
- `DeliveryDetail`
- `VersionTimeline`

Structure:

- Parent context or breadcrumb
- Object title
- Status labels
- Main actions
- Related objects
- Activity or history region where relevant

Back behavior must be predictable and must not strand the user.

### Workbench Template

Applies to:

- `Workbench`
- `Compare`

Workbench priorities:

- Prototype preview
- Spec and change review
- Feedback
- Attachments
- Version operations

Desktop may use three columns or collapsible panels. Narrow screens should switch to tabs or stacked panels. Avoid squeezing preview and review panels until both become unusable.

### Settings Template

Applies to:

- `Settings`
- `OpLog`
- `SetupWizard`

Settings groups:

- Service
- Git
- Integrations
- Notifications
- Rules
- Appearance
- Logs

Forms need visible labels, helper text where needed, loading states, success feedback, and field-specific errors.

## Interaction Rules

All interactive work follows these rules:

- Icon-only buttons must have `aria-label`.
- Async actions must show loading and success/error feedback.
- Destructive actions require confirmation.
- State cannot be expressed by color alone; use text labels too.
- Badge/count updates must be contextual, such as "3 delivery notifications pending retry", not a bare number for assistive technology.
- Focus order should match visual order.
- Keyboard navigation must reach primary actions, menus, drawers, dialogs, and panels.
- Forms should validate on blur for most fields and keep field-level errors close to invalid inputs.
- Error summaries should be focusable when a form submit fails with multiple errors.
- Motion should be 150-250ms and reduced under `prefers-reduced-motion`.

## Migration Order

1. Dependencies and entry setup
   - Add Arco Design Vue.
   - Remove Ant Design Vue theme integration.
   - Establish Arco global style entry and Flowlark token bridge.

2. App shell
   - Rebuild top bar, sidebar, search entry, Git status, notification entry, and settings entry.

3. Shared components
   - Migrate search palette, Git panel, attachments, change list/editor, feedback drawer, version modals, requirement editor, review status, and annotation overlay.

4. Core pages
   - Migrate `ActionCenter`, `ProjectList`, `VersionTimeline`, `Workbench`, and `Compare`.

5. Workflow pages
   - Migrate requirements, milestones, deliveries, watch inbox, trash, and search panel.

6. Low-frequency pages
   - Migrate settings, operation log, and setup wizard.

7. Responsive and accessibility pass
   - Verify keyboard access, visible focus, accessible names, responsive behavior, and no incoherent overlaps.

8. Build and route walkthrough
   - Build the web app.
   - Manually inspect primary routes.

## Validation

Minimum validation before delivery:

- `cd web && npm run build` passes.
- Main routes open:
  - Personal workbench
  - Projects
  - Version timeline
  - Workbench
  - Compare
  - Requirements
  - Milestones
  - Deliveries
  - Draft inbox
  - Settings
- Top search, quick create, Git panel, notification panel, and settings modal/drawer remain operable.
- 375px, 768px, 1024px, and 1440px widths have no unintended horizontal overflow.
- Workbench, Compare, and Settings remain usable on narrow screens.
- Destructive actions still confirm before running.
- Async actions still produce feedback.
- Icon buttons and menu actions are keyboard reachable and have accessible names.

## Out Of Scope

- Backend or CLI changes
- Storage format changes
- Route contract changes
- Dark mode
- Complex animation libraries
- Product repositioning
- Introducing unrelated industry concepts

