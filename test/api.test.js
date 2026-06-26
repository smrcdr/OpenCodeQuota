import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AccountStore } from "../src/accounts.js";
import { createQuotaApp } from "../src/server.js";

test("API protects mutation endpoints and masks secrets", async (t) => {
  const app = await createTestApp(t, {
    adminToken: "secret",
    scrapeAccount: async () => successQuota(20),
  });

  const unauthorized = await fetch(app.url("/api/accounts"), {
    method: "POST",
    body: JSON.stringify(accountBody()),
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(unauthorized.status, 401);

  const created = await authedFetch(app, "/api/accounts", {
    method: "POST",
    body: JSON.stringify(accountBody()),
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(created.status, 201);

  const listed = await authedJson(app, "/api/accounts");
  assert.equal(listed.accounts[0].authCookie, "cook...alue");
});

test("manual account check updates quota", async (t) => {
  const app = await createTestApp(t, {
    scrapeAccount: async () => successQuota(35),
  });
  await app.accounts.add(accountBody());

  const checked = await authedJson(app, "/api/accounts/go-main/check", { method: "POST" });
  assert.equal(checked.account.status, "ok");
  assert.equal(checked.account.windows.rolling.percentRemaining, 65);

  const quota = await authedJson(app, "/api/quota/go-main");
  assert.equal(quota.account.windows.weekly.usagePercent, 35);
});

test("availability marks account unavailable when quota is low", async (t) => {
  const app = await createTestApp(t, {
    minPercentRemaining: 10,
    scrapeAccount: async () => successQuota(95),
  });
  await app.accounts.add(accountBody());
  await app.quotaState.checkAccount("go-main");

  const availability = await fetch(app.url("/api/availability")).then((res) => res.json());
  assert.equal(availability.accounts[0].available, false);
  assert.equal(availability.accounts[0].reason, "quota_low");
  assert.equal(availability.accounts[0].lowestPercentRemaining, 5);
});

test("availability marks old snapshots as stale", async (t) => {
  const app = await createTestApp(t, {
    staleAfterMs: 1,
    scrapeAccount: async () => successQuota(10),
  });
  await app.accounts.add(accountBody());
  await app.quotaState.checkAccount("go-main");
  await new Promise((resolve) => setTimeout(resolve, 5));

  const availability = await fetch(app.url("/api/availability")).then((res) => res.json());
  assert.equal(availability.accounts[0].available, false);
  assert.equal(availability.accounts[0].reason, "stale");
});

test("API key reveal requires admin auth and ordinary endpoints do not leak raw keys", async (t) => {
  const rawKey = "sk-live_secret_key_12345";
  const app = await createTestApp(t, {
    scrapeAccount: async () => successQuota(10),
    scrapeApiKey: async () => ({ success: true, apiKey: rawKey, latencyMs: 4 }),
  });
  await app.accounts.add(accountBody());
  await app.quotaState.checkAccount("go-main");

  const unauthorized = await fetch(app.url("/api/accounts/go-main/api-key/reveal"), { method: "POST" });
  assert.equal(unauthorized.status, 401);

  const checked = await authedJson(app, "/api/accounts/go-main/api-key/check", { method: "POST" });
  assert.equal(checked.account.apiKeyFound, true);
  assert.equal(checked.account.apiKeyMasked, "sk-l...2345");

  for (const pathname of ["/api/accounts", "/api/quota", "/api/availability", "/health"]) {
    const response = pathname.startsWith("/api/a") && pathname !== "/api/availability"
      ? await authedFetch(app, pathname)
      : await fetch(app.url(pathname), pathname === "/api/accounts" || pathname === "/api/quota"
        ? { headers: { Authorization: "Bearer secret" } }
        : undefined);
    const text = await response.text();
    assert.doesNotMatch(text, new RegExp(rawKey), `${pathname} leaked raw key`);
  }
});

test("API key reveal returns raw key only through admin endpoint", async (t) => {
  const rawKey = "sk-live_reveal_key_12345";
  const app = await createTestApp(t, {
    scrapeApiKey: async () => ({ success: true, apiKey: rawKey, latencyMs: 4 }),
  });
  await app.accounts.add(accountBody());

  const revealed = await authedJson(app, "/api/accounts/go-main/api-key/reveal", { method: "POST" });
  assert.equal(revealed.account.id, "go-main");
  assert.equal(revealed.apiKey, rawKey);
  assert.equal(revealed.status.apiKeyMasked, "sk-l...2345");
});

test("API key reveal is blocked when ADMIN_TOKEN is not configured", async (t) => {
  const app = await createTestApp(t, {
    adminToken: "",
    scrapeApiKey: async () => ({ success: true, apiKey: "sk-live_open_admin_key_12345", latencyMs: 4 }),
  });
  await app.accounts.add(accountBody());

  const response = await fetch(app.url("/api/accounts/go-main/api-key/reveal"), { method: "POST" });
  assert.equal(response.status, 401);
  const text = await response.text();
  assert.doesNotMatch(text, /sk-live_open_admin_key_12345/);
});

test("best reveal chooses an available account with a discovered key", async (t) => {
  const rawKey = "sk-live_best_key_12345";
  const app = await createTestApp(t, {
    minPercentRemaining: 10,
    scrapeAccount: async (account) => successQuota(account.id === "low" ? 99 : 10),
    scrapeApiKey: async (account) => ({ success: true, apiKey: account.id === "low" ? "sk-live_low_key_99999" : rawKey, latencyMs: 4 }),
  });
  await app.accounts.add({ ...accountBody(), id: "low", name: "Low" });
  await app.accounts.add({ ...accountBody(), id: "good", name: "Good" });
  await app.quotaState.checkAll();

  const revealed = await authedJson(app, "/api/api-key/best/reveal", { method: "POST" });
  assert.equal(revealed.account.id, "good");
  assert.equal(revealed.apiKey, rawKey);
});

test("API key export requires admin auth and returns all account key results", async (t) => {
  const keys = new Map([
    ["one", "sk-live_export_one_12345"],
    ["two", "sk-live_export_two_67890"],
  ]);
  const app = await createTestApp(t, {
    scrapeApiKey: async (account) => ({ success: true, apiKey: keys.get(account.id), latencyMs: 4 }),
  });
  await app.accounts.add({ ...accountBody(), id: "one", name: "One" });
  await app.accounts.add({ ...accountBody(), id: "two", name: "Two" });

  const unauthorized = await fetch(app.url("/api/api-key/export"), { method: "POST" });
  assert.equal(unauthorized.status, 401);

  const exported = await authedJson(app, "/api/api-key/export", { method: "POST" });
  assert.equal(exported.count, 2);
  assert.equal(exported.found, 2);
  assert.deepEqual(exported.accounts.map((item) => item.account.id), ["one", "two"]);
  assert.deepEqual(exported.accounts.map((item) => item.apiKey), [
    "sk-live_export_one_12345",
    "sk-live_export_two_67890",
  ]);
  assert.equal(exported.accounts[0].status.apiKeyMasked, "sk-l...2345");
});

test("API key export is blocked when ADMIN_TOKEN is not configured", async (t) => {
  const app = await createTestApp(t, {
    adminToken: "",
    scrapeApiKey: async () => ({ success: true, apiKey: "sk-live_export_open_admin_12345", latencyMs: 4 }),
  });
  await app.accounts.add(accountBody());

  const response = await fetch(app.url("/api/api-key/export"), { method: "POST" });
  assert.equal(response.status, 401);
  const text = await response.text();
  assert.doesNotMatch(text, /sk-live_export_open_admin_12345/);
});

test("browser open endpoint requires admin auth and returns safe session metadata", async (t) => {
  const browserSessions = mockBrowserSessions();
  const app = await createTestApp(t, { browserSessions });
  await app.accounts.add(accountBody());

  const unauthorized = await fetch(app.url("/api/accounts/go-main/browser/open"), { method: "POST" });
  assert.equal(unauthorized.status, 401);

  const opened = await authedJson(app, "/api/accounts/go-main/browser/open", { method: "POST" });
  assert.equal(opened.session.accountId, "go-main");
  assert.equal(opened.session.workspaceId, "workspace-id");
  assert.doesNotMatch(JSON.stringify(opened), /cookie-value/);
  assert.equal(browserSessions.opened[0].authCookie, "cookie-value");
});

test("browser open endpoint requires configured ADMIN_TOKEN", async (t) => {
  const app = await createTestApp(t, { adminToken: "", browserSessions: mockBrowserSessions() });
  await app.accounts.add(accountBody());

  const response = await fetch(app.url("/api/accounts/go-main/browser/open"), { method: "POST" });
  assert.equal(response.status, 401);
});

test("browser sessions endpoint lists and closes safe sessions", async (t) => {
  const browserSessions = mockBrowserSessions();
  const app = await createTestApp(t, { browserSessions });
  await app.accounts.add(accountBody());

  await authedJson(app, "/api/accounts/go-main/browser/open", { method: "POST" });
  const listed = await authedJson(app, "/api/browser/sessions");
  assert.equal(listed.sessions.length, 1);
  assert.equal(listed.sessions[0].id, "br_mock_1");
  assert.doesNotMatch(JSON.stringify(listed), /cookie-value/);

  const closed = await authedJson(app, "/api/browser/br_mock_1/close", { method: "POST" });
  assert.equal(closed.ok, true);
  const listedAfter = await authedJson(app, "/api/browser/sessions");
  assert.equal(listedAfter.sessions.length, 0);
});

test("browser open endpoint returns 404 for unknown account", async (t) => {
  const app = await createTestApp(t, { browserSessions: mockBrowserSessions() });
  const response = await authedFetch(app, "/api/accounts/missing/browser/open", { method: "POST" });
  assert.equal(response.status, 404);
});

async function createTestApp(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "opencode-quota-test-"));
  const accounts = new AccountStore(path.join(dir, "accounts.json"));
  const app = await createQuotaApp({
    accounts,
    adminToken: options.adminToken === undefined ? "secret" : options.adminToken,
    scrapeAccount: options.scrapeAccount,
    scrapeApiKey: options.scrapeApiKey,
    browserSessions: options.browserSessions,
    staleAfterMs: options.staleAfterMs ?? 180_000,
    minPercentRemaining: options.minPercentRemaining ?? 1,
    jitterMs: 0,
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    app.scheduler.stop();
    await new Promise((resolve) => app.server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  const address = app.server.address();
  return {
    ...app,
    url: (pathname) => `http://127.0.0.1:${address.port}${pathname}`,
  };
}

function mockBrowserSessions() {
  const sessions = [];
  return {
    opened: [],
    async initialize() {},
    async openAccount(account) {
      this.opened.push(account);
      const session = {
        id: `br_mock_${sessions.length + 1}`,
        accountId: account.id,
        accountName: account.name,
        workspaceId: account.workspaceId,
        url: `https://opencode.ai/workspace/${account.workspaceId}/go`,
        startedAt: "2026-06-25T18:30:00.000Z",
      };
      sessions.push(session);
      return session;
    },
    listSessions() {
      return [...sessions];
    },
    async closeSession(id) {
      const index = sessions.findIndex((session) => session.id === id);
      if (index === -1) return false;
      sessions.splice(index, 1);
      return true;
    },
  };
}

function authedFetch(app, pathname, options = {}) {
  return fetch(app.url(pathname), {
    ...options,
    headers: {
      Authorization: "Bearer secret",
      ...(options.headers || {}),
    },
  });
}

async function authedJson(app, pathname, options = {}) {
  const response = await authedFetch(app, pathname, options);
  if (!response.ok) {
    assert.fail(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

function accountBody() {
  return {
    id: "go-main",
    name: "Main Go",
    workspaceId: "workspace-id",
    authCookie: "cookie-value",
    enabled: true,
    notes: "",
  };
}

function successQuota(usagePercent) {
  const resetAt = new Date(Date.now() + 60_000).toISOString();
  return {
    success: true,
    latencyMs: 3,
    windows: {
      rolling: { usagePercent, percentRemaining: 100 - usagePercent, resetAt, limitUsd: 12 },
      weekly: { usagePercent, percentRemaining: 100 - usagePercent, resetAt, limitUsd: 30 },
      monthly: { usagePercent, percentRemaining: 100 - usagePercent, resetAt, limitUsd: 60 },
    },
  };
}
