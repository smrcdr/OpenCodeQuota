import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AccountStore, normalizeAuthCookie, normalizeWorkspaceId } from "../src/accounts.js";
import { QuotaState } from "../src/quota-state.js";

test("disabled accounts are skipped", async () => {
  let calls = 0;
  const { store, cleanup } = await createStore();
  try {
    await store.add({ id: "off", name: "Off", workspaceId: "workspace", authCookie: "cookie", enabled: false });
    const state = new QuotaState({
      accounts: store,
      scrapeAccount: async () => {
        calls += 1;
        return { success: true, windows: {} };
      },
    });
    await state.checkAll();
    assert.equal(calls, 0);
    assert.equal(state.getQuota("off").status, "disabled");
  } finally {
    await cleanup();
  }
});

test("failed scrape preserves previous snapshot as stale", async () => {
  const { store, cleanup } = await createStore();
  try {
    await store.add({ id: "go", name: "Go", workspaceId: "workspace", authCookie: "cookie", enabled: true });
    let fail = false;
    const state = new QuotaState({
      accounts: store,
      scrapeAccount: async () => {
        if (fail) return { success: false, error: "dashboard changed", latencyMs: 2 };
        return {
          success: true,
          latencyMs: 1,
          windows: { rolling: { percentRemaining: 77, resetAt: new Date().toISOString() } },
        };
      },
    });

    await state.checkAccount("go");
    fail = true;
    const snapshot = await state.checkAccount("go");
    assert.equal(snapshot.status, "error");
    assert.equal(snapshot.stale, true);
    assert.equal(snapshot.windows.rolling.percentRemaining, 77);
  } finally {
    await cleanup();
  }
});

test("auth cookie normalization accepts a full cookie header", () => {
  assert.equal(normalizeAuthCookie("theme=dark; auth=secret-value; other=1"), "secret-value");
  assert.equal(normalizeAuthCookie("auth=secret-value"), "secret-value");
  assert.equal(normalizeAuthCookie("secret-value"), "secret-value");
});

test("workspace normalization accepts a full workspace URL", () => {
  assert.equal(
    normalizeWorkspaceId("https://opencode.ai/workspace/wrk_01KVYH5EXZPT28HNAMKQS9Q5V4/go"),
    "wrk_01KVYH5EXZPT28HNAMKQS9Q5V4",
  );
  assert.equal(normalizeWorkspaceId("wrk_01ABC"), "wrk_01ABC");
});

async function createStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "opencode-quota-state-"));
  const store = new AccountStore(path.join(dir, "accounts.json"));
  await store.load();
  return {
    store,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
