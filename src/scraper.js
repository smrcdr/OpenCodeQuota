import { clampPercent, sanitizeMessage } from "./format.js";

export const WINDOW_ORDER = ["rolling", "weekly", "monthly"];

export const WINDOW_METADATA = {
  rolling: { label: "5h", name: "5h", limitUsd: 12 },
  weekly: { label: "Weekly", name: "Weekly", limitUsd: 30 },
  monthly: { label: "Monthly", name: "Monthly", limitUsd: 60 },
};

const DASHBOARD_URL_PREFIX = "https://opencode.ai/workspace/";
const DASHBOARD_URL_SUFFIX = "/go";
const DASHBOARD_API_KEYS_SUFFIX = "/keys";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0";
const SCRAPED_NUMBER_PATTERN = String.raw`(-?\d+(?:\.\d+)?)`;
const API_KEY_PATTERN = /(^|[^A-Za-z0-9_-])(sk-[A-Za-z0-9][A-Za-z0-9_-]{10,})(?=$|[^A-Za-z0-9_-])/g;

const WINDOW_PATTERNS = {
  rolling: buildHydrationPatterns("rollingUsage"),
  weekly: buildHydrationPatterns("weeklyUsage"),
  monthly: buildHydrationPatterns("monthlyUsage"),
};

function buildHydrationPatterns(field) {
  return {
    pctFirst: new RegExp(
      String.raw`${field}:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
    ),
    resetFirst: new RegExp(
      String.raw`${field}:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
    ),
  };
}

