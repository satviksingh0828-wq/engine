import { requireAdmin } from "../lib/auth.js";
import { getSqlEngine } from "../lib/sqlEngine.js";
import {
  ensureRepoBootstrapped,
  getTableFile,
  saveTableFile,
  deleteTableFile,
  registerTable,
  unregisterTable,
  listTables,
  getSchema,
} from "../lib/github.js";
import { parseStatement } from "../lib/parseSql.js";
import { ensurePolicy } from "../lib/policies.js";
import { recordAuditEvent } from "../lib/audit.js";
import { flushTable, forgetTable } from "../lib/tableStore.js";

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    await ensureRepoBootstrapped();
  } catch (err) {
    console.error("Bootstrap failed:", err);
    return res.status(500).json({
      error: {
        code: "bootstrap_failed",
        message: "Repo setup failed. Check GITHUB_TOKEN has repo-creation permission, and GITHUB_OWNER/GITHUB_REPO are set correctly.",
        detail: err.message,
      },
    });
  }

  if (req.method === "GET") {
    const tables = await listTables();
    return res.status(200).json({ tables });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: { code: "method_not_allowed", message: "Method not allowed" } });
  }

  const { sql } = req.body || {};
  let statement;
  try {
    statement = parseStatement(sql);
  } catch (err) {
    return res.status(400).json({ error: { code: "invalid_sql", message: err.message } });
  }

  const { type, table, columns } = statement;

  try {
    const { schema } = await getSchema();
    const role = req.engineAuth?.role || "service";
    const op = type === "READ" ? "select" : type === "CREATE" ? "insert" : type === "DROP" ? "delete" : "update";
    if (schema.tables?.[table]) ensurePolicy(schema, table, op, role);

    const { buffer, sha } = await getTableFile(table);

    if (!buffer && !["CREATE"].includes(type)) {
      return res.status(404).json({ error: { code: "not_found", message: `Table '${table}' does not exist.` } });
    }

    if (type === "DROP") {
      await flushTable(table);
      const latest = await getTableFile(table);
      await deleteTableFile(table, latest.sha || sha);
      await unregisterTable(table);
      forgetTable(table);
      recordAuditEvent(req, { action: "drop_table", table, status: "success" });
      return res.status(200).json({ type, table, success: true });
    }

    const SQLEngine = await getSqlEngine();
    const db = buffer ? new SQLEngine.Database(buffer) : new SQLEngine.Database();

    let rows = [];
    if (type === "READ") {
      const result = db.exec(statement.sql);
      rows = result.length
        ? result[0].values.map((row) =>
            Object.fromEntries(row.map((val, i) => [result[0].columns[i], val]))
          )
        : [];
    } else {
      db.run(statement.sql);
    }

    if (type !== "READ") {
      const newBuffer = Buffer.from(db.export());
      await saveTableFile(table, newBuffer, sha, `${type} on ${table}`);
    }

    if (type === "CREATE") {
      await registerTable(table, columns);
    }

    db.close();
    recordAuditEvent(req, { action: type.toLowerCase(), table, status: "success", count: rows.length });

    return res.status(200).json({
      type,
      table,
      rows: type === "READ" ? rows : undefined,
      success: true,
    });
  } catch (err) {
    console.error(err);
    recordAuditEvent(req, { action: type?.toLowerCase() || "query", table, status: "error", error: err.message });
    return res.status(500).json({ error: { code: "query_failed", message: err.message } });
  }
}
