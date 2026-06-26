# Admin UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the OpenCode Go Quota admin console into a clean, well-aligned, spacious dark dashboard without changing any functionality or API.

**Architecture:** Render-layer-only changes across three static files served from `public/` at `/assets/*` and `/admin`. CSS gains a token system (spacing/type scale) and all component styles are rewritten for consistent rhythm. `admin.html` gets grouped topbar + monitoring-bar markup. `app.js` render functions are updated for summary cards, table cells, and SVG icon action buttons. No endpoints, request shapes, or behavior change.

**Tech Stack:** Vanilla HTML/CSS/ES-modules, Node `http` server (existing). No new dependencies.

## Global Constraints

- Files in scope: `public/admin.html`, `public/styles.css`, `public/app.js` only. Do NOT touch `src/`.
- Keep the dark theme and the semantic palette (`--green`/`--amber`/`--red`/`--blue`) — only refine, do not change the hue language.
- Preserve every `data-action` value and `id` used by `app.js` event handlers: `check`, `key-check`, `key-copy`, `browser-open`, `edit`, `delete`. Preserve all element `id`s referenced in `app.js` `els` (e.g. `statusText`, `refreshAllButton`, `summaryGrid`, `accountCount`, `healthText`, `quotaRows`, `reloadButton`, `addButton`, etc.).
- Do NOT add npm dependencies. Inline any SVGs.
- Project uses `node --test` for its existing API tests. Per `CLAUDE.md`, prefer `bun` to run the server: `bun src/server.js`.
- This is a UI change with no unit-test framework for the frontend. Verification per task = (a) JS parse check, (b) boot server + load `/admin` with no console errors, (c) visual check against the task's acceptance criteria, (d) `node --test` regression at the end.

## Verification setup (used by every task)

The server needs `ADMIN_TOKEN` to reveal keys, but `/admin` loads and renders with an empty store without it. To see populated data, seed an example account:

```bash
cp -n config/accounts.example.json config/accounts.json 2>/dev/null || true
ADMIN_TOKEN=devtest bun src/server.js
```

Then open `http://127.0.0.1:40129/admin` and log in with token `devtest` (login works even with zero accounts — add one via the UI to see the table). Use the browser DevTools Console to confirm no errors.

---

### Task 1: Replace `public/styles.css` with the token-based design system

**Files:**
- Modify: `public/styles.css` (full rewrite — same path, same filename so `/assets/styles.css` still resolves)

**Interfaces:**
- Consumes: class names already emitted by `app.js` (`summary-item`, `meter`, `quota-cell`, `quota-line`, `pill`, `actions-cell`, `workspace-code`, etc.)
- Produces: the complete stylesheet that Tasks 2–3's new markup also relies on (adds `.action-group`, `.action-divider`, `.summary-item .label`, `.cell-detail`, `.quota-limit`, `.row-actions`, `.meta`, `.dot`, `.sub`). These new classes are introduced here so the HTML/JS tasks can use them.

- [ ] **Step 1: Replace the entire contents of `public/styles.css` with the stylesheet below.**

