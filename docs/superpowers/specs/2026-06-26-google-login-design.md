# Google Login via Patchright — Design Spec

Date: 2026-06-26
Status: Approved
Scope: new `src/google-login.js`, `src/server.js` (endpoint), `public/admin.html`,
`public/app.js`, `public/styles.css`; new dependency `patchright-node`.

## Goal

Implement real Google login for OpenCode Go accounts, one account at a time,
using Patchright (stealth Playwright fork). Capture the resulting `auth` cookie +
`workspaceId` and create a tracker account. Remove 2FA from the input format
(only `email|password`).

## Architecture

- **Lazy import:** `patchright-node` is imported dynamically inside
  `loginWithGoogle()` so the server starts and tests run even when the
  dependency/browser is not installed. The endpoint returns a clear error
  (`patchright_not_installed`) if missing.
- **Config-driven selectors:** all URLs and selectors live in an exported
  `GOOGLE_LOGIN_CONFIG` object at the top of `src/google-login.js`. They are
  starting placeholders the user verifies/adjusts with a real browser.
- **No credential persistence:** the Google password is used in-memory for the
  single login attempt and never written to disk or returned in responses. Only
  the resulting `auth` cookie + `workspaceId` become a normal account.

## Backend

`src/google-login.js`:
- `GOOGLE_LOGIN_CONFIG`: `authUrl`, `headed`, `googleButtonSelector`,
  `emailInputSelector`, `emailNextSelector`, `passwordInputSelector`,
  `passwordNextSelector`, `workspaceUrlPattern` (`/\/workspace\/(wrk_[A-Za-z0-9]+)/`),
  `authCookieName` (`"auth"`), `navTimeoutMs`, `stepTimeoutMs`.
- `GoogleLoginError` (carries a stable `code`).
- `loginWithGoogle({email, password})` flow:
  1. dynamically `import("patchright-node")` → `chromium.launch({ headless: !headed })`.
  2. `goto authUrl`; click `googleButtonSelector`.
  3. on accounts.google.com: fill email → click next → wait for password field
     (else detect error → throw).
  4. fill password → click next → wait for URL matching `workspaceUrlPattern`
     (else detect error → throw).
  5. parse `workspaceId` from URL; read `auth` cookie from context.
  6. `browser.close()` in `finally`; return `{workspaceId, authCookie, email}`.
- `detectGoogleError(page)` maps page text to codes: `wrong_password`,
  `unusual_activity`, `captcha`, `needs_2fa`.
- TimeoutError → `timeout`; unknown → `unknown`. Full Russian message table.

`POST /api/google-login` (in `server.js`, after admin guard, requires
`isRevealAuthorized`):
- body `{email, password}`; validate both non-empty.
- call `loginWithGoogle`; on `GoogleLoginError` → 502 `{error:{message, type:
  "google_login_error", code}}`.
- on success: `ctx.accounts.add({name: email, workspaceId, authCookie, enabled:
  true, notes: "Google login"})` (id auto-derived from email), `syncAccounts()`,
  return 201 `{account}`. If add fails (e.g. duplicate) → 409 with the workspaceId
  so the user knows login itself succeeded.

## Frontend

`public/admin.html` (Google panel):
- Format is now `email|password`; placeholder + note updated.
- Add `<div id="googleList">` for parsed rows.
- Remove the disabled footer stub (`saveGoogleButton`); Google tab has no footer
  primary action (actions live per-row).

`public/app.js`:
- `googleRows` map: `email → {password, status, message}` where status is
  `idle|loading|ok|error`.
- On textarea input: `updateGoogleCount()` + `syncGoogleRows()` +
  `renderGoogleList()`.
- `renderGoogleList()`: each parsed `email|password` → a row (email, status text,
  "Войти через Google" button). Disabled while loading.
- Document-click delegation on `button[data-google-login]` →
  `loginGoogleAccount(email)`: POST `/api/google-login`, update row status, on
  success `loadAll()` + status bar, on error show the Russian message on the row.
- `openAccountDialog` resets `googleRows`, textarea, list, count.
- `setDialogTab("google")` shows no footer primary button.

`public/styles.css`: `.google-list`, `.google-row`, `.google-email`,
`.google-status[--ok/--error/--loading]`.

## Error mapping (RU)

`wrong_password` → «Неверный пароль»; `unusual_activity` → «Google заподозрил
подозрительную активность — нужен ручной вход»; `captcha` → «Google показал
капчу/проверку — нужен ручной вход»; `needs_2fa` → «На аккаунте включена 2FA —
автоматический вход невозможен»; `no_google_button` / `no_workspace` /
`no_auth_cookie` → infra messages; `timeout` → «Превышено время ожидания при
входе»; `patchright_not_installed` → install instructions; `unknown` → generic.

## Setup (user must run once)

```bash
bun add patchright-node
bunx patchright install chromium
```

Then edit `GOOGLE_LOGIN_CONFIG` in `src/google-login.js` (real `authUrl`,
verified selectors).

## Testing & limitations

- Automated tests cover: error-code → message mapping, `detectGoogleError`
  string matching, request validation. The live Google flow cannot be tested
  here (no credentials/display) — selectors must be verified by the user in a
  real browser.
- Patchright reduces detection but does not guarantee Google won't block.

## Non-goals

- 2FA solving, captcha solving, headless-detection bypass beyond Patchright
  defaults, batch/queue login (explicitly one-at-a-time per click).
- Persisting Google passwords.
