# OpenCode Go Quota Tracker

Small local service for monitoring OpenCode Go dashboard quota across multiple
accounts/workspaces.

The service reads quota from:

```text
https://opencode.ai/workspace/{workspaceId}/go
```

It uses the user-provided `auth` cookie for that workspace and reports the 5h,
weekly, and monthly usage windows.

## Run

```bash
cp .env.example .env
cp config/accounts.example.json config/accounts.json
npm start
```

Docker deployment keeps the service private and connects it to SmartAPIV2 over
the shared `smartapi-edge` network:

```bash
docker network create smartapi-edge 2>/dev/null || true
docker compose --env-file .env up -d --build
```

Set `APP_UID=$(id -u)` and `APP_GID=$(id -g)` in `.env` so the non-root
container process can read `config/accounts.json` and write the bind-mounted
`data` directory without weakening their host permissions.

`ADMIN_TOKEN` is required by the compose stack. The host port is bound to
`127.0.0.1:40129`; other containers use `http://opencode-quota:40129`.

Admin UI:

```text
http://127.0.0.1:40129/admin
```

Health:

```bash
curl http://127.0.0.1:40129/health
```

Admin-authenticated availability endpoint:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:40129/api/availability
```

## API keys

The tracker can try to discover an OpenCode Go API key from the same dashboard
HTML used for quota checks. It uses the configured `workspaceId` and `authCookie`
and looks for a key-like `sk-...` value in dashboard state, scripts, and HTML
fields.

Raw API keys are not written to `config/accounts.json` and are not returned by
`/health`, `/api/accounts`, `/api/quota`, or `/api/availability`. They are kept
only in process memory and can be revealed only through admin-authenticated
endpoints or the admin UI copy action. Set a non-empty `ADMIN_TOKEN`; reveal
endpoints refuse to return raw keys when `ADMIN_TOKEN` is not configured.

Admin-only endpoints:

```bash
# refresh masked key status for one account
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:40129/api/accounts/go-main/api-key/check

# reveal one key, if discovered
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:40129/api/accounts/go-main/api-key/reveal

# reveal the first available account key based on current quota state
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:40129/api/api-key/best/reveal

# export all account keys as JSON; accounts without discovered keys are included
# with apiKey: null and a status error
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:40129/api/api-key/export
```

If the dashboard does not render the key into HTML, the service returns
`api_key_not_found`. In that case the next integration step is to inspect the
dashboard's Network tab and add the specific API endpoint it uses.

## Open saved account in Chrome

The admin UI can open an account dashboard in a separate Google Chrome profile.
It uses only the stored `authCookie` value, sets it as the `auth` cookie for
`opencode.ai`, and navigates to the account workspace dashboard.

This does not use your normal Chrome profile and does not return the cookie in
API responses. The feature requires a non-empty `ADMIN_TOKEN` and a desktop/GUI
environment with `google-chrome` installed.

## Config

Runtime accounts live in `config/accounts.json` and are intentionally ignored by
Git because they contain auth cookies.

```json
{
  "accounts": [
    {
      "id": "go-main",
      "name": "Main Go",
      "workspaceId": "workspace-id-from-url",
      "authCookie": "cookie-value",
      "enabled": true,
      "notes": ""
    }
  ]
}
```

The tracker only observes quota. It does not create accounts, bypass limits, or
edit proxy configuration.
