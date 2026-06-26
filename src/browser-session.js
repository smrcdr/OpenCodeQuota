import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { sanitizeMessage } from "./format.js";

const DEFAULT_CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

export class BrowserSessionManager {
  constructor({ profilesDir, chromePath = null, launcher = null } = {}) {
    this.profilesDir = profilesDir;
    this.chromePath = chromePath;
    this.launcher = launcher || defaultLaunchChrome;
    this.sessions = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }
    await mkdir(this.profilesDir, { recursive: true });
    await removeStaleProfiles(this.profilesDir);
    this.initialized = true;
  }

  listSessions() {
    this.dropExitedSessions();
    return [...this.sessions.values()].map(toPublicSession);
  }

  async openAccount(account) {
    if (!account?.authCookie) {
      throw new Error("Account authCookie is required");
    }
    if (!account?.workspaceId) {
      throw new Error("Account workspaceId is required");
    }

    await this.initialize();
    const chromePath = this.chromePath || findChromePath();
    if (!chromePath) {
      throw new Error("Google Chrome was not found on this machine");
    }

    const id = `br_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
    const debugPort = await getFreePort();
    const profileDir = path.join(this.profilesDir, id);
    const url = buildWorkspaceGoUrl(account.workspaceId);
    await mkdir(profileDir, { recursive: true });

    const child = this.launcher({ chromePath, debugPort, profileDir });
    const session = {
      id,
      accountId: account.id,
      accountName: account.name,
      workspaceId: account.workspaceId,
      url,
      startedAt: new Date().toISOString(),
      debugPort,
      profileDir,
      child,
    };

    try {
      await waitForChrome(debugPort, 8_000);
      await setAuthCookieAndNavigate({ debugPort, authCookie: account.authCookie, url });
      this.sessions.set(id, session);
      child.once?.("exit", () => {
        this.sessions.delete(id);
        void removeProfileDir(profileDir, { throwOnFailure: false });
      });
      return toPublicSession(session);
    } catch (error) {
      terminateChromeProcess(child);
      await waitForProcessExit(child, 2_000);
      await removeProfileDir(profileDir, { throwOnFailure: false });
      throw new Error(sanitizeBrowserError(error));
    }
  }

  async closeSession(id) {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }
    this.sessions.delete(id);
    terminateChromeProcess(session.child);
    await waitForProcessExit(session.child, 2_000);
    await removeProfileDir(session.profileDir, { throwOnFailure: false });
    return true;
  }

  dropExitedSessions() {
    for (const [id, session] of this.sessions.entries()) {
      if (session.child.exitCode !== null || session.child.killed) {
        this.sessions.delete(id);
      }
    }
  }
}

export function buildWorkspaceGoUrl(workspaceId) {
  return `https://opencode.ai/workspace/${encodeURIComponent(workspaceId)}/go`;
}

export function buildAuthCookiePayload(authCookie) {
  return {
    name: "auth",
    value: authCookie,
    domain: "opencode.ai",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  };
}

export function toPublicSession(session) {
  return {
    id: session.id,
    accountId: session.accountId,
    accountName: session.accountName,
    workspaceId: session.workspaceId,
    url: session.url,
    startedAt: session.startedAt,
  };
}

export function findChromePath(candidates = DEFAULT_CHROME_CANDIDATES) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

export function defaultLaunchChrome({ chromePath, debugPort, profileDir }) {
  const child = spawn(chromePath, [
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--new-window",
    "about:blank",
  ], {
    detached: true,
    stdio: "ignore",
  });
  child.__opencodeDetached = true;
  child.unref();
  return child;
}

export async function setAuthCookieAndNavigate({ debugPort, authCookie, url }) {
  const target = await getPageTarget(debugPort);
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.send("Network.enable");
    const cookieResult = await cdp.send("Network.setCookie", buildAuthCookiePayload(authCookie));
    if (cookieResult?.success === false) {
      throw new Error("Chrome rejected auth cookie");
    }
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url });
  } finally {
    cdp.close();
  }
}

async function getPageTarget(debugPort) {
  const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!page) {
    throw new Error("Chrome page target was not found");
  }
  return page;
}

async function waitForChrome(debugPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
      return;
    } catch (error) {
      lastError = error;
      await sleep(150);
    }
  }
  throw new Error(`Chrome did not open DevTools port in time: ${lastError?.message || "timeout"}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Chrome DevTools returned ${response.status}`);
  }
  return response.json();
}

async function connectCdp(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message || "Chrome DevTools error"));
      } else {
        resolve(message.result || {});
      }
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("Could not connect to Chrome DevTools")), { once: true });
  });

  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function sanitizeBrowserError(error) {
  return sanitizeMessage(error instanceof Error ? error.message : String(error));
}

async function removeStaleProfiles(profilesDir) {
  const entries = await readdir(profilesDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("br_"))
    .map((entry) => removeProfileDir(path.join(profilesDir, entry.name), { throwOnFailure: false })));
}

function terminateChromeProcess(child) {
  if (!child) {
    return;
  }
  if (child.__opencodeDetached && Number.isInteger(child.pid)) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Fall back to the child handle below. The process may already be gone.
    }
  }
  try {
    child.kill?.("SIGTERM");
  } catch {
    // Best-effort shutdown; cleanup is intentionally non-fatal.
  }
}

async function removeProfileDir(profileDir, { throwOnFailure = true } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await rm(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  if (throwOnFailure) {
    throw lastError;
  }
}

async function waitForProcessExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once?.("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
