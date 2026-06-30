import { rateLimit } from "./rateLimit.js";

function configuredKeys() {
  const keys = [];
  if (process.env.API_KEY) keys.push({ key: process.env.API_KEY, role: "admin", name: "legacy-admin" });

  for (const item of String(process.env.API_KEYS || "").split(",")) {
    const [name, key, role = "service"] = item.split(":").map((part) => part?.trim());
    if (name && key) keys.push({ name, key, role });
  }

  return keys;
}

export function checkApiKey(req, res, options = {}) {
  if (!rateLimit(req, res, options.rateLimit)) return false;

  const provided = req.headers["x-api-key"];
  const keys = configuredKeys();

  if (!keys.length) {
    res.status(500).json({ error: { code: "missing_api_key", message: "Server misconfigured: API_KEY or API_KEYS env var is not set." } });
    return false;
  }

  const match = keys.find((item) => provided && provided === item.key);
  if (!match) {
    res.status(401).json({ error: { code: "unauthorized", message: "Unauthorized: missing or invalid x-api-key header." } });
    return false;
  }

  req.engineAuth = { role: match.role || "service", keyName: match.name || "unnamed" };
  return true;
}

export function requireAdmin(req, res) {
  if (!checkApiKey(req, res)) return false;
  if (!["admin", "service"].includes(req.engineAuth?.role)) {
    res.status(403).json({ error: { code: "forbidden", message: "This operation requires an admin or service key." } });
    return false;
  }
  return true;
}
