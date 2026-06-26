import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthCookiePayload, buildWorkspaceGoUrl, toPublicSession } from "../src/browser-session.js";

test("buildWorkspaceGoUrl builds OpenCode Go dashboard URL", () => {
  assert.equal(
    buildWorkspaceGoUrl("wrk_01ABC"),
    "https://opencode.ai/workspace/wrk_01ABC/go",
  );
});

test("buildAuthCookiePayload uses only the auth token value", () => {
  assert.deepEqual(buildAuthCookiePayload("Fe26-secret"), {
    name: "auth",
    value: "Fe26-secret",
    domain: "opencode.ai",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  });
});

test("public browser session metadata does not include cookie or process details", () => {
  const publicSession = toPublicSession({
    id: "br_test",
    accountId: "1",
    accountName: "Main",
    workspaceId: "wrk_01ABC",
    url: "https://opencode.ai/workspace/wrk_01ABC/go",
    startedAt: "2026-06-25T18:30:00.000Z",
    profileDir: "/secret/profile",
    debugPort: 12345,
    child: { pid: 1 },
    authCookie: "Fe26-secret",
  });

  assert.deepEqual(Object.keys(publicSession).sort(), [
    "accountId",
    "accountName",
    "id",
    "startedAt",
    "url",
    "workspaceId",
  ]);
  assert.doesNotMatch(JSON.stringify(publicSession), /Fe26-secret|profileDir|debugPort|pid/);
});
