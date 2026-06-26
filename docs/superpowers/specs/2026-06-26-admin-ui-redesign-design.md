# Admin UI Redesign — Design Spec

Date: 2026-06-26
Status: Approved
Scope: `public/admin.html`, `public/styles.css`, `public/app.js` (render layer only)

## Goal

The current admin console feels cramped and misaligned ("всё в кучу и не ровно
стоит"). The goal is a clean, professional, well-aligned dashboard while keeping
the existing dark dashboard aesthetic and color palette. No functionality or API
changes.

## Direction

- **Depth of change:** Visual (CSS) + targeted structure (HTML markup of table
  rows, action buttons, topbar grouping). No change to data flow, endpoints, or
  behavior.
- **Aesthetic:** Refined dark dashboard. Keep dark theme and the
  green/amber/red semantic palette. Make it more spacious, aligned, and tidy.

## Non-goals

- Replacing the table with a card grid.
- Changing any API endpoint, request, or response shape.
- Changing the login flow, auth, or business logic.
- Light theme / full restyle to a different design language.

## Foundations (design tokens)

Introduce a consistent set of tokens so spacing, type, and radii stop being
ad-hoc.

- **Spacing scale (px):** 4, 8, 12, 16, 20, 24, 32, 40 — applied uniformly
  across gaps, paddings, and section rhythm.
- **Type scale:**
  - eyebrow: 11px, weight 900, 0.1em uppercase
  - xs: 11px · sm: 12px · base: 13px · md: 14px · lg: 16px · xl: 20px
  - display number: 32px, tabular-nums
- **Radii:** cards 12px, inputs 10px, pills 999px.
- **Surfaces:** keep current hues, slightly refined surface steps for depth;
  keep `--line` borders with a stronger `--line-strong` on hover/focus.
- **Palette:** keep `--green`, `--amber`, `--red`, `--blue`, `--ink`, `--muted`.

## Layout & shell

- Increase shell vertical padding and rhythm; major section gaps 20–24px.
- Shell width stays `min(1440px, 100vw - 28px)`, centered.

## Topbar

Two clear groups with hierarchy:

- **Left:** identity block (eyebrow `OpenCode Go` + title `Quota console`).
- **Right:** actions grouped by importance:
  - Primary: `Add account` (primary style).
  - Utility group: `Refresh all`, `Copy best key`, `Export keys`.
  - Status pill (current status text).
  - `Logout` (subtle).
- Clearer gaps between groups; clean wrap on narrow viewports.

## Summary cards (3)

`Available`, `Quota low`, `Needs attention`.

- Larger min-height (~96px), padding ~18px.
- Layout: big number (32px, tabular-nums) + label (sm, muted) + colored accent
  stripe on top tied to the card's semantic level.
- Consistent baseline alignment across the three cards.
- Grid stays 3 columns on desktop, 1 column on mobile.

## Monitoring bar (above the table)

Single clean line replacing the current cramped toolbar:

- Left: `N accounts · Last check Xm ago` (combines `accountCount` and
  `healthText`).
- Right: `Reload` icon button.

## Table (primary surface)

The table stays as the data view. Improvements:

- **Cell padding:** 14px vertical / 16px horizontal (was 8px / 10px).
- **Header row:** refined sticky header, consistent with type scale.
- **Account cell:** name (strong) over id (muted, mono), tidy vertical rhythm.
- **Workspace cell:** mono code, clean ellipsis truncation.
- **Quota cells (5h / Weekly / Monthly):** wider (~150px), single consistent
  layout:
  1. meter bar (6px tall, rounded),
  2. one line: `<percent>` (md, strong) + `resets in Xh` (xs, muted),
  3. below: `$remaining / $limit` (xs, muted).
  - Level coloring unchanged: `ok` / `warning` / `critical`.
- **API key cell:** pill + masked key (mono), aligned.
- **Status cell:** pill + detail line, aligned.
- Row hover and sticky-header behavior preserved.

## Action buttons (structure change)

Replace the cryptic single-letter buttons (`R`, `K`, `C`, `Open`, `E`, `×`)
with a right-aligned group of 32px icon buttons containing 16px inline SVG
icons, each with a `title` tooltip:

- refresh (`data-action="check"`)
- key-check (`data-action="key-check"`)
- copy key (`data-action="key-copy"`)
- open dashboard (`data-action="browser-open"`) — labeled "Open" wide button kept
- edit (`data-action="edit"`)
- delete (`data-action="delete"`) — danger styling

Grouped visually: refresh · (key actions) · open · edit · delete. SVGs are
inlined in `app.js` so no new asset files or dependencies are added.

## Dialogs (account + export)

- Increase field spacing and dialog padding for air.
- Refined input focus states (consistent focus ring).
- Keep existing dialog structure and controls.

## Responsiveness

- Under ~760px: topbar stacks, summary becomes 1 column, table scrolls
  horizontally (unchanged), action button group remains usable (icons compact).

## Files touched

- `public/styles.css` — token set, spacing/type scale, all component styles.
- `public/app.js` — `renderTable` (quota cell + action buttons markup with
  inline SVG), `renderSummary` (card markup), topbar markup is in HTML.
- `public/admin.html` — topbar grouping markup only.

## Out of scope / risks

- Inline SVG increases `app.js` size slightly; acceptable, no new deps.
- No behavioral change; existing tests (HTTP/API level) are unaffected since
  this is a render-layer-only change.
