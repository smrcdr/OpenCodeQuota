import { isoNow, maskApiKey } from "./format.js";
import { WINDOW_ORDER, queryOpenCodeGoApiKey, queryOpenCodeGoQuota } from "./scraper.js";

export class QuotaState {
  constructor({
    accounts,
    scrapeAccount = defaultScrapeAccount,
    scrapeApiKey = defaultScrapeApiKey,
    staleAfterMs = 180_000,
    minPercentRemaining = 1,
  }) {
    this.accounts = accounts;
    this.scrapeAccount = scrapeAccount;
    this.scrapeApiKey = scrapeApiKey;
    this.staleAfterMs = staleAfterMs;
    this.minPercentRemaining = minPercentRemaining;
    this.snapshots = new Map();
    this.apiKeys = new Map();
  }

  syncAccounts() {
    const ids = new Set(this.accounts.list().map((account) => account.id));
    for (const id of this.snapshots.keys()) {
      if (!ids.has(id)) {
        this.snapshots.delete(id);
      }
    }
    for (const id of this.apiKeys.keys()) {
      if (!ids.has(id)) {
        this.apiKeys.delete(id);
      }
    }
  }

  async checkAccount(id) {
    const account = this.accounts.find(id);
    if (!account) {
      return null;
    }

    return this.checkAccountObject(account);
  }

  async checkAccountObject(account) {
    const startedAt = Date.now();
    if (!account.enabled) {
      const snapshot = this.buildSnapshot(account, {
        status: "disabled",
        checkedAt: isoNow(),
        latencyMs: 0,
        error: null,
        stale: false,
        windows: null,
      });
      this.snapshots.set(account.id, snapshot);
      return snapshot;
    }

    const previous = this.snapshots.get(account.id);
    const result = await this.scrapeAccount(account);
    if (result?.success) {
      const snapshot = this.buildSnapshot(account, {
        status: "ok",
        checkedAt: isoNow(),
        latencyMs: result.latencyMs ?? Date.now() - startedAt,
        error: null,
        stale: false,
        windows: result.windows,
      });
      this.snapshots.set(account.id, snapshot);
      return snapshot;
    }

    const snapshot = this.buildSnapshot(account, {
      status: "error",
      checkedAt: isoNow(),
      latencyMs: result?.latencyMs ?? Date.now() - startedAt,
      error: result?.error || "Unknown scrape error",
      stale: Boolean(previous?.windows),
      windows: previous?.windows || null,
      lastSuccessAt: previous?.lastSuccessAt || null,
    });
    this.snapshots.set(account.id, snapshot);
    return snapshot;
  }

  async checkAll({ jitterMs = 0 } = {}) {
    const results = [];
    for (const account of this.accounts.list()) {
      if (jitterMs > 0 && results.length > 0) {
        await sleep(Math.floor(Math.random() * jitterMs));
      }
      results.push(await this.checkAccountObject(account));
    }
    this.syncAccounts();
    return results;
  }

  listQuota() {
    this.syncAccounts();
    return this.accounts.list().map((account) => this.snapshotForAccount(account));
  }

  getQuota(id) {
    const account = this.accounts.find(id);
    return account ? this.snapshotForAccount(account) : null;
  }

  listAvailability() {
    return this.listQuota().map((snapshot) => toAvailability(snapshot, {
      staleAfterMs: this.staleAfterMs,
      minPercentRemaining: this.minPercentRemaining,
    }));
  }

  getApiKeyStatus(id) {
    return toPublicApiKeyStatus(this.apiKeys.get(id));
  }

  async checkApiKey(id) {
    const account = this.accounts.find(id);
    if (!account) {
      return null;
    }

    if (!account.enabled) {
      const status = {
        found: false,
        masked: "",
        checkedAt: isoNow(),
        error: "account_disabled",
        rawApiKey: null,
        latencyMs: 0,
      };
      this.apiKeys.set(account.id, status);
      return toPublicApiKeyStatus(status);
    }

    const result = await this.scrapeApiKey(account);
    const status = result?.success
      ? {
          found: true,
          masked: maskApiKey(result.apiKey),
          checkedAt: isoNow(),
          error: null,
          rawApiKey: result.apiKey,
          latencyMs: result.latencyMs ?? null,
        }
      : {
          found: false,
          masked: "",
          checkedAt: isoNow(),
          error: result?.error || "api_key_error",
          rawApiKey: null,
          latencyMs: result?.latencyMs ?? null,
        };
    this.apiKeys.set(account.id, status);
    return toPublicApiKeyStatus(status);
  }

  async revealApiKey(id) {
    const account = this.accounts.find(id);
    if (!account) {
      return null;
    }

    let status = this.apiKeys.get(id);
    if (!status?.found || !status.rawApiKey) {
      await this.checkApiKey(id);
      status = this.apiKeys.get(id);
    }

    if (!status?.found || !status.rawApiKey) {
      return {
        account: publicAccountRef(account),
        apiKey: null,
        status: toPublicApiKeyStatus(status),
      };
    }

    return {
      account: publicAccountRef(account),
      apiKey: status.rawApiKey,
      status: toPublicApiKeyStatus(status),
    };
  }

  async revealBestApiKey() {
    const availability = this.listAvailability();
    for (const candidate of availability) {
      if (!candidate.available) {
        continue;
      }

      const revealed = await this.revealApiKey(candidate.id);
      if (revealed?.apiKey) {
        return revealed;
      }
    }
    return null;
  }

