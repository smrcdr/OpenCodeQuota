import http from "node:http";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccountStore, toPublicAccount, normalizeAccountId } from "./accounts.js";
import { BrowserSessionManager } from "./browser-session.js";
import { loadDotEnv, readIntegerEnv } from "./env.js";
import { buildCookie, parseCookies, readJsonRequest, sendJson, sendNoContent, serveStaticFile } from "./http-utils.js";
import { loginWithGoogle, loginAllGoogle, GoogleLoginError } from "./google-login.js";
import { QuotaScheduler } from "./scheduler.js";
import { QuotaState } from "./quota-state.js";
import { ProxyStore, ProxyStoreError, toPublicProxy } from "./proxies.js";
import { queryOpenCodeGoApiKey, queryOpenCodeGoQuota } from "./scraper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(rootDir, "data");
const browserProfilesDir = path.join(dataDir, "browser-profiles");

loadDotEnv(path.join(rootDir, ".env"));
mkdirSync(dataDir, { recursive: true });

const DEFAULT_OPTIONS = {
  host: process.env.HOST || "127.0.0.1",
  port: readIntegerEnv("PORT", 40129, { min: 1 }),
  adminToken: process.env.ADMIN_TOKEN || "",
  accountsPath: process.env.ACCOUNTS_PATH
    ? path.resolve(rootDir, process.env.ACCOUNTS_PATH)
    : path.join(rootDir, "config", "accounts.json"),
  proxiesPath: process.env.PROXIES_PATH
    ? path.resolve(rootDir, process.env.PROXIES_PATH)
    : path.join(rootDir, "config", "proxies.json"),
  scrapeIntervalMs: readIntegerEnv("SCRAPE_INTERVAL_SECONDS", 60, { min: 5 }) * 1000,
  scrapeTimeoutMs: readIntegerEnv("SCRAPE_TIMEOUT_MS", 10_000, { min: 1000 }),
  staleAfterMs: readIntegerEnv("STALE_AFTER_SECONDS", 180, { min: 1 }) * 1000,
  minPercentRemaining: Number(process.env.AVAILABILITY_MIN_PERCENT_REMAINING ?? 1),
};

export async function createQuotaApp(options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const accounts = options.accounts || new AccountStore(settings.accountsPath);
  await accounts.load();
  const proxies = options.proxies || new ProxyStore(settings.proxiesPath, {
    testConnection: options.testProxyConnection,
  });
  await proxies.load();

  const quotaState = options.quotaState || new QuotaState({
    accounts,
    scrapeAccount: options.scrapeAccount || ((account) => queryOpenCodeGoQuota(
      account.workspaceId,
      account.authCookie,
      {
        requestTimeoutMs: settings.scrapeTimeoutMs,
        proxyURL: proxies.urlFor(account.proxyId),
      },
    )),
    scrapeApiKey: options.scrapeApiKey || ((account) => queryOpenCodeGoApiKey(
      account.workspaceId,
      account.authCookie,
      {
        requestTimeoutMs: settings.scrapeTimeoutMs,
        proxyURL: proxies.urlFor(account.proxyId),
      },
    )),
    staleAfterMs: settings.staleAfterMs,
    minPercentRemaining: settings.minPercentRemaining,
  });
  const scheduler = options.scheduler || new QuotaScheduler({
    quotaState,
    intervalMs: settings.scrapeIntervalMs,
    jitterMs: options.jitterMs ?? 1500,
  });
  const browserSessions = options.browserSessions || new BrowserSessionManager({
    profilesDir: options.browserProfilesDir || browserProfilesDir,
  });
  await browserSessions.initialize();

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, { settings, accounts, proxies, quotaState, scheduler, browserSessions });
    } catch (error) {
      console.error(error);
      sendJson(res, 500, {
        error: {
          message: error instanceof Error ? error.message : "Internal quota tracker error",
          type: "server_error",
        },
      });
    }
  });

  return { server, accounts, proxies, quotaState, scheduler, browserSessions, settings };
}

