import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { maskSecret } from "./format.js";

export function normalizeAccount(input, existing = {}) {
  const body = input && typeof input === "object" ? input : {};
  const id = normalizeAccountId(body.id ?? existing.id ?? body.name ?? existing.name);
  const name = String(body.name ?? existing.name ?? id).trim();
  const workspaceId = normalizeWorkspaceId(body.workspaceId ?? existing.workspaceId ?? "");
  const incomingCookie = typeof body.authCookie === "string" ? normalizeAuthCookie(body.authCookie) : undefined;
  const authCookie = incomingCookie !== undefined && incomingCookie !== "" ? incomingCookie : existing.authCookie || "";
  const enabled = body.enabled === undefined ? existing.enabled !== false : Boolean(body.enabled);
  const notes = String(body.notes ?? existing.notes ?? "").trim();

  if (!id) {
    throw new Error("Account id is required");
  }
  if (!name) {
    throw new Error("Account name is required");
  }
  if (!workspaceId) {
    throw new Error("workspaceId is required");
  }
  if (!authCookie) {
    throw new Error("authCookie is required");
  }

  return { id, name, workspaceId, authCookie, enabled, notes };
}

export function normalizeAccountId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function normalizeAuthCookie(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  for (const part of text.split(";")) {
    const trimmed = part.trim();
    if (trimmed.toLowerCase().startsWith("auth=")) {
      return trimmed.slice(5).trim();
    }
  }

  return text;
}

export function normalizeWorkspaceId(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:^|\/)(wrk_[A-Za-z0-9]+)(?:\/|$)/);
  return match ? match[1] : text;
}

export class AccountStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.accounts = [];
  }

  async load() {
    if (!existsSync(this.filePath)) {
      this.accounts = [];
      return this.list();
    }

    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
    const seen = new Set();
    this.accounts = items.map((account) => {
      const normalized = normalizeAccount(account);
      if (seen.has(normalized.id)) {
        throw new Error(`Duplicate account id: ${normalized.id}`);
      }
      seen.add(normalized.id);
      return normalized;
    });
    return this.list();
  }

  list() {
    return this.accounts.map((account) => ({ ...account }));
  }

  listPublic() {
    return this.accounts.map(toPublicAccount);
  }

  find(id) {
    return this.accounts.find((account) => account.id === id) || null;
  }

  async add(input) {
    const account = normalizeAccount(input);
    if (this.find(account.id)) {
      throw new Error(`Account ${account.id} already exists`);
    }
    this.accounts.push(account);
    await this.save();
    return { ...account };
  }

  async update(id, input) {
    const index = this.accounts.findIndex((account) => account.id === id);
    if (index === -1) {
      return null;
    }

    const updated = normalizeAccount(input, this.accounts[index]);
    if (updated.id !== id && this.find(updated.id)) {
      throw new Error(`Account ${updated.id} already exists`);
    }

    this.accounts[index] = updated;
    await this.save();
    return { ...updated };
  }

  async remove(id) {
    const before = this.accounts.length;
    this.accounts = this.accounts.filter((account) => account.id !== id);
    if (this.accounts.length === before) {
      return false;
    }
    await this.save();
    return true;
  }

  async save() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify({ accounts: this.accounts }, null, 2) + "\n";
    await writeFile(tmp, payload, { mode: 0o600 });
    try {
      await chmod(tmp, 0o600);
    } catch {
      // Best-effort permissions on platforms that support chmod.
    }
    await rename(tmp, this.filePath);
    try {
      await chmod(this.filePath, 0o600);
    } catch {
      // Best-effort permissions on platforms that support chmod.
    }
  }
}

export function toPublicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    workspaceId: account.workspaceId,
    authCookie: maskSecret(account.authCookie),
    enabled: account.enabled,
    notes: account.notes,
  };
}