  async exportApiKeys({ includeDisabled = false } = {}) {
    const exportedAt = isoNow();
    const accounts = [];

    for (const account of this.accounts.list()) {
      if (!includeDisabled && !account.enabled) {
        accounts.push({
          account: publicAccountRef(account),
          enabled: account.enabled,
          apiKey: null,
          status: {
            ...this.getApiKeyStatus(account.id),
            apiKeyError: this.getApiKeyStatus(account.id).apiKeyError || "account_disabled",
          },
        });
        continue;
      }

      const revealed = await this.revealApiKey(account.id);
      accounts.push({
        account: publicAccountRef(account),
        enabled: account.enabled,
        apiKey: revealed?.apiKey || null,
        status: revealed?.status || this.getApiKeyStatus(account.id),
      });
    }

    return {
      exportedAt,
      count: accounts.length,
      found: accounts.filter((item) => item.apiKey).length,
      accounts,
    };
  }

  buildSnapshot(account, data) {
    const existing = this.snapshots.get(account.id);
    return {
      id: account.id,
      name: account.name,
      workspaceId: account.workspaceId,
      enabled: account.enabled,
      ...this.getApiKeyStatus(account.id),
      status: data.status,
      checkedAt: data.checkedAt,
      lastSuccessAt: data.status === "ok" ? data.checkedAt : data.lastSuccessAt ?? existing?.lastSuccessAt ?? null,
      latencyMs: data.latencyMs,
      stale: data.stale,
      error: data.error,
      windows: data.windows,
    };
  }

  snapshotForAccount(account) {
    const snapshot = this.snapshots.get(account.id);
    if (!snapshot) {
      return {
        id: account.id,
        name: account.name,
        workspaceId: account.workspaceId,
        enabled: account.enabled,
        ...this.getApiKeyStatus(account.id),
        status: account.enabled ? "pending" : "disabled",
        checkedAt: null,
        lastSuccessAt: null,
        latencyMs: null,
        stale: false,
        error: null,
        windows: null,
      };
    }

    return {
      ...snapshot,
      name: account.name,
      workspaceId: account.workspaceId,
      enabled: account.enabled,
      ...this.getApiKeyStatus(account.id),
      stale: snapshot.stale || isSnapshotStale(snapshot, this.staleAfterMs),
    };
  }
}

export function toAvailability(snapshot, { staleAfterMs, minPercentRemaining }) {
  const stale = snapshot.stale || isSnapshotStale(snapshot, staleAfterMs);
  const lowestPercentRemaining = lowestRemaining(snapshot.windows);
  let available = true;
  let reason = "ok";
  let blockedUntil = null;

  if (!snapshot.enabled) {
    available = false;
    reason = "disabled";
  } else if (!snapshot.windows) {
    available = false;
    reason = snapshot.error ? "error" : "pending";
  } else if (stale) {
    available = false;
    reason = "stale";
  } else if (lowestPercentRemaining !== null && lowestPercentRemaining < minPercentRemaining) {
    available = false;
    reason = "quota_low";
    blockedUntil = resetAtForLowestWindow(snapshot.windows);
  }

  return {
    id: snapshot.id,
    name: snapshot.name,
    workspaceId: snapshot.workspaceId,
    available,
    reason,
    blockedUntil,
    lowestPercentRemaining,
    checkedAt: snapshot.checkedAt,
    lastSuccessAt: snapshot.lastSuccessAt,
    stale,
    windows: snapshot.windows,
    apiKeyFound: snapshot.apiKeyFound,
    apiKeyMasked: snapshot.apiKeyMasked,
    apiKeyCheckedAt: snapshot.apiKeyCheckedAt,
    apiKeyError: snapshot.apiKeyError,
  };
}

export function toPublicApiKeyStatus(status) {
  return {
    apiKeyFound: Boolean(status?.found),
    apiKeyMasked: status?.masked || "",
    apiKeyCheckedAt: status?.checkedAt || null,
    apiKeyError: status?.error || null,
  };
}

export function isSnapshotStale(snapshot, staleAfterMs) {
  if (!snapshot.checkedAt || staleAfterMs <= 0) {
    return false;
  }
  const age = Date.now() - Date.parse(snapshot.checkedAt);
  return Number.isFinite(age) && age > staleAfterMs;
}

function lowestRemaining(windows) {
  if (!windows) {
    return null;
  }
  const values = WINDOW_ORDER
    .map((window) => windows[window]?.percentRemaining)
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.min(...values) : null;
}

function resetAtForLowestWindow(windows) {
  if (!windows) {
    return null;
  }
  let selected = null;
  for (const window of WINDOW_ORDER) {
    const value = windows[window];
    if (!value || !Number.isFinite(value.percentRemaining)) {
      continue;
    }
    if (!selected || value.percentRemaining < selected.percentRemaining) {
      selected = value;
    }
  }
  return selected?.resetAt || null;
}

async function defaultScrapeAccount(account) {
  return queryOpenCodeGoQuota(account.workspaceId, account.authCookie, {
    requestTimeoutMs: Number(process.env.SCRAPE_TIMEOUT_MS) || 10_000,
  });
}

async function defaultScrapeApiKey(account) {
  return queryOpenCodeGoApiKey(account.workspaceId, account.authCookie, {
    requestTimeoutMs: Number(process.env.SCRAPE_TIMEOUT_MS) || 10_000,
  });
}

function publicAccountRef(account) {
  return {
    id: account.id,
    name: account.name,
    workspaceId: account.workspaceId,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