```css
:root {
  color-scheme: dark;
  --bg: #0c0d0f;
  --surface: #13161a;
  --surface-2: #181c21;
  --surface-3: #20262d;
  --surface-raised: #161a1f;
  --ink: #f1eee7;
  --muted: #9099a4;
  --muted-2: #68727d;
  --line: #282f37;
  --line-strong: #3e4854;
  --green: #78d59f;
  --green-ink: #07120b;
  --amber: #e7c26b;
  --red: #f07f74;
  --blue: #9ebbe8;
  --radius-card: 12px;
  --radius-input: 10px;
  --radius: 10px;
  --shadow: 0 18px 52px rgba(0, 0, 0, 0.28);
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-5: 20px;
  --s-6: 24px;
  --s-8: 32px;
  --fs-xs: 11px;
  --fs-sm: 12px;
  --fs-base: 13px;
  --fs-md: 14px;
  --fs-lg: 16px;
  --fs-xl: 20px;
  --fs-3xl: 32px;
  font-family: "Aptos", "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  font-variant-numeric: tabular-nums;
}

* { box-sizing: border-box; }

body {
  min-height: 100dvh;
  margin: 0;
  color: var(--ink);
  background:
    radial-gradient(circle at 24px 24px, rgba(255, 255, 255, 0.035) 1px, transparent 1px) 0 0 / 34px 34px,
    linear-gradient(180deg, rgba(158, 187, 232, 0.08), transparent 280px),
    var(--bg);
}

body.locked { display: grid; place-items: center; }
button, input, textarea { font: inherit; }
button { cursor: pointer; }

.shell {
  width: min(1440px, calc(100vw - 28px));
  margin: 0 auto;
  padding: var(--s-6) 0 var(--s-8);
}

/* ---------- Topbar ---------- */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  margin-bottom: var(--s-6);
}

.topbar h1, .login h1 {
  margin: 0;
  font-size: clamp(26px, 3vw, 42px);
  line-height: 1;
  text-wrap: balance;
}

.eyebrow {
  margin: 0 0 var(--s-2);
  color: var(--blue);
  font-size: var(--fs-xs);
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.topbar-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-2);
}

.action-group {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
}

.action-divider {
  width: 1px;
  align-self: stretch;
  margin: 4px var(--s-1);
  background: var(--line);
}

/* ---------- Buttons ---------- */
.button, .icon-button {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--ink);
  background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, color 160ms ease;
}

.button {
  min-height: 38px;
  padding: 0 var(--s-3);
  font-size: var(--fs-base);
  font-weight: 700;
}

.button.primary {
  border-color: var(--green);
  color: var(--green-ink);
  background: linear-gradient(180deg, #90e4b1, var(--green));
}

.button.subtle { color: var(--muted); }

.icon-button {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  color: var(--muted);
}

.icon-button svg { width: 16px; height: 16px; display: block; }

.icon-button.wide {
  width: auto;
  min-width: 64px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-1);
  padding: 0 var(--s-2);
  font-size: var(--fs-xs);
  font-weight: 800;
}

.icon-button.danger {
  color: var(--red);
  border-color: rgba(240, 127, 116, 0.38);
  background: rgba(240, 127, 116, 0.08);
}

.button:hover, .icon-button:hover {
  border-color: var(--line-strong);
  background: #252c34;
  color: var(--ink);
  transform: translateY(-1px);
}

.button:active, .icon-button:active { transform: translateY(0) scale(0.98); }

.button:focus-visible, .icon-button:focus-visible, input:focus-visible, textarea:focus-visible {
  outline: 2px solid rgba(158, 187, 232, 0.78);
  outline-offset: 2px;
}

/* ---------- Status ---------- */
.status {
  min-width: 92px;
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  background: rgba(19, 22, 26, 0.82);
  text-align: center;
  font-size: var(--fs-sm);
}

.status.saved { color: var(--green); border-color: rgba(120, 213, 159, 0.42); }
.status.dirty { color: var(--amber); border-color: rgba(231, 194, 107, 0.44); }
.status.error { color: var(--red); border-color: rgba(240, 127, 116, 0.44); }

/* ---------- Summary cards ---------- */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-3);
  margin-bottom: var(--s-5);
}

.summary-item {
  position: relative;
  min-height: 96px;
  padding: var(--s-5);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: rgba(19, 22, 26, 0.88);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.summary-item::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: var(--line-strong);
}

.summary-item.ok::before { background: var(--green); }
.summary-item.warning::before { background: var(--amber); }
.summary-item.critical::before { background: var(--red); }

.summary-item .label {
  display: block;
  color: var(--muted);
  font-size: var(--fs-sm);
  font-weight: 700;
}

.summary-item strong {
  display: block;
  margin-top: var(--s-2);
  font-size: var(--fs-3xl);
  font-weight: 800;
  line-height: 1;
}

/* ---------- Monitoring bar ---------- */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  margin-bottom: var(--s-3);
  padding: 0 var(--s-1);
  color: var(--muted);
  font-size: var(--fs-base);
}

.toolbar .meta { display: flex; align-items: baseline; gap: var(--s-3); flex-wrap: wrap; }
.toolbar strong { color: var(--ink); font-weight: 700; }
.toolbar .dot { color: var(--muted-2); }

/* ---------- Table ---------- */
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: rgba(19, 22, 26, 0.94);
  box-shadow: var(--shadow);
}

table {
  width: 100%;
  min-width: 1100px;
  border-collapse: collapse;
}

th, td {
  padding: var(--s-3) var(--s-4);
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: middle;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--muted);
  background: rgba(24, 28, 33, 0.98);
  font-size: var(--fs-xs);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

td { font-size: var(--fs-base); }

tbody tr { transition: background 140ms ease; }
tbody tr:hover { background: rgba(158, 187, 232, 0.045); }
tbody tr:last-child td { border-bottom: 0; }

td strong {
  display: block;
  margin-bottom: var(--s-1);
  font-weight: 760;
  line-height: 1.15;
}

td .sub { display: block; color: var(--muted); }

td code {
  color: var(--blue);
  white-space: nowrap;
  font-size: var(--fs-sm);
}

.workspace-code {
  display: inline-block;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}

/* ---------- Quota cell ---------- */
.quota-cell { min-width: 150px; }

.meter {
  width: 140px;
  height: 6px;
  margin-bottom: var(--s-2);
  overflow: hidden;
  border-radius: 999px;
  background: #30363e;
}

.meter span { display: block; height: 100%; min-width: 2px; }
.meter.ok span { background: var(--green); }
.meter.warning span { background: var(--amber); }
.meter.critical span { background: var(--red); }

.quota-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-2);
  width: 140px;
}

.quota-line strong { margin: 0; font-size: var(--fs-md); font-weight: 800; }
.quota-line small { font-size: var(--fs-xs); color: var(--muted); }

.quota-limit { display: block; margin-top: 2px; font-size: var(--fs-xs); color: var(--muted); }

/* ---------- Pills ---------- */
.pill {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  margin: 0 0 var(--s-1);
  padding: 0 var(--s-2);
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.025);
  font-size: var(--fs-xs);
  font-weight: 800;
}

.pill.ok { color: var(--green); border-color: rgba(120, 213, 159, 0.42); }
.pill.warning { color: var(--amber); border-color: rgba(231, 194, 107, 0.44); }
.pill.critical { color: var(--red); border-color: rgba(240, 127, 116, 0.44); }

.cell-detail { display: block; font-size: var(--fs-xs); color: var(--muted); }

/* ---------- Actions cell ---------- */
.actions-cell {
  width: 240px;
  white-space: nowrap;
  text-align: right;
}

.row-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--s-1);
}

.row-actions .sep { width: 1px; align-self: stretch; margin: 3px var(--s-1); background: var(--line); }

/* ---------- Empty ---------- */
.empty {
  padding: 40px var(--s-5);
  color: var(--muted);
  text-align: center;
}

/* ---------- Login & dialogs ---------- */
.login-box, dialog {
  width: min(460px, calc(100vw - 32px));
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  color: var(--ink);
  background: var(--surface-raised);
  box-shadow: var(--shadow);
}

.login-box { padding: var(--s-6); }

dialog::backdrop { background: rgba(0, 0, 0, 0.62); }
dialog { padding: 0; }
dialog header, dialog footer { display: flex; align-items: center; gap: var(--s-3); }
dialog header, dialog footer { justify-content: space-between; padding: var(--s-4) var(--s-5); border-bottom: 1px solid var(--line); }
dialog footer { border-top: 1px solid var(--line); border-bottom: 0; }
dialog h2 { margin: 0; font-size: var(--fs-lg); }

#exportDialog { width: min(860px, calc(100vw - 32px)); }

.export-panel header,
.export-panel footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  padding: var(--s-4) var(--s-5);
}
.export-panel header { border-bottom: 1px solid var(--line); }
.export-panel footer { border-top: 1px solid var(--line); }
.export-panel h2 { margin: 0; font-size: var(--fs-lg); }

.export-body { display: grid; gap: var(--s-3); padding: var(--s-4) var(--s-5) var(--s-5); }

.segmented {
  display: inline-flex;
  width: max-content;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #0b0e10;
}

.segment {
  min-height: 32px;
  padding: 0 var(--s-3);
  border: 0;
  border-radius: 6px;
  color: var(--muted);
  background: transparent;
  font-size: var(--fs-sm);
  font-weight: 800;
}

.segment.active { color: var(--green-ink); background: var(--green); }

.export-meta { margin: 0; color: var(--muted); font-size: var(--fs-base); }

#exportText {
  min-height: 360px;
  max-height: 58vh;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: var(--fs-sm);
  line-height: 1.45;
  white-space: pre;
}

.footer-actions { display: flex; align-items: center; gap: var(--s-3); }

.account-form label, .login-box label { display: grid; gap: var(--s-2); padding: var(--s-3) var(--s-5) 0; }
.login-box label { padding-inline: 0; }

label span { color: var(--muted); font-size: var(--fs-base); font-weight: 800; }

input, textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius-input);
  color: var(--ink);
  background: #0b0e10;
  transition: border-color 160ms ease, background 160ms ease;
}

input { min-height: 42px; padding: 0 var(--s-3); }
textarea { padding: var(--s-3); resize: vertical; }

input:focus, textarea:focus { border-color: var(--blue); background: #0e1216; }

.checkbox-row { display: flex !important; align-items: center; grid-template-columns: none; }
.checkbox-row input { width: 18px; min-height: 18px; }

.form-error { min-height: 20px; margin: var(--s-2) var(--s-5); color: var(--red); }
.login-box .form-error { margin-inline: 0; }

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }

@media (max-width: 760px) {
  .topbar { align-items: flex-start; flex-direction: column; }
  .topbar-actions { width: 100%; flex-wrap: wrap; }
  .action-divider { display: none; }
  .summary-grid { grid-template-columns: 1fr; }
  .button { flex: 1 1 auto; }
}
```

