const state = {
  accounts: [],
  quota: [],
  availability: [],
  health: null,
  loading: false,
};

const els = {
  loginPanel: document.querySelector("#loginPanel"),
  appPanel: document.querySelector("#appPanel"),
  loginForm: document.querySelector("#loginForm"),
  adminToken: document.querySelector("#adminToken"),
  loginError: document.querySelector("#loginError"),
  statusText: document.querySelector("#statusText"),
  refreshAllButton: document.querySelector("#refreshAllButton"),
  copyBestKeyButton: document.querySelector("#copyBestKeyButton"),
  exportKeysButton: document.querySelector("#exportKeysButton"),
  reloadButton: document.querySelector("#reloadButton"),
  addButton: document.querySelector("#addButton"),
  logoutButton: document.querySelector("#logoutButton"),
  summaryGrid: document.querySelector("#summaryGrid"),
  accountCount: document.querySelector("#accountCount"),
  healthText: document.querySelector("#healthText"),
  quotaRows: document.querySelector("#quotaRows"),
  emptyState: document.querySelector("#emptyState"),
  dialog: document.querySelector("#accountDialog"),
  form: document.querySelector("#accountForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  editingId: document.querySelector("#editingId"),
  accountId: document.querySelector("#accountId"),
  accountName: document.querySelector("#accountName"),
  workspaceId: document.querySelector("#workspaceId"),
  authCookie: document.querySelector("#authCookie"),
  notes: document.querySelector("#notes"),
  enabled: document.querySelector("#enabled"),
  formError: document.querySelector("#formError"),
  saveAccountButton: document.querySelector("#saveAccountButton"),
  exportDialog: document.querySelector("#exportDialog"),
  closeExportButton: document.querySelector("#closeExportButton"),
  refreshExportButton: document.querySelector("#refreshExportButton"),
  copyExportButton: document.querySelector("#copyExportButton"),
  downloadExportButton: document.querySelector("#downloadExportButton"),
  exportJsonTab: document.querySelector("#exportJsonTab"),
  exportKeysTab: document.querySelector("#exportKeysTab"),
  exportText: document.querySelector("#exportText"),
  exportMeta: document.querySelector("#exportMeta"),
};

const exportState = {
  format: "json",
  data: null,
};

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginError.textContent = "";
  try {
    await api("/api/auth", {
      method: "POST",
      body: JSON.stringify({ token: els.adminToken.value.trim() }),
      skipAuthRedirect: true,
    });
    await loadAll();
    showApp();
  } catch (error) {
    els.loginError.textContent = error.message;
  }
});

els.refreshAllButton.addEventListener("click", async () => {
  await withStatus("Проверяю", async () => {
    await api("/api/quota/check-all", { method: "POST" });
    await loadAll();
  });
});

els.reloadButton.addEventListener("click", () => withStatus("Обновляю", loadAll));
els.addButton.addEventListener("click", () => openAccountDialog());
els.copyBestKeyButton.addEventListener("click", () => copyBestApiKey());
els.exportKeysButton.addEventListener("click", () => exportApiKeys());
els.closeExportButton.addEventListener("click", () => els.exportDialog.close());
els.refreshExportButton.addEventListener("click", () => loadExportData());
els.copyExportButton.addEventListener("click", () => copyCurrentExport());
els.downloadExportButton.addEventListener("click", () => downloadCurrentExport());
els.exportJsonTab.addEventListener("click", () => setExportFormat("json"));
els.exportKeysTab.addEventListener("click", () => setExportFormat("keys"));
els.logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", skipAuthRedirect: true }).catch(() => null);
  showLogin();
});
els.saveAccountButton.addEventListener("click", saveAccount);

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  const { action, id } = button.dataset;
  if (action === "edit") {
    openAccountDialog(state.accounts.find((account) => account.id === id));
  }
  if (action === "check") {
    await withStatus("Проверяю", async () => {
      await api(`/api/accounts/${encodeURIComponent(id)}/check`, { method: "POST" });
      await loadAll();
    });
  }
  if (action === "key-check") {
    await withStatus("Ищу ключ", async () => {
      await api(`/api/accounts/${encodeURIComponent(id)}/api-key/check`, { method: "POST" });
      await loadAll();
    });
  }
  if (action === "key-copy") {
    await copyAccountApiKey(id);
  }
  if (action === "browser-open") {
    await openAccountBrowser(id);
  }
  if (action === "delete") {
    const account = state.accounts.find((item) => item.id === id);
    if (!confirm(`Delete ${account?.name || id}?`)) {
      return;
    }
    await withStatus("Удаляю", async () => {
      await api(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadAll();
    });
  }
});

init();

async function init() {
  try {
    await loadAll();
    showApp();
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      return;
    }
    showApp();
    setStatus(error.message, "error");
  }
}

