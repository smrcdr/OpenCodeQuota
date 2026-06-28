# Add Account Dialog — Tabs (Auth / JSON / Google) Design Spec

Date: 2026-06-26
Status: Approved
Scope: `public/admin.html`, `public/app.js`, `public/styles.css` (UI only; no backend changes)

## Goal

Turn the single "Add account" form into a tabbed dialog so users can add one
account (Auth cookie), many accounts at once (JSON), or paste Google accounts
(email|password|2fa). Google login is intentionally out of scope for now.

## Structure

The `#accountDialog` keeps its header (title + close) and footer (Cancel +
tab-specific primary button). Between them:

- A **tab switcher** (segmented control) — visible only in add mode.
- Three **panels**, one visible at a time.

## Tabs

1. **Auth cookie** — the existing single-account form
   (ID, Name, Workspace ID, Cookie авторизации, Notes, Enabled). Primary button:
   «Сохранить». This panel is also used standalone for **editing** (no tabs,
   title «Изменить аккаунт»).
2. **JSON** — a textarea holding a JSON array of accounts:
   `[{id,name,workspaceId,authCookie,enabled?,notes?}, …]`. Primary button:
   «Добавить все».
3. **Google** — a textarea for `email|password|2fa`, one per line. Live counter
   «Распознано: N». Note: «Вход через Google скоро». Primary button is disabled
   (stub).

## Behavior

- **Add** (no account passed): tabs visible, default Auth cookie, title
  «Добавить аккаунт».
- **Edit** (account passed): no tabs, only the Auth cookie form, title
  «Изменить аккаунт».
- Switching tabs clears that tab's error text and swaps the footer's primary
  button.
- Opening the dialog resets all three tabs' fields/errors.

## Validation & error handling

- **JSON submit:** parse JSON; reject (no requests) if not a non-empty array.
  Then POST each account to `POST /api/accounts` (client-side loop, no new
  endpoint). Collect per-account failures. On full success: close dialog, reload
  list, status «Добавлено аккаунтов: N». On partial success: keep dialog open,
  report «Создано X/Y. Ошибки: …» (created accounts are reloaded).
- **Google:** parse lines as `email|password|2fa`; count lines with at least two
  non-empty pipe-separated parts for the live counter. No persistence (login not
  implemented).

## Account payload (matches existing backend `normalizeAccount`)

Required: `id`, `name`, `workspaceId`, `authCookie`. Optional: `enabled`
(defaults true), `notes`. `id` may be omitted (auto-derived from `name`).

## Files

- `public/admin.html` — restructure `#accountDialog`: tab switcher, three
  panels, footer buttons.
- `public/app.js` — tab state + switching, `saveJsonAccounts()`, Google live
  counter, edit/add mode handling.
- `public/styles.css` — full-width segmented switcher (`.dialog-tabs`), panel
  note style.

## Non-goals

- Google login implementation, backend bulk endpoint, persisting Google drafts.
- Changing the existing single-account save flow (`saveAccount`) beyond wiring
  it to the Auth tab.