async function handleRequest(req, res, ctx) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, buildHealth(ctx));
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/admin")) {
    return serveStaticFile(res, publicDir, "admin.html");
  }

  if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
    return serveStaticFile(res, publicDir, url.pathname.replace(/^\/assets\//, ""));
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url, ctx);
  }

  return sendJson(res, 404, { error: { message: "Not found", type: "not_found" } });
}

async function handleApi(req, res, url, ctx) {
  if (req.method === "POST" && url.pathname === "/api/auth") {
    const body = await readJsonRequest(req);
    const token = String(body?.token || "").trim();
    if (!isValidAdminToken(token, ctx.settings.adminToken)) {
      return sendJson(res, 401, { error: { message: "Неверный секретный ключ", type: "unauthorized" } });
    }
    res.setHeader("Set-Cookie", buildCookie("quota_admin_token", token, req, 60 * 60 * 24 * 30));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    res.setHeader("Set-Cookie", buildCookie("quota_admin_token", "", req, 0));
    return sendJson(res, 200, { ok: true });
  }

  if (!isAdminAuthorized(req, ctx.settings.adminToken)) {
    return sendJson(res, 401, { error: { message: "Admin token required", type: "unauthorized" } });
  }

  if (req.method === "GET" && url.pathname === "/api/availability") {
    return sendJson(res, 200, { accounts: ctx.quotaState.listAvailability() });
  }

  if (req.method === "GET" && url.pathname === "/api/accounts") {
    return sendJson(res, 200, { accounts: listPublicAccounts(ctx) });
  }

  if (req.method === "GET" && url.pathname === "/api/proxies") {
    return sendJson(res, 200, { proxies: ctx.proxies.listPublic(ctx.accounts.list()) });
  }

  if (req.method === "POST" && url.pathname === "/api/proxies") {
    try {
      const proxy = await ctx.proxies.add(await readJsonRequest(req));
      return sendJson(res, 201, { proxy: toPublicProxy(proxy, ctx.accounts.list()) });
    } catch (error) {
      return sendProxyError(res, error);
    }
  }

  const proxyMatch = url.pathname.match(/^\/api\/proxies\/([^/]+)$/);
  if (proxyMatch && req.method === "PUT") {
    try {
      const proxy = await ctx.proxies.update(
        decodeURIComponent(proxyMatch[1]),
        await readJsonRequest(req),
      );
      return proxy
        ? sendJson(res, 200, { proxy: toPublicProxy(proxy, ctx.accounts.list()) })
        : sendJson(res, 404, { error: { message: "Proxy not found", type: "not_found" } });
    } catch (error) {
      return sendProxyError(res, error);
    }
  }

  if (proxyMatch && req.method === "DELETE") {
    try {
      const removed = await ctx.proxies.remove(
        decodeURIComponent(proxyMatch[1]),
        ctx.accounts.list(),
      );
      return removed
        ? sendNoContent(res)
        : sendJson(res, 404, { error: { message: "Proxy not found", type: "not_found" } });
    } catch (error) {
      return sendProxyError(res, error);
    }
  }

  const proxyTestMatch = url.pathname.match(/^\/api\/proxies\/([^/]+)\/test$/);
  if (proxyTestMatch && req.method === "POST") {
    const result = await ctx.proxies.test(decodeURIComponent(proxyTestMatch[1]));
    return result
      ? sendJson(res, result.ok ? 200 : 502, result)
      : sendJson(res, 404, { error: { message: "Proxy not found", type: "not_found" } });
  }

  if (req.method === "POST" && url.pathname === "/api/accounts") {
    const body = await readJsonRequest(req);
    const account = await ctx.accounts.add(body);
    ctx.quotaState.syncAccounts();
    return sendJson(res, 201, { account: toPublicAccount(account) });
  }

  const accountMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (accountMatch && req.method === "PUT") {
    const id = decodeURIComponent(accountMatch[1]);
    const body = await readJsonRequest(req);
    const account = await ctx.accounts.update(id, body);
    if (!account) {
      return sendJson(res, 404, { error: { message: "Account not found", type: "not_found" } });
    }
    ctx.quotaState.syncAccounts();
    return sendJson(res, 200, { account: toPublicAccount(account) });
  }

  if (accountMatch && req.method === "DELETE") {
    const removed = await ctx.accounts.remove(decodeURIComponent(accountMatch[1]));
    ctx.quotaState.syncAccounts();
    return removed
      ? sendNoContent(res)
      : sendJson(res, 404, { error: { message: "Account not found", type: "not_found" } });
  }

  const accountProxyMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/proxy$/);
  if (accountProxyMatch && req.method === "PUT") {
    const id = decodeURIComponent(accountProxyMatch[1]);
    const body = await readJsonRequest(req);
    const proxyId = String(body?.proxyId || "").trim();
    if (proxyId && !ctx.proxies.find(proxyId)) {
      return sendJson(res, 400, { error: { message: "Proxy not found", type: "invalid_request" } });
    }
    const account = await ctx.accounts.update(id, { proxyId });
    if (!account) {
      return sendJson(res, 404, { error: { message: "Account not found", type: "not_found" } });
    }
    ctx.quotaState.syncAccounts();
    return sendJson(res, 200, { account: toPublicAccount(account) });
  }

  if (req.method === "POST" && url.pathname === "/api/google-login") {
    if (!isRevealAuthorized(req, ctx.settings.adminToken)) {
      return sendJson(res, 401, {
        error: { message: "ADMIN_TOKEN is required for Google login", type: "unauthorized" },
      });
    }
    const body = await readJsonRequest(req);
    const email = String(body?.email || "").trim();
    const password = String(body?.password || "");
    if (!email || !password) {
      return sendJson(res, 400, { error: { message: "email и пароль обязательны", type: "invalid_request" } });
    }
    let result;
    try {
      result = await loginWithGoogle({ email, password });
    } catch (error) {
      return sendJson(res, 502, {
        error: {
          message: error instanceof GoogleLoginError ? error.message : "Ошибка входа",
          type: "google_login_error",
          code: error instanceof GoogleLoginError ? error.code : "unknown",
        },
      });
    }
    try {
      const newId = normalizeAccountId(email);
      const existing = ctx.accounts
        .list()
        .find((account) => account.workspaceId === result.workspaceId || account.id === newId);
      let account;
      if (existing) {
        account = await ctx.accounts.update(existing.id, {
          name: email,
          workspaceId: result.workspaceId,
          authCookie: result.authCookie,
        });
      }
      if (!account) {
        account = await ctx.accounts.add({
          name: email,
          workspaceId: result.workspaceId,
          authCookie: result.authCookie,
          enabled: true,
          notes: "Google login",
        });
      }
      ctx.quotaState.syncAccounts();
      return sendJson(res, existing ? 200 : 201, { account: toPublicAccount(account) });
    } catch (error) {
      return sendJson(res, 409, {
        error: {
          message: `Вход выполнен, но аккаунт не сохранён: ${error.message}`,
          type: "account_error",
        },
        workspaceId: result.workspaceId,
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/google-login-all") {
    if (!isRevealAuthorized(req, ctx.settings.adminToken)) {
      return sendJson(res, 401, {
        error: { message: "ADMIN_TOKEN is required for Google login", type: "unauthorized" },
      });
    }
    const body = await readJsonRequest(req);
    const input = Array.isArray(body?.accounts) ? body.accounts : [];
    const accounts = input
      .map((item) => ({ email: String(item?.email || "").trim(), password: String(item?.password || "") }))
      .filter((item) => item.email && item.password);
    if (accounts.length === 0) {
      return sendJson(res, 400, { error: { message: "Нет аккаунтов для входа", type: "invalid_request" } });
    }
    const results = await loginAllGoogle(accounts);
    for (const r of results) {
      if (!r.ok) {
        continue;
      }
      try {
        const newId = normalizeAccountId(r.email);
        const existing = ctx.accounts
          .list()
          .find((account) => account.workspaceId === r.workspaceId || account.id === newId);
        if (existing) {
          await ctx.accounts.update(existing.id, {
            name: r.email,
            workspaceId: r.workspaceId,
            authCookie: r.authCookie,
          });
        } else {
          await ctx.accounts.add({
            name: r.email,
            workspaceId: r.workspaceId,
            authCookie: r.authCookie,
            enabled: true,
            notes: "Google login",
          });
        }
      } catch (error) {
        r.ok = false;
        r.code = "account_error";
        r.message = `Вход выполнен, но аккаунт не сохранён: ${error.message}`;
      }
    }
    ctx.quotaState.syncAccounts();
    return sendJson(res, 200, { results });
  }

  const checkMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/check$/);
  if (checkMatch && req.method === "POST") {
    const snapshot = await ctx.quotaState.checkAccount(decodeURIComponent(checkMatch[1]));
    return snapshot
      ? sendJson(res, 200, { account: snapshot })
      : sendJson(res, 404, { error: { message: "Account not found", type: "not_found" } });
  }

  const apiKeyCheckMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/api-key\/check$/);
  if (apiKeyCheckMatch && req.method === "POST") {
    const id = decodeURIComponent(apiKeyCheckMatch[1]);
    const status = await ctx.quotaState.checkApiKey(id);
    return status
      ? sendJson(res, 200, { account: { id, ...status } })
      : sendJson(res, 404, { error: { message: "Account not found", type: "not_found" } });
  }

  const apiKeyRevealMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/api-key\/reveal$/);
  if (apiKeyRevealMatch && req.method === "POST") {
    if (!isRevealAuthorized(req, ctx.settings.adminToken)) {
      return sendJson(res, 401, {
        error: {
          message: "ADMIN_TOKEN is required to reveal API keys",
          type: "unauthorized",
        },
      });
    }
    const revealed = await ctx.quotaState.revealApiKey(decodeURIComponent(apiKeyRevealMatch[1]));
    if (!revealed) {
      return sendJson(res, 404, { error: { message: "Account not found", type: "not_found" } });
    }
    if (!revealed.apiKey) {
      return sendJson(res, 404, {
        error: {
          message: revealed.status?.apiKeyError || "api_key_not_found",
          type: "api_key_not_found",
        },
        account: revealed.account,
        status: revealed.status,
      });
    }
    return sendJson(res, 200, revealed);
  }

  if (req.method === "POST" && url.pathname === "/api/api-key/best/reveal") {
    if (!isRevealAuthorized(req, ctx.settings.adminToken)) {
      return sendJson(res, 401, {
        error: {
          message: "ADMIN_TOKEN is required to reveal API keys",
          type: "unauthorized",
        },
      });
    }
    const revealed = await ctx.quotaState.revealBestApiKey();
    if (!revealed) {
      return sendJson(res, 404, {
        error: {
          message: "No available account with a discovered API key",
          type: "api_key_not_found",
        },
      });
    }
    return sendJson(res, 200, revealed);
  }

  if (req.method === "POST" && url.pathname === "/api/api-key/export") {
    if (!isRevealAuthorized(req, ctx.settings.adminToken)) {
      return sendJson(res, 401, {
        error: {
          message: "ADMIN_TOKEN is required to export API keys",
          type: "unauthorized",
        },
      });
    }
    const includeDisabled = url.searchParams.get("includeDisabled") === "true";
    return sendJson(res, 200, await ctx.quotaState.exportApiKeys({ includeDisabled }));
  }

  const browserOpenMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/browser\/open$/);
  if (browserOpenMatch && req.method === "POST") {
    if (!isRevealAuthorized(req, ctx.settings.adminToken)) {
      return sendJson(res, 401, {
        error: {
          message: "ADMIN_TOKEN is required to open browser sessions",
          type: "unauthorized",
        },
      });
    }
    const account = ctx.accounts.find(decodeURIComponent(browserOpenMatch[1]));
    if (!account) {
      return sendJson(res, 404, { error: { message: "Account not found", type: "not_found" } });
    }
    const session = await ctx.browserSessions.openAccount(account);
    return sendJson(res, 200, { session });
  }

  if (req.method === "GET" && url.pathname === "/api/browser/sessions") {
    if (!isRevealAuthorized(req, ctx.settings.adminToken)) {
      return sendJson(res, 401, {
        error: {
          message: "ADMIN_TOKEN is required to list browser sessions",
          type: "unauthorized",
        },
      });
    }
    return sendJson(res, 200, { sessions: ctx.browserSessions.listSessions() });
  }

  const browserCloseMatch = url.pathname.match(/^\/api\/browser\/([^/]+)\/close$/);
  if (browserCloseMatch && req.method === "POST") {
    if (!isRevealAuthorized(req, ctx.settings.adminToken)) {
      return sendJson(res, 401, {
        error: {
          message: "ADMIN_TOKEN is required to close browser sessions",
          type: "unauthorized",
        },
      });
    }
    const closed = await ctx.browserSessions.closeSession(decodeURIComponent(browserCloseMatch[1]));
    return closed
      ? sendJson(res, 200, { ok: true })
      : sendJson(res, 404, { error: { message: "Browser session not found", type: "not_found" } });
  }

  if (req.method === "POST" && url.pathname === "/api/quota/check-all") {
    const accounts = await ctx.quotaState.checkAll({ jitterMs: 250 });
    ctx.scheduler.lastPollAt = new Date().toISOString();
    return sendJson(res, 200, { accounts });
  }

  if (req.method === "GET" && url.pathname === "/api/quota") {
    return sendJson(res, 200, { accounts: ctx.quotaState.listQuota() });
  }

  const quotaMatch = url.pathname.match(/^\/api\/quota\/([^/]+)$/);
  if (quotaMatch && req.method === "GET") {
    const account = ctx.quotaState.getQuota(decodeURIComponent(quotaMatch[1]));
    return account
      ? sendJson(res, 200, { account })
      : sendJson(res, 404, { error: { message: "Account not found", type: "not_found" } });
  }

  return sendJson(res, 404, { error: { message: "Admin API route not found", type: "not_found" } });
}