- [ ] **Step 2: Verify the page still loads with no console errors.**

Boot the server (`ADMIN_TOKEN=devtest bun src/server.js`), open `http://127.0.0.1:40129/admin`. Confirm: page renders, login form looks tidy, no console errors. Existing `app.js` still emits `<span>` labels in summary cards and single-letter action buttons — they will still render acceptably (unstyled letters) until Tasks 2–3; that is expected.

Acceptance for this task: spacing/rhythm visibly improved, no layout breakage, no console errors.

- [ ] **Step 3: Commit.**

```bash
git add public/styles.css
git commit -m "Redesign admin UI stylesheet with token-based spacing/type scale"
```

---

### Task 2: Group topbar actions and refine monitoring bar in `public/admin.html`

**Files:**
- Modify: `public/admin.html` (topbar block lines ~26–39 and toolbar block lines ~43–49)

**Interfaces:**
- Consumes: classes from Task 1 (`.action-group`, `.action-divider`, `.meta`, `.dot`, `.icon-button`).
- Produces: same element `id`s so `app.js` wiring is unaffected. Adds an inline SVG to `#reloadButton`.

- [ ] **Step 1: Replace the topbar `<header class="topbar">…</header>` block.**

Find this exact block:

```html
        <header class="topbar">
          <div>
            <p class="eyebrow">OpenCode Go</p>
            <h1>Quota console</h1>
          </div>
          <div class="topbar-actions">
            <span class="status" id="statusText">Загрузка</span>
            <button class="button" id="refreshAllButton" type="button">Refresh all</button>
            <button class="button" id="copyBestKeyButton" type="button">Copy best key</button>
            <button class="button" id="exportKeysButton" type="button">Export keys</button>
            <button class="button" id="addButton" type="button">Add account</button>
            <button class="button subtle" id="logoutButton" type="button">Logout</button>
          </div>
        </header>
```

