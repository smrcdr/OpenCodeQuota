import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

export function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

export function sendNoContent(res) {
  res.statusCode = 204;
  res.end();
}

export function sendText(res, status, text) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text);
}

export async function readJsonRequest(req, { maxBytes = 1_000_000 } = {}) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return null;
  }

  return JSON.parse(text);
}

export async function serveStaticFile(res, publicDir, requestedPath) {
  const cleanPath = requestedPath.replace(/^\/+/, "") || "admin.html";
  const absolute = path.resolve(publicDir, cleanPath);
  if (!absolute.startsWith(path.resolve(publicDir) + path.sep)) {
    return sendText(res, 404, "Not found");
  }

  try {
    const fileStat = await stat(absolute);
    if (!fileStat.isFile()) {
      return sendText(res, 404, "Not found");
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", MIME_TYPES.get(path.extname(absolute)) || "application/octet-stream");
    createReadStream(absolute).pipe(res);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return sendText(res, 404, "Not found");
    }
    throw error;
  }
}

export function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return cookies;
}

export function buildCookie(name, value, req, maxAgeSeconds) {
  const secure = String(req.headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}
