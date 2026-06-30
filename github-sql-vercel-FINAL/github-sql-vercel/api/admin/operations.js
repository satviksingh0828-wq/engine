import { requireAdmin } from "../../lib/auth.js";
import { bufferedWriteSettings, flushTable, listBufferedOperations } from "../../lib/tableStore.js";
import { assertIdentifier } from "../../lib/validators.js";

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  if (req.method === "GET") {
    return res.status(200).json({ settings: bufferedWriteSettings(), operations: listBufferedOperations() });
  }

  if (req.method === "POST") {
    try {
      const { table } = req.body || {};
      assertIdentifier(table, "Table name");
      await flushTable(table);
      return res.status(200).json({ success: true, table, operations: listBufferedOperations() });
    } catch (err) {
      return res.status(400).json({ error: { code: "flush_failed", message: err.message } });
    }
  }

  return res.status(405).json({ error: { code: "method_not_allowed", message: "Method not allowed" } });
}