async function loadAll() {
  const [accounts, quota, availability, health] = await Promise.all([
    api("/api/accounts"),
    api("/api/quota"),
    api("/api/availability", { skipAuthRedirect: true }),
    api("/health", { skipAuthRedirect: true }),
  ]);
  state.accounts = accounts.accounts || [];
  state.quota = quota.accounts || [];
  state.availability = availability.accounts || [];
  state.health = health;
  render();
  setStatus("Готово", "saved");
}

function render() {
  renderSummary();
  renderTable();
  els.accountCount.textContent = plural(state.accounts.length, "account", "accounts");
  els.healthText.textContent = state.health?.newestCheckAgeSeconds === null
    ? "No checks yet"
    : `Last check ${formatAge(state.health.newestCheckAgeSeconds)} ago`;
}

function renderSummary() {
  const available = state.availability.filter((item) => item.available).length;
  const low = state.availability.filter((item) => item.reason === "quota_low").length;
  const errors = state.availability.filter((item) => ["error", "stale", "pending"].includes(item.reason)).length;
  const cards = [
    ["Available", available],
    ["Quota low", low],
    ["Needs attention", errors],
  ];
  els.summaryGrid.replaceChildren(...cards.map(([label, value]) => {
    const item = document.createElement("article");
    item.className = "summary-item";
    item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    return item;
  }));
}