Replace with:

```html
        <header class="topbar">
          <div>
            <p class="eyebrow">OpenCode Go</p>
            <h1>Quota console</h1>
          </div>
          <div class="topbar-actions">
            <span class="status" id="statusText">Загрузка</span>
            <div class="action-group">
              <button class="button" id="refreshAllButton" type="button">Refresh all</button>
              <button class="button" id="copyBestKeyButton" type="button">Copy best key</button>
              <button class="button" id="exportKeysButton" type="button">Export keys</button>
            </div>
            <button class="button primary" id="addButton" type="button">Add account</button>
            <span class="action-divider"></span>
            <button class="button subtle" id="logoutButton" type="button">Logout</button>
          </div>
        </header>
```

- [ ] **Step 2: Replace the monitoring-bar `<section class="toolbar">…</section>` block.**

Find this exact block:

```html
        <section class="toolbar" aria-label="Статус мониторинга">
          <div>
            <strong id="accountCount">0 accounts</strong>
            <span id="healthText">No checks yet</span>
          </div>
          <button class="icon-button" id="reloadButton" type="button" title="Reload">↻</button>
        </section>
```

Replace with:

```html
        <section class="toolbar" aria-label="Статус мониторинга">
          <div class="meta">
            <strong id="accountCount">0 accounts</strong>
            <span class="dot">·</span>
            <span id="healthText">No checks yet</span>
          </div>
          <button class="icon-button" id="reloadButton" type="button" title="Reload" aria-label="Reload">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
          </button>
        </section>
```

