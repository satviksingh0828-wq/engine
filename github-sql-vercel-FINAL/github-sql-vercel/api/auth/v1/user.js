import { checkApiKey } from "../../../lib/auth.js";

export default function handler(req, res) {
  if (!checkApiKey(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: { code: "method_not_allowed", message: "Method not allowed" } });

  return res.status(200).json({
    id: req.engineAuth?.keyName || "api-key-user",
    aud: "authenticated",
    role: req.engineAuth?.role || "service",
    app_metadata: { provider: "api_key" },
    user_metadata: { keyName: req.engineAuth?.keyName || "unnamed" },
  });
}