function listPublicAccounts({ accounts, quotaState }) {
  return accounts.listPublic().map((account) => ({
    ...account,
    ...quotaState.getApiKeyStatus(account.id),
  }));
}

function buildHealth({ accounts, scheduler, quotaState }) {
  const quota = quotaState.listQuota();
  const checkedAtValues = quota.map((item) => item.checkedAt).filter(Boolean).map((date) => Date.parse(date));
  const newestCheck = checkedAtValues.length ? Math.max(...checkedAtValues) : null;
  return {
    status: "ok",
    accounts: accounts.list().length,
    enabledAccounts: accounts.list().filter((account) => account.enabled).length,
    lastPollAt: scheduler.lastPollAt,
    lastPollAgeSeconds: scheduler.lastPollAt ? Math.round((Date.now() - Date.parse(scheduler.lastPollAt)) / 1000) : null,
    newestCheckAt: newestCheck ? new Date(newestCheck).toISOString() : null,
    newestCheckAgeSeconds: newestCheck ? Math.round((Date.now() - newestCheck) / 1000) : null,
    polling: scheduler.running,
    lastPollError: scheduler.lastPollError,
  };
}

function isAdminAuthorized(req, adminToken) {
  if (!adminToken) {
    return false;
  }

  const authorization = String(req.headers.authorization || "");
  if (authorization === `Bearer ${adminToken}`) {
    return true;
  }

  return parseCookies(req.headers.cookie).get("quota_admin_token") === adminToken;
}

function isValidAdminToken(token, adminToken) {
  return Boolean(adminToken) && token === adminToken;
}

function isRevealAuthorized(req, adminToken) {
  return Boolean(adminToken) && isAdminAuthorized(req, adminToken);
}

function sendProxyError(res, error) {
  if (error instanceof ProxyStoreError) {
    return sendJson(res, error.code === "proxy_assigned" || error.code === "proxy_exists" ? 409 : 400, {
      error: { message: error.message, type: error.code },
    });
  }
  throw error;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await createQuotaApp();
  app.scheduler.start({ runImmediately: true });
  app.server.listen(app.settings.port, app.settings.host, () => {
    console.log(`OpenCode Go Quota Tracker listening on http://${app.settings.host}:${app.settings.port}/admin`);
    console.log(`Availability endpoint: http://${app.settings.host}:${app.settings.port}/api/availability`);
  });
}
