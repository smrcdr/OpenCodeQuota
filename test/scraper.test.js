import assert from "node:assert/strict";
import test from "node:test";
import {
  extractOpenCodeGoApiKey,
  parseDataSlotFormat,
  parseHumanReadableTime,
  parseOpenCodeGoDashboard,
  queryOpenCodeGoApiKey,
  queryOpenCodeGoQuota,
} from "../src/scraper.js";

test("parses SolidJS hydration when usagePercent appears before resetInSec", () => {
  const html = `rollingUsage:$R[1]={usagePercent:42,resetInSec:3600}`;
  const result = parseOpenCodeGoDashboard(html, Date.UTC(2026, 0, 1));
  assert.equal(result.rolling.usagePercent, 42);
  assert.equal(result.rolling.percentRemaining, 58);
  assert.equal(result.rolling.resetAt, "2026-01-01T01:00:00.000Z");
  assert.equal(result.rolling.limitUsd, 12);
  assert.equal(result.rolling.usedUsd, 5.04);
});

test("parses SolidJS hydration when resetInSec appears before usagePercent", () => {
  const html = `weeklyUsage:$R[2]={resetInSec:7200,usagePercent:10.5}`;
  const result = parseOpenCodeGoDashboard(html, Date.UTC(2026, 0, 1));
  assert.equal(result.weekly.usagePercent, 10.5);
  assert.equal(result.weekly.resetInSec, 7200);
  assert.equal(result.weekly.remainingUsd, 26.85);
});

test("parses data-slot dashboard format", () => {
  const html = `
    <div data-slot="usage-item">
      <span data-slot="usage-label">Rolling Usage</span>
      <strong data-slot="usage-value">42%</strong>
      <span data-slot="reset-time">Resets in 1 hour 30 minutes</span>
    </div>
    <div data-slot="usage-item">
      <span data-slot="usage-label">Monthly Usage</span>
      <strong data-slot="usage-value">7.5%</strong>
      <span data-slot="reset-now">Reset now</span>
    </div>
  `;
  const raw = parseDataSlotFormat(html);
  assert.deepEqual(raw.rolling, { usagePercent: 42, resetInSec: 5400 });
  assert.deepEqual(raw.monthly, { usagePercent: 7.5, resetInSec: 0 });
});

test("parses human-readable reset times", () => {
  assert.equal(parseHumanReadableTime("Reset now"), 0);
  assert.equal(parseHumanReadableTime("12 minutes"), 720);
  assert.equal(parseHumanReadableTime("1 hour 56 minutes"), 6960);
  assert.equal(parseHumanReadableTime("6 days 2 hours"), 525600);
  assert.equal(parseHumanReadableTime("unknown"), null);
});

test("missing windows do not crash", () => {
  const result = parseOpenCodeGoDashboard(`monthlyUsage:$R[5]={usagePercent:50,resetInSec:60}`);
  assert.equal(result.rolling, undefined);
  assert.equal(result.monthly.usagePercent, 50);
});

test("unknown HTML returns a clear parse error", () => {
  assert.throws(
    () => parseOpenCodeGoDashboard("<html>No quota here</html>"),
    /Could not parse any known OpenCode Go dashboard usage windows/,
  );
});

test("queryOpenCodeGoQuota sanitizes timeout-style errors", async () => {
  const result = await queryOpenCodeGoQuota("workspace", "cookie", {
    requestTimeoutMs: 10,
    fetchImpl: async () => {
      throw new Error("Request timed out after 10ms <b>secret</b>");
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.error, "Request timed out after 10ms secret");
});

test("queryOpenCodeGoQuota reports login redirects clearly", async () => {
  const result = await queryOpenCodeGoQuota("workspace", "cookie", {
    fetchImpl: async () => new Response("<title>OpenAuth</title>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  });
  assert.equal(result.success, false);
  assert.equal(result.error, "OpenCode Go dashboard requires login; check workspaceId and authCookie");
});

test("queryOpenCodeGoQuota forwards the account proxy to Bun fetch", async () => {
  let requestOptions = null;
  const result = await queryOpenCodeGoQuota("workspace", "cookie", {
    proxyURL: "http://user:pass@proxy.example.test:1234",
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return new Response("rollingUsage:$R[1]={usagePercent:10,resetInSec:60}", {
        status: 200,
      });
    },
  });
  assert.equal(result.success, true);
  assert.equal(requestOptions.proxy, "http://user:pass@proxy.example.test:1234");
});

test("extracts API key from SSR or hydration-like content", () => {
  const html = `apiKey:$R[3]={value:"sk-live_hydration_key_12345"}`;
  assert.equal(extractOpenCodeGoApiKey(html), "sk-live_hydration_key_12345");
});

test("extracts API key from inline script JSON", () => {
  const html = `<script>window.__STATE__={"apiKey":"sk-live_script_key_67890"}</script>`;
  assert.equal(extractOpenCodeGoApiKey(html), "sk-live_script_key_67890");
});

test("extracts API key from HTML input value", () => {
  const html = `<input name="apiKey" value="sk-live_input_key_abcde" />`;
  assert.equal(extractOpenCodeGoApiKey(html), "sk-live_input_key_abcde");
});

test("chooses first valid API key and ignores masked placeholders", () => {
  const html = `sk-...masked <code>sk-live_first_key_11111</code> <code>sk-live_second_key_22222</code>`;
  assert.equal(extractOpenCodeGoApiKey(html), "sk-live_first_key_11111");
});

test("queryOpenCodeGoApiKey returns api_key_not_found for unknown HTML", async () => {
  const result = await queryOpenCodeGoApiKey("workspace", "cookie", {
    fetchImpl: async () => new Response("<html>No key here</html>", { status: 200 }),
  });
  assert.equal(result.success, false);
  assert.equal(result.code, "api_key_not_found");
  assert.equal(result.error, "api_key_not_found");
});

test("queryOpenCodeGoApiKey falls back to workspace keys page", async () => {
  const calls = [];
  const result = await queryOpenCodeGoApiKey("workspace", "cookie", {
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/keys")) {
        return new Response('<button data-api-key="sk-live_keys_page_12345">Copy</button>', { status: 200 });
      }
      return new Response("<html>No key on go page</html>", { status: 200 });
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.apiKey, "sk-live_keys_page_12345");
  assert.equal(result.sourcePath, "/keys");
  assert.equal(calls.length, 2);
});

test("queryOpenCodeGoApiKey sanitizes dashboard errors", async () => {
  const result = await queryOpenCodeGoApiKey("workspace", "cookie-secret", {
    fetchImpl: async () => new Response("auth=cookie-secret sk-live_error_key_99999", { status: 500 }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /auth=\.\.\.redacted/);
  assert.match(result.error, /sk-\.\.\.redacted/);
  assert.doesNotMatch(result.error, /cookie-secret/);
  assert.doesNotMatch(result.error, /sk-live_error_key_99999/);
});
