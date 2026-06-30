import { checkApiKey } from "../../lib/auth.js";
import { getSqlEngine } from "../../lib/sqlEngine.js";
import { getSchema } from "../../lib/github.js";
import { getBufferedTableFile, persistTableFile, withTableLock } from "../../lib/tableStore.js";
import { parseFilters, parseOrder, parseLimitOffset, parseSelect } from "../../lib/filters.js";
import { assertIdentifier, validateColumns } from "../../lib/validators.js";
import { ensurePolicy } from "../../lib/policies.js";
import { recordAuditEvent } from "../../lib/audit.js";

export default async function handler(req, res) {
  if (!checkApiKey(req, res)) return;

  const { table } = req.query;
  try {
    assertIdentifier(table, "Table name");
  } catch (err) {
    return res.status(400).json({ error: { code: "invalid_table", message: err.message } });
  }

  try {
    return await withTableLock(table, async () => {
    const { schema } = await getSchema();
    const role = req.engineAuth?.role || "service";
    const schemaColumns = schema.tables?.[table]?.columns || null;

    const SQLEngine = await getSqlEngine();
    const { buffer, sha, pending } = await getBufferedTableFile(table);

    if (!buffer) {
      return res.status(404).json({ error: { code: "not_found", message: `Table '${table}' does not exist.` } });
    }

    const db = new SQLEngine.Database(buffer);

    if (req.method === "GET") {
      ensurePolicy(schema, table, "select", role);
      const { whereClause, params } = parseFilters(req.query, schemaColumns);
      const select = parseSelect(req.query, schemaColumns);
      const order = parseOrder(req.query, schemaColumns);
      const limitOffset = parseLimitOffset(req.query);

      const stmt = db.prepare(`SELECT ${select} FROM ${table} ${whereClause} ${order}${limitOffset}`);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      db.close();
      recordAuditEvent(req, { action: "select", table, status: "success", count: rows.length });
      res.setHeader("Content-Range", `0-${Math.max(rows.length - 1, 0)}/${rows.length}`);
      return res.status(200).json({ data: rows, count: rows.length, pendingFlush: pending });
    }

    if (req.method === "POST") {
      ensurePolicy(schema, table, "insert", role);
      const body = req.body || {};
      const columns = validateColumns(Object.keys(body), schemaColumns);
      if (!columns.length) {
        db.close();
        return res.status(400).json({ error: { code: "empty_body", message: "Request body must contain at least one column." } });
      }
      const placeholders = columns.map(() => "?").join(", ");
      const values = columns.map((column) => body[column]);

      db.run(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`, values);

      const insertedId = db.exec("SELECT last_insert_rowid() AS id")[0]?.values?.[0]?.[0];

      const newBuffer = Buffer.from(db.export());
      db.close();
      const persistence = await persistTableFile(table, newBuffer, sha, `Buffered inserts into ${table}`);
      recordAuditEvent(req, { action: "insert", table, status: "success", persistence });

      return res.status(201).json({ data: { id: insertedId, ...body }, persistence });
    }

    if (req.method === "PUT") {
      ensurePolicy(schema, table, "update", role);
      const { whereClause, params: filterParams } = parseFilters(req.query, schemaColumns);
      if (!whereClause) {
        db.close();
        return res.status(400).json({
          error: { code: "missing_filter", message: "PUT requires at least one filter (e.g. ?id=eq.1) to avoid updating all rows." },
        });
      }

      const body = req.body || {};
      const columns = validateColumns(Object.keys(body), schemaColumns);
      if (!columns.length) {
        db.close();
        return res.status(400).json({ error: { code: "empty_body", message: "Request body must contain at least one column to update." } });
      }

      const setClause = columns.map((c) => `${c} = ?`).join(", ");
      const updateParams = [...columns.map((column) => body[column]), ...filterParams];

      db.run(`UPDATE ${table} SET ${setClause} ${whereClause}`, updateParams);

      const newBuffer = Buffer.from(db.export());
      db.close();
      const persistence = await persistTableFile(table, newBuffer, sha, `Buffered updates to ${table}`);
      recordAuditEvent(req, { action: "update", table, status: "success", persistence });

      return res.status(200).json({ success: true, persistence });
    }

    if (req.method === "DELETE") {
      ensurePolicy(schema, table, "delete", role);
      const { whereClause, params } = parseFilters(req.query, schemaColumns);
      if (!whereClause) {
        db.close();
        return res.status(400).json({
          error: { code: "missing_filter", message: "DELETE requires at least one filter (e.g. ?id=eq.1) to avoid deleting all rows." },
        });
      }

      db.run(`DELETE FROM ${table} ${whereClause}`, params);

      const newBuffer = Buffer.from(db.export());
      db.close();
      const persistence = await persistTableFile(table, newBuffer, sha, `Buffered deletes from ${table}`);
      recordAuditEvent(req, { action: "delete", table, status: "success", persistence });

      return res.status(200).json({ success: true, persistence });
    }

    db.close();
    return res.status(405).json({ error: { code: "method_not_allowed", message: "Method not allowed" } });
    });
  } catch (err) {
    console.error(err);
    recordAuditEvent(req, { action: "table_request", table, status: "error", error: err.message });
    return res.status(500).json({ error: { code: "request_failed", message: err.message } });
  }
}