export function parseWindowUsage(html, patterns) {
  const pctFirstMatch = patterns.pctFirst.exec(html);
  if (pctFirstMatch) {
    const usagePercent = Number(pctFirstMatch[1]);
    const resetInSec = Number(pctFirstMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }

  const resetFirstMatch = patterns.resetFirst.exec(html);
  if (resetFirstMatch) {
    const resetInSec = Number(resetFirstMatch[1]);
    const usagePercent = Number(resetFirstMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }

  return null;
}

export function parseHumanReadableTime(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .trim()
    .replace(/reset-now/g, "reset now")
    .replace(/resets?\s+in\s+/g, "")
    .replace(/\s+/g, " ");

  if (["reset now", "now", "resets now"].includes(normalized)) {
    return 0;
  }

  let seconds = 0;
  let matched = false;
  const units = [
    [/(-?\d+(?:\.\d+)?)\s*days?/g, 86400],
    [/(-?\d+(?:\.\d+)?)\s*hours?/g, 3600],
    [/(-?\d+(?:\.\d+)?)\s*minutes?/g, 60],
    [/(-?\d+(?:\.\d+)?)\s*seconds?/g, 1],
  ];

  for (const [regex, multiplier] of units) {
    for (const match of normalized.matchAll(regex)) {
      matched = true;
      seconds += Number(match[1]) * multiplier;
    }
  }

  return matched && Number.isFinite(seconds) ? Math.max(0, seconds) : null;
}

export function parseDataSlotFormat(html) {
  const result = {};
  const items = String(html || "").split(/data-slot=["']usage-item["']/);

  for (let index = 1; index < items.length; index += 1) {
    const content = items[index];
    const labelMatch = content.match(/data-slot=["']usage-label["'][^>]*>([^<]+)</i);
    const usageMatch = content.match(/data-slot=["']usage-value["'][^>]*>[^0-9-]*(-?\d+(?:\.\d+)?)/i);
    const resetMatch = content.match(/data-slot=["'](reset-time|reset-now)["'][^>]*>([\s\S]*?)<\/span>/i);
    if (!labelMatch || !usageMatch || !resetMatch) {
      continue;
    }

    const label = decodeHtml(labelMatch[1]).trim().toLowerCase();
    const usagePercent = Number(usageMatch[1]);
    const resetContent = decodeHtml(resetMatch[2])
      .replace(/<!--\$-->/g, "")
      .replace(/<!--\/-->/g, "")
      .replace(/<[^>]*>/g, " ")
      .trim();
    const resetInSec = resetMatch[1] === "reset-now" ? 0 : parseHumanReadableTime(resetContent);
    const window = label.includes("rolling")
      ? "rolling"
      : label.includes("weekly")
        ? "weekly"
        : label.includes("monthly")
          ? "monthly"
          : null;

    if (window && Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      result[window] = { usagePercent, resetInSec };
    }
  }

  return result;
}

export function parseOpenCodeGoDashboard(html, now = Date.now()) {
  const raw = {};
  for (const window of WINDOW_ORDER) {
    const parsed = parseWindowUsage(html, WINDOW_PATTERNS[window]);
    if (parsed) {
      raw[window] = parsed;
    }
  }

  if (Object.keys(raw).length === 0) {
    Object.assign(raw, parseDataSlotFormat(html));
  }

  if (Object.keys(raw).length === 0) {
    throw new Error("Could not parse any known OpenCode Go dashboard usage windows");
  }

  const windows = {};
  for (const window of WINDOW_ORDER) {
    if (raw[window]) {
      windows[window] = normalizeWindowUsage(window, raw[window], now);
    }
  }

  return windows;
}

export function normalizeWindowUsage(window, value, now = Date.now()) {
  const usagePercent = clampPercent(value.usagePercent);
  const percentRemaining = clampPercent(100 - usagePercent);
  const resetInSec = Math.max(0, Number(value.resetInSec) || 0);
  const meta = WINDOW_METADATA[window];
  const usedUsd = roundMoney((usagePercent / 100) * meta.limitUsd);
  const remainingUsd = roundMoney(meta.limitUsd - usedUsd);

  return {
    label: meta.label,
    usagePercent,
    percentRemaining,
    resetInSec,
    resetAt: new Date(now + resetInSec * 1000).toISOString(),
    limitUsd: meta.limitUsd,
    usedUsd,
    remainingUsd,
  };
}

export async function queryOpenCodeGoQuota(workspaceId, authCookie, options = {}) {
  const timeoutMs = options.requestTimeoutMs ?? 10_000;
  const url = `${DASHBOARD_URL_PREFIX}${encodeURIComponent(workspaceId)}${DASHBOARD_URL_SUFFIX}`;
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        ...(options.proxyURL ? { proxy: options.proxyURL } : {}),
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html",
          Cookie: `auth=${authCookie}`,
        },
      },
      timeoutMs,
      options.fetchImpl,
    );

    const html = await response.text();
    if (!response.ok) {
      throw new Error(`OpenCode Go dashboard error ${response.status}: ${sanitizeMessage(html)}`);
    }
    if (isAuthPage(response, html)) {
      throw new Error("OpenCode Go dashboard requires login; check workspaceId and authCookie");
    }

    return {
      success: true,
      windows: parseOpenCodeGoDashboard(html, startedAt),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      success: false,
      error: sanitizeMessage(error instanceof Error ? error.message : String(error)),
      latencyMs: Date.now() - startedAt,
    };
  }
}

export function extractOpenCodeGoApiKey(html) {
  const candidates = [];
  const seen = new Set();
  for (const source of buildApiKeySearchSources(html)) {
    API_KEY_PATTERN.lastIndex = 0;
    for (const match of source.matchAll(API_KEY_PATTERN)) {
      const key = match[2];
      if (isLikelyOpenCodeGoApiKey(key) && !seen.has(key)) {
        seen.add(key);
        candidates.push(key);
      }
    }
  }
  return candidates[0] || null;
}

export async function queryOpenCodeGoApiKey(workspaceId, authCookie, options = {}) {
  const timeoutMs = options.requestTimeoutMs ?? 10_000;
  const startedAt = Date.now();
  let lastError = "api_key_not_found";

  try {
    for (const suffix of [DASHBOARD_URL_SUFFIX, DASHBOARD_API_KEYS_SUFFIX]) {
      const url = `${DASHBOARD_URL_PREFIX}${encodeURIComponent(workspaceId)}${suffix}`;
      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          ...(options.proxyURL ? { proxy: options.proxyURL } : {}),
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html",
            Cookie: `auth=${authCookie}`,
          },
        },
        timeoutMs,
        options.fetchImpl,
      );

      const html = await response.text();
      if (!response.ok) {
        lastError = `OpenCode Go dashboard error ${response.status}: ${sanitizeMessage(html)}`;
        continue;
      }
      if (isAuthPage(response, html)) {
        lastError = "OpenCode Go dashboard requires login; check workspaceId and authCookie";
        continue;
      }

      const apiKey = extractOpenCodeGoApiKey(html);
      if (apiKey) {
        return {
          success: true,
          apiKey,
          sourcePath: suffix,
          latencyMs: Date.now() - startedAt,
        };
      }
    }

    return {
      success: false,
      code: "api_key_not_found",
      error: lastError,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      success: false,
      code: "api_key_error",
      error: sanitizeMessage(error instanceof Error ? error.message : String(error)),
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function fetchWithTimeout(url, options, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function buildApiKeySearchSources(html) {
  const text = String(html || "");
  const decoded = decodeHtml(text);
  const sources = [text, decoded];

  for (const scriptMatch of decoded.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    sources.push(scriptMatch[1]);
  }
  for (const valueMatch of decoded.matchAll(/\b(?:value|data-key|data-api-key|content)=["']([^"']+)["']/gi)) {
    sources.push(valueMatch[1]);
  }

  return sources;
}

function isLikelyOpenCodeGoApiKey(value) {
  const text = String(value || "");
  if (!text.startsWith("sk-")) {
    return false;
  }
  if (text.includes("...")) {
    return false;
  }
  return text.length >= 14;
}

function isAuthPage(response, html) {
  const url = String(response?.url || "");
  return url.includes("auth.opencode.ai") || /<title[^>]*>\s*OpenAuth\s*<\/title>/i.test(String(html || ""));
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