function renderTable() {
  els.quotaRows.replaceChildren();
  els.emptyState.hidden = state.accounts.length > 0;
  for (const quota of state.quota) {
    const availability = state.availability.find((item) => item.id === quota.id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(quota.name)}</strong>
        <span>${escapeHtml(quota.id)}</span>
      </td>
      <td><code class="workspace-code">${escapeHtml(quota.workspaceId)}</code></td>
      ${windowCell(quota.windows?.rolling)}
      ${windowCell(quota.windows?.weekly)}
      ${windowCell(quota.windows?.monthly)}
      <td>${apiKeyCell(quota)}</td>
      <td>${statusPill(quota, availability)}</td>
      <td class="actions-cell">
        <button class="icon-button" data-action="check" data-id="${escapeAttr(quota.id)}" title="Refresh">R</button>
        <button class="icon-button" data-action="key-check" data-id="${escapeAttr(quota.id)}" title="Check API key">K</button>
        <button class="icon-button" data-action="key-copy" data-id="${escapeAttr(quota.id)}" title="Copy API key">C</button>
        <button class="icon-button wide" data-action="browser-open" data-id="${escapeAttr(quota.id)}" title="Open dashboard">Open</button>
        <button class="icon-button" data-action="edit" data-id="${escapeAttr(quota.id)}" title="Edit">E</button>
        <button class="icon-button danger" data-action="delete" data-id="${escapeAttr(quota.id)}" title="Delete">×</button>
      </td>
    `;
    els.quotaRows.append(tr);
  }
}

function apiKeyCell(account) {
  if (account.apiKeyFound) {
    return `<span class="pill ok">found</span><small class="mono">${escapeHtml(account.apiKeyMasked)}</small>`;
  }
  if (account.apiKeyError) {
    return `<span class="pill critical">missing</span><small>${escapeHtml(account.apiKeyError)}</small>`;
  }
  return `<span class="pill">not checked</span><small>Use check key</small>`;
}

function windowCell(window) {
  if (!window) {
    return `<td><span class="muted">Waiting</span></td>`;
  }
  const level = window.percentRemaining < 10 ? "critical" : window.percentRemaining < 25 ? "warning" : "ok";
  return `
    <td class="quota-cell">
      <div class="meter ${level}">
        <span style="width:${window.percentRemaining}%"></span>
      </div>
      <div class="quota-line">
        <strong>${formatPercent(window.percentRemaining)}</strong>
        <small>${formatReset(window.resetAt)}</small>
      </div>
      <small>${formatMoney(window.remainingUsd)} / ${formatMoney(window.limitUsd)}</small>
    </td>
  `;
}

function statusPill(quota, availability) {
  const reason = availability?.reason || quota.status;
  const label = quota.stale ? "stale" : reason;
  const level = availability?.available ? "ok" : reason === "quota_low" ? "warning" : "critical";
  const detail = quota.error ? `<small>${escapeHtml(quota.error)}</small>` : `<small>${quota.checkedAt ? formatDate(quota.checkedAt) : "Not checked"}</small>`;
  return `<span class="pill ${level}">${escapeHtml(label)}</span>${detail}`;
}

function openAccountDialog(account = null) {
  els.formError.textContent = "";
  els.dialogTitle.textContent = account ? "Edit account" : "Add account";
  els.editingId.value = account?.id || "";
  els.accountId.value = account?.id || "";
  els.accountId.disabled = Boolean(account);
  els.accountName.value = account?.name || "";
  els.workspaceId.value = account?.workspaceId || "";
  els.authCookie.value = "";
  els.authCookie.required = !account;
  els.authCookie.placeholder = account ? "Leave empty to keep current cookie" : "auth cookie";
  els.notes.value = account?.notes || "";
  els.enabled.checked = account?.enabled ?? true;
  els.dialog.showModal();
}

async function saveAccount() {
  if (!els.form.reportValidity()) {
    return;
  }
  els.formError.textContent = "";
  const editingId = els.editingId.value;
  const body = {
    id: els.accountId.value.trim(),
    name: els.accountName.value.trim(),
    workspaceId: els.workspaceId.value.trim(),
    enabled: els.enabled.checked,
    notes: els.notes.value.trim(),
  };
  if (els.authCookie.value.trim()) {
    body.authCookie = els.authCookie.value.trim();
  }

  try {
    await api(editingId ? `/api/accounts/${encodeURIComponent(editingId)}` : "/api/accounts", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    els.dialog.close();
    await loadAll();
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

async function copyAccountApiKey(id) {
  await withStatus("Копирую ключ", async () => {
    const result = await api(`/api/accounts/${encodeURIComponent(id)}/api-key/reveal`, { method: "POST" });
    await copyToClipboard(result.apiKey);
    await loadAll();
    setStatus("Ключ скопирован", "saved");
  });
}

async function copyBestApiKey() {
  await withStatus("Копирую лучший ключ", async () => {
    const result = await api("/api/api-key/best/reveal", { method: "POST" });
    await copyToClipboard(result.apiKey);
    await loadAll();
    setStatus(`Ключ ${result.account.name} скопирован`, "saved");
  });
}

async function openAccountBrowser(id) {
  await withStatus("Открываю Chrome", async () => {
    const result = await api(`/api/accounts/${encodeURIComponent(id)}/browser/open`, { method: "POST" });
    setStatus(`Chrome opened: ${result.session.accountName || result.session.accountId}`, "saved");
  });
}

async function exportApiKeys() {
  els.exportDialog.showModal();
  await loadExportData();
}

async function loadExportData() {
  await withStatus("Экспортирую ключи", async () => {
    exportState.data = await api("/api/api-key/export", { method: "POST" });
    renderExportDialog();
    await loadAll();
    setStatus(`Экспорт: ${exportState.data.found}/${exportState.data.count}`, "saved");
  });
}

function setExportFormat(format) {
  exportState.format = format;
  renderExportDialog();
}

function renderExportDialog() {
  els.exportJsonTab.classList.toggle("active", exportState.format === "json");
  els.exportKeysTab.classList.toggle("active", exportState.format === "keys");

  if (!exportState.data) {
    els.exportMeta.textContent = "No export loaded";
    els.exportText.value = "";
    return;
  }

  const keys = exportState.data.accounts.map((item) => item.apiKey).filter(Boolean);
  els.exportMeta.textContent = exportState.format === "json"
    ? `Full export: ${exportState.data.found}/${exportState.data.count} keys found`
    : `9router import list: ${keys.length} keys, one per line`;
  els.exportText.value = exportState.format === "json"
    ? JSON.stringify(exportState.data, null, 2) + "\n"
    : keys.join("\n") + (keys.length ? "\n" : "");
}

async function copyCurrentExport() {
  await withStatus("Копирую экспорт", async () => {
    await copyToClipboard(els.exportText.value);
    setStatus("Экспорт скопирован", "saved");
  });
}

function downloadCurrentExport() {
  const safeDate = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = exportState.format === "json"
    ? `opencode-go-api-keys-${safeDate}.json`
    : `opencode-go-api-keys-${safeDate}.txt`;
  downloadText(filename, els.exportText.value, exportState.format === "json" ? "application/json" : "text/plain");
  setStatus("Экспорт скачан", "saved");
}

function downloadText(filename, value, type) {
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyToClipboard(value) {
  if (!value) {
    throw new Error("API key is empty");
  }
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable");
  }
  await navigator.clipboard.writeText(value);
}

async function withStatus(label, fn) {
  setStatus(label, "dirty");
  try {
    await fn();
    setStatus("Готово", "saved");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(body?.error?.message || response.statusText);
    error.status = response.status;
    if (response.status === 401 && !options.skipAuthRedirect) {
      showLogin();
    }
    throw error;
  }
  return body;
}

function showLogin() {
  els.loginPanel.hidden = false;
  els.appPanel.hidden = true;
  document.body.classList.add("locked");
}

function showApp() {
  els.loginPanel.hidden = true;
  els.appPanel.hidden = false;
  document.body.classList.remove("locked");
}

function setStatus(text, level = "") {
  els.statusText.textContent = text;
  els.statusText.className = `status ${level}`.trim();
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatReset(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return "no reset";
  }
  const seconds = Math.max(0, Math.round((time - Date.now()) / 1000));
  return `resets in ${formatAge(seconds)}`;
}

function formatAge(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function plural(value, singular, pluralValue) {
  return `${value} ${value === 1 ? singular : pluralValue}`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
