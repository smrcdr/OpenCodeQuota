import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const PROXY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class ProxyStore {
  constructor(filePath, { testConnection = defaultTestConnection } = {}) {
    this.filePath = filePath;
    this.testConnection = testConnection;
    this.proxies = [];
  }

  async load() {
    if (!existsSync(this.filePath)) {
      this.proxies = [];
      return this.listPublic();
    }
    const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
    this.proxies = (Array.isArray(parsed?.proxies) ? parsed.proxies : [])
      .map((proxy) => normalizeProxy(proxy));
    return this.listPublic();
  }

  find(id) {
    return this.proxies.find((proxy) => proxy.id === String(id || "").trim()) || null;
  }

  listPublic(accounts = []) {
    return this.proxies.map((proxy) => toPublicProxy(proxy, accounts));
  }

  urlFor(id) {
    const proxy = this.find(id);
    return proxy ? buildProxyURL(proxy) : "";
  }

  async add(input) {
    const proxy = normalizeProxy({
      ...input,
      id: input?.id || `px_${crypto.randomBytes(8).toString("hex")}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (this.find(proxy.id)) {
      throw new ProxyStoreError("proxy_exists", `Proxy ${proxy.id} already exists`);
    }
    this.proxies.push(proxy);
    await this.save();
    return proxy;
  }

  async update(id, input) {
    const index = this.proxies.findIndex((proxy) => proxy.id === id);
    if (index === -1) {
      return null;
    }
    const proxy = normalizeProxy({
      ...this.proxies[index],
      ...input,
      id,
      username: input?.username === undefined ? this.proxies[index].username : input.username,
      password: input?.password === undefined ? this.proxies[index].password : input.password,
      updatedAt: new Date().toISOString(),
    });
    this.proxies[index] = proxy;
    await this.save();
    return proxy;
  }

  async remove(id, accounts = []) {
    if (accounts.some((account) => account.proxyId === id)) {
      throw new ProxyStoreError("proxy_assigned", "Proxy is assigned to OpenCode accounts");
    }
    const before = this.proxies.length;
    this.proxies = this.proxies.filter((proxy) => proxy.id !== id);
    if (this.proxies.length === before) {
      return false;
    }
    await this.save();
    return true;
  }

  async test(id) {
    const proxy = this.find(id);
    if (!proxy) {
      return null;
    }
    return this.testConnection(buildProxyURL(proxy), proxy.id);
  }

  async save() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, proxies: this.proxies }, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(temporary, 0o600).catch(() => {});
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
  }
}

export class ProxyStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function toPublicProxy(proxy, accounts = []) {
  return {
    id: proxy.id,
    name: proxy.name,
    type: "https",
    transport: "http-connect",
    endpoint: `${proxy.host}:${proxy.port}`,
    authConfigured: Boolean(proxy.username),
    assignedOpenCodeAccounts: accounts.filter((account) => account.proxyId === proxy.id).length,
    createdAt: proxy.createdAt,
    updatedAt: proxy.updatedAt,
  };
}

function normalizeProxy(input) {
  const value = input && typeof input === "object" ? input : {};
  const id = String(value.id || "").trim().toLowerCase();
  const name = String(value.name || "").trim();
  const type = String(value.type || "https").trim().toLowerCase();
  const host = String(value.host || "").trim();
  const port = Number(value.port);
  const username = String(value.username || "").trim();
  const password = String(value.password || "");
  if (!PROXY_ID_PATTERN.test(id)) {
    throw new ProxyStoreError("invalid_proxy", "Invalid proxy id");
  }
  if (!name || name.length > 100) {
    throw new ProxyStoreError("invalid_proxy", "Proxy name must contain 1 to 100 characters");
  }
  if (!["https", "https-connect", "http-connect"].includes(type)) {
    throw new ProxyStoreError("invalid_proxy", "Only HTTPS CONNECT proxies are supported");
  }
  if (!host || host.length > 253 || /[/@\s]/.test(host)) {
    throw new ProxyStoreError("invalid_proxy", "Invalid proxy host");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ProxyStoreError("invalid_proxy", "Proxy port must be between 1 and 65535");
  }
  if ((username === "") !== (password === "")) {
    throw new ProxyStoreError("invalid_proxy", "Proxy username and password must be provided together");
  }
  if (username.length > 500 || password.length > 500) {
    throw new ProxyStoreError("invalid_proxy", "Proxy credentials are too long");
  }
  return {
    id,
    name,
    type: "https",
    host,
    port,
    username,
    password,
    createdAt: value.createdAt || new Date().toISOString(),
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
}

function buildProxyURL(proxy) {
  const value = new URL(`http://${proxy.host}:${proxy.port}`);
  if (proxy.username) {
    value.username = proxy.username;
    value.password = proxy.password;
  }
  return value.toString();
}

async function defaultTestConnection(proxyURL, id) {
  const startedAt = Date.now();
  try {
    const response = await fetch("https://opencode.ai/", {
      method: "HEAD",
      proxy: proxyURL,
      signal: AbortSignal.timeout(20_000),
    });
    return {
      id,
      ok: response.status !== 407 && response.status < 500,
      statusCode: response.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    return { id, ok: false, latencyMs: Date.now() - startedAt, error: "proxy_connection_failed" };
  }
}