- [ ] **Step 3: Verify.**

Reload `/admin`. Confirm: `Add account` is the green primary button, the three utility buttons sit together, a thin divider separates `Logout`, and the monitoring bar reads `0 accounts · No checks yet` with the reload icon on the right. Click `Logout` then log back in to confirm wiring still works. No console errors.

- [ ] **Step 4: Commit.**

```bash
git add public/admin.html
git commit -m "Group topbar actions and refine monitoring bar markup"
```

---

### Task 3: Update `public/app.js` render functions (summary cards, table cells, SVG action buttons)

**Files:**
- Modify: `public/app.js` (add an `icons` constant; update `renderSummary`, `renderTable`, `windowCell`, `apiKeyCell`, `statusPill`)

**Interfaces:**
- Consumes: classes from Task 1 (`.summary-item .label`, `.sub`, `.cell-detail`, `.quota-limit`, `.row-actions`, `.icon-button`, `.icon-button.wide`, `.icon-button.danger`, `.sep`).
- Produces: identical `data-action`/`data-id` attributes and the same DOM structure `app.js`'s own event listener (document-level click delegation on `button[data-action]`) depends on. No handler changes.

- [ ] **Step 1: Add an `icons` constant immediately after the `exportState` declaration (after line ~53).**

Find:

```js
const exportState = {
  format: "json",
  data: null,
};
```

Insert immediately after it:

```js
const icons = {
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2"/><path d="m16 6 3 3"/><path d="m19 3 3 3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
};
```

- [ ] **Step 2: Replace `renderSummary` (whole function).**

Find:

```js
function renderSummary() {
  const available = state.availability.filter((item) => item.available).length;
  const low = state.availability.filter((item) => item.reason === "quota_low").length;
  const errors = state.availability.filter((item) => ["error", "stale", "pending"].includes(item.reason)).length;
  const cards = [
    ["Available", available],
    ["Quota low", low],
    ["Needs attention", errors],
  ];
  els.summaryGrid.replaceChildren(...cards.map(([label, value]) => {
    const item = document.createElement("article");
    item.className = "summary-item";
    item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    return item;
  }));
}
```

Replace with:

```js
function renderSummary() {
  const available = state.availability.filter((item) => item.available).length;
  const low = state.availability.filter((item) => item.reason === "quota_low").length;
  const errors = state.availability.filter((item) => ["error", "stale", "pending"].includes(item.reason)).length;
  const cards = [
    ["Available", available, "ok"],
    ["Quota low", low, "warning"],
    ["Needs attention", errors, "critical"],
  ];
  els.summaryGrid.replaceChildren(...cards.map(([label, value, level]) => {
    const item = document.createElement("article");
    item.className = `summary-item ${level}`;
    item.innerHTML = `<span class="label">${label}</span><strong>${value}</strong>`;
    return item;
  }));
}
```

- [ ] **Step 3: Replace `renderTable` (whole function).**

Find:

