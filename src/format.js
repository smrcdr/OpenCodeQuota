export function sanitizeMessage(text, maxLength = 180) {
  const value = String(text || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-...redacted")
    .replace(/auth=([^;\s]+)/gi, "auth=...redacted")
    .replace(/\s+/g, " ")
    .trim();

  return (value || "unknown").slice(0, maxLength);
}

export function maskSecret(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  if (text.length <= 8) {
    return "********";
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function maskApiKey(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= 12) {
    return "sk-...";
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

export function isoNow() {
  return new Date().toISOString();
}
