import { requireAdmin } from "../../lib/auth.js";
import { getSchema, updateTablePolicies } from "../../lib/github.js";
import { assertIdentifier } from "../../lib/validators.js";

const OPS = ["select", "insert", "update", "delete"];
const ROLES = ["admin", "service", "anon"];

function normalizePolicies(input) {
  const policies = {};
  for (const op of OPS) {
    const roles = Array.isArray(input?.[op]?.roles) ? input[op].roles : [];
    policies[op] = { roles: roles.filter((role) => ROLES.includes(role)) };
  }
  return policies;
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  if (req.method === "GET") {
    const { schema } = await getSchema();
    return res.status(200).json({ tables: schema.tables || {} });
  }

  if (req.method === "PUT") {
    try {
      const { table, policies } = req.body || {};
      assertIdentifier(table, "Table name");
      const updated = await updateTablePolicies(table, normalizePolicies(policies));
      return res.status(200).json({ table, schema: updated });
    } catch (err) {
      return res.status(400).json({ error: { code: "policy_update_failed", message: err.message } });
    }
  }

  return res.status(405).json({ error: { code: "method_not_allowed", message: "Method not allowed" } });
}