```js
function renderTable() {
  els.quotaRows.replaceChildren();
  els.emptyState.hidden = state.accounts.length > 0;
  for (const quota of state.quota) {
    const availability = state.availability.find((item) => item.id === quota.id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(quota.name)}</strong>
        <span>${escapeHtml(quota.id)}</span>
      </td>
      <td><code class="workspace-code">${escapeHtml(quota.workspaceId)}</code></td>
      ${windowCell(quota.windows?.rolling)}
      ${windowCell(quota.windows?.weekly)}
      ${windowCell(quota.windows?.monthly)}
      <td>${apiKeyCell(quota)}</td>
      <td>${statusPill(quota, availability)}</td>
      <td class="actions-cell">
        <button class="icon-button" data-action="check" data-id="${escapeAttr(quota.id)}" title="Refresh">R</button>
        <button class="icon-button" data-action="key-check" data-id="${escapeAttr(quota.id)}" title="Check API key">K</button>
        <button class="icon-button" data-action="key-copy" data-id="${escapeAttr(quota.id)}" title="Copy API key">C</button>
        <button class="icon-button wide" data-action="browser-open" data-id="${escapeAttr(quota.id)}" title="Open dashboard">Open</button>
        <button class="icon-button" data-action="edit" data-id="${escapeAttr(quota.id)}" title="Edit">E</button>
        <button class="icon-button danger" data-action="delete" data-id="${escapeAttr(quota.id)}" title="Delete">×</button>
      </td>
    `;
    els.quotaRows.append(tr);
  }
}
```

Replace with:

```js
function renderTable() {
  els.quotaRows.replaceChildren();
  els.emptyState.hidden = state.accounts.length > 0;
  for (const quota of state.quota) {
    const availability = state.availability.find((item) => item.id === quota.id);
    const id = escapeAttr(quota.id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(quota.name)}</strong>
        <span class="sub">${escapeHtml(quota.id)}</span>
      </td>
      <td><code class="workspace-code">${escapeHtml(quota.workspaceId)}</code></td>
      ${windowCell(quota.windows?.rolling)}
      ${windowCell(quota.windows?.weekly)}
      ${windowCell(quota.windows?.monthly)}
      <td>${apiKeyCell(quota)}</td>
      <td>${statusPill(quota, availability)}</td>
      <td class="actions-cell">
        <div class="row-actions">
          <button class="icon-button" data-action="check" data-id="${id}" title="Refresh">${icons.refresh}</button>
          <button class="icon-button" data-action="key-check" data-id="${id}" title="Check API key">${icons.key}</button>
          <button class="icon-button" data-action="key-copy" data-id="${id}" title="Copy API key">${icons.copy}</button>
          <span class="sep"></span>
          <button class="icon-button wide" data-action="browser-open" data-id="${id}" title="Open dashboard">${icons.external}<span>Open</span></button>
          <span class="sep"></span>
          <button class="icon-button" data-action="edit" data-id="${id}" title="Edit">${icons.edit}</button>
          <button class="icon-button danger" data-action="delete" data-id="${id}" title="Delete">${icons.trash}</button>
        </div>
      </td>
    `;
    els.quotaRows.append(tr);
  }
}
```

- [ ] **Step 4: Replace `windowCell` (whole function).**

Find:

```js
function windowCell(window) {
  if (!window) {
    return `<td><span class="muted">Waiting</span></td>`;
  }
  const level = window.percentRemaining < 10 ? "critical" : window.percentRemaining < 25 ? "warning" : "ok";
  return `
    <td class="quota-cell">
      <div class="meter ${level}">
        <span style="width:${window.percentRemaining}%"></span>
      </div>
      <div class="quota-line">
        <strong>${formatPercent(window.percentRemaining)}</strong>
        <small>${formatReset(window.resetAt)}</small>
      </div>
      <small>${formatMoney(window.remainingUsd)} / ${formatMoney(window.limitUsd)}</small>
    </td>
  `;
}
```

Replace with:

```js
function windowCell(window) {
  if (!window) {
    return `<td class="quota-cell"><span class="cell-detail">Waiting</span></td>`;
  }
  const level = window.percentRemaining < 10 ? "critical" : window.percentRemaining < 25 ? "warning" : "ok";
  return `
    <td class="quota-cell">
      <div class="meter ${level}">
        <span style="width:${window.percentRemaining}%"></span>
      </div>
      <div class="quota-line">
        <strong>${formatPercent(window.percentRemaining)}</strong>
        <small>${formatReset(window.resetAt)}</small>
      </div>
      <span class="quota-limit">${formatMoney(window.remainingUsd)} / ${formatMoney(window.limitUsd)}</span>
    </td>
  `;
}
```

- [ ] **Step 5: Replace `apiKeyCell` (whole function).**

Find:

```js
function apiKeyCell(account) {
  if (account.apiKeyFound) {
    return `<span class="pill ok">found</span><small class="mono">${escapeHtml(account.apiKeyMasked)}</small>`;
  }
  if (account.apiKeyError) {
    return `<span class="pill critical">missing</span><small>${escapeHtml(account.apiKeyError)}</small>`;
  }
  return `<span class="pill">not checked</span><small>Use check key</small>`;
}
```

Replace with:

```js
function apiKeyCell(account) {
  if (account.apiKeyFound) {
    return `<span class="pill ok">found</span><span class="cell-detail mono">${escapeHtml(account.apiKeyMasked)}</span>`;
  }
  if (account.apiKeyError) {
    return `<span class="pill critical">missing</span><span class="cell-detail">${escapeHtml(account.apiKeyError)}</span>`;
  }
  return `<span class="pill">not checked</span><span class="cell-detail">Use check key</span>`;
}
```

- [ ] **Step 6: Replace `statusPill` (whole function).**

Find:

```js
function statusPill(quota, availability) {
  const reason = availability?.reason || quota.status;
  const label = quota.stale ? "stale" : reason;
  const level = availability?.available ? "ok" : reason === "quota_low" ? "warning" : "critical";
  const detail = quota.error ? `<small>${escapeHtml(quota.error)}</small>` : `<small>${quota.checkedAt ? formatDate(quota.checkedAt) : "Not checked"}</small>`;
  return `<span class="pill ${level}">${escapeHtml(label)}</span>${detail}`;
}
```

Replace with:

```js
function statusPill(quota, availability) {
  const reason = availability?.reason || quota.status;
  const label = quota.stale ? "stale" : reason;
  const level = availability?.available ? "ok" : reason === "quota_low" ? "warning" : "critical";
  const detail = quota.error
    ? `<span class="cell-detail">${escapeHtml(quota.error)}</span>`
    : `<span class="cell-detail">${quota.checkedAt ? formatDate(quota.checkedAt) : "Not checked"}</span>`;
  return `<span class="pill ${level}">${escapeHtml(label)}</span>${detail}`;
}
```

- [ ] **Step 7: Syntax-check the JS.**

Run: `node --check public/app.js`
Expected: no output, exit 0.

- [ ] **Step 8: Verify in browser.**

Reload `/admin`, add a test account (any workspace id + fake cookie is fine — it will show a quota check error, which exercises the error/status cells), and confirm:
- Summary cards: large numbers, colored top accent (green/amber/red), label below the accent.
- Table row: account name over muted id; workspace code truncates cleanly; each quota cell shows meter + `XX%`/`resets in …` on one line + `$x / $y` underneath; API key + status cells show a pill over a muted detail line.
- Action buttons: SVG icons in 32px squares, grouped with thin separators, `Open` is an icon+label wide button, delete is red. Hover each to see tooltips. Click `Refresh` (R→refresh) on a row to confirm the `data-action="check"` delegation still fires.
- No console errors.

- [ ] **Step 9: Commit.**

```bash
git add public/app.js
git commit -m "Render summary cards, table cells, and SVG action buttons"
```

---

### Task 4: Regression tests and final visual verification

**Files:**
- None modified. Verification only.

- [ ] **Step 1: Run the existing test suite (regression).**

Run: `node --test`
Expected: all existing tests pass (these cover API/auth/static serving and are unaffected by render-layer changes; this confirms no routing or static-file regression).

- [ ] **Step 2: Full visual pass at `http://127.0.0.1:40129/admin`.**

Check against the design spec acceptance criteria:
- Consistent spacing/rhythm everywhere; no cramped gaps.
- Topbar: identity left, grouped actions right, `Add account` primary.
- Summary cards equal height, aligned baselines, semantic accents.
- Monitoring bar one clean line + reload icon.
- Table: generous cell padding, aligned quota columns, clear icon actions.
- Dialogs (open Add/Edit account and Export keys): tidy field spacing, visible focus rings on inputs.
- Resize to ~700px wide: topbar stacks, summary collapses to one column, table scrolls horizontally, action icons stay usable.

- [ ] **Step 3: Commit nothing (verification-only).** If any issue was found and fixed, commit the fix with a descriptive message; otherwise no commit.

---

## Self-Review notes

- **Spec coverage:** Tokens (Task 1); shell/rhythm (Task 1); topbar grouping (Task 2); summary cards (Tasks 1+3); monitoring bar (Tasks 1+2); table padding/headers (Task 1); account/workspace/quota/key/status cells (Tasks 1+3); SVG action buttons (Tasks 1+3); dialogs polish (Task 1); responsiveness (Task 1). All spec sections covered.
- **No placeholders:** every code step contains final code; verification steps contain exact commands and expected results.
- **Type/name consistency:** class names introduced in Task 1 (`.action-group`, `.action-divider`, `.summary-item .label`, `.sub`, `.cell-detail`, `.quota-limit`, `.row-actions`, `.sep`, `.meta`, `.dot`) are exactly the names used in Tasks 2–3. `data-action` values (`check`, `key-check`, `key-copy`, `browser-open`, `edit`, `delete`) and all `id`s are preserved verbatim from the original so `app.js` event wiring is untouched.
