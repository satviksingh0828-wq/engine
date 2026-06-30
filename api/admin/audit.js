import { requireAdmin } from "../../lib/auth.js";
import { listAuditEvents } from "../../lib/audit.js";

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: { code: "method_not_allowed", message: "Method not allowed" } });
  return res.status(200).json({ events: listAuditEvents(req.query?.limit) });
}
