import { checkApiKey } from "../../lib/auth.js";
import { getSqlEngine } from "../../lib/sqlEngine.js";
import { getTableFile, saveTableFile } from "../../lib/github.js";
import { parseFilters, parseOrder, parseLimitOffset } from "../../lib/filters.js";

function rowsFromResult(result) {
  if (!result.length) return [];
  return result[0].values.map((row) =>
    Object.fromEntries(row.map((val, i) => [result[0].columns[i], val]))
  );
}

export default async function handler(req, res) {
  if (!checkApiKey(req, res)) return;

  const { table } = req.query;
  if (!table || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    return res.status(400).json({ error: "Invalid table name." });
  }

  try {
    const SQLEngine = await getSqlEngine();
    const { buffer, sha } = await getTableFile(table);

    if (!buffer) {
      return res.status(404).json({ error: `Table '${table}' does not exist.` });
    }

    const db = new SQLEngine.Database(buffer);

    if (req.method === "GET") {
      const { whereClause, params } = parseFilters(req.query);
      const order = parseOrder(req.query);
      const limitOffset = parseLimitOffset(req.query);

      const stmt = db.prepare(`SELECT * FROM ${table} ${whereClause} ${order}${limitOffset}`);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      db.close();
      return res.status(200).json({ data: rows });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const columns = Object.keys(body);
      if (!columns.length) {
        db.close();
        return res.status(400).json({ error: "Request body must contain at least one column." });
      }
      const placeholders = columns.map(() => "?").join(", ");
      const values = Object.values(body);

      db.run(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
        values
      );

      const insertedId = db.exec("SELECT last_insert_rowid() AS id")[0]?.values?.[0]?.[0];

      const newBuffer = Buffer.from(db.export());
      db.close();
      await saveTableFile(table, newBuffer, sha, `Insert row into ${table}`);

      return res.status(201).json({ data: { id: insertedId, ...body } });
    }

    if (req.method === "PUT") {
      const { whereClause, params: filterParams } = parseFilters(req.query);
      if (!whereClause) {
        db.close();
        return res.status(400).json({
          error: "PUT requires at least one filter (e.g. ?id=eq.1) to avoid updating all rows.",
        });
      }

      const body = req.body || {};
      const columns = Object.keys(body);
      if (!columns.length) {
        db.close();
        return res.status(400).json({ error: "Request body must contain at least one column to update." });
      }

      const setClause = columns.map((c) => `${c} = ?`).join(", ");
      const updateParams = [...Object.values(body), ...filterParams];

      db.run(`UPDATE ${table} SET ${setClause} ${whereClause}`, updateParams);

      const newBuffer = Buffer.from(db.export());
      db.close();
      await saveTableFile(table, newBuffer, sha, `Update rows in ${table}`);

      return res.status(200).json({ success: true });
    }

    if (req.method === "DELETE") {
      const { whereClause, params } = parseFilters(req.query);
      if (!whereClause) {
        db.close();
        return res.status(400).json({
          error: "DELETE requires at least one filter (e.g. ?id=eq.1) to avoid deleting all rows.",
        });
      }

      db.run(`DELETE FROM ${table} ${whereClause}`, params);

      const newBuffer = Buffer.from(db.export());
      db.close();
      await saveTableFile(table, newBuffer, sha, `Delete rows from ${table}`);

      return res.status(200).json({ success: true });
    }

    db.close();
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
