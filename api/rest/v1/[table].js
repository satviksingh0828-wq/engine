import { getSqlEngine } from "../../../lib/sqlEngine.js";
import { getTableFile, saveTableFile, getSchema } from "../../../lib/github.js";
import { getUserFromRequest } from "../../../lib/jwt.js";
import { checkApiKey } from "../../../lib/auth.js";
import { parseFilters, parseOrder, parseLimitOffset } from "../../../lib/filters.js";
import { validateColumns } from "../../../lib/validators.js";

function auth(req) {
  const user = getUserFromRequest(req);
  const hasApiKey = (() => {
    const k = req.headers["x-api-key"] || req.headers["apikey"];
    if (!k) return false;
    const keys = (process.env.API_KEY ? [process.env.API_KEY] : []).concat(
      (process.env.API_KEYS || "").split(",").map((x) => x.split(":")[1]).filter(Boolean)
    );
    return keys.includes(k);
  })();
  return user || hasApiKey ? true : false;
}

export default async function handler(req, res) {
  if (!auth(req)) {
    return res.status(401).json({ message: "JWT is missing or invalid", hint: "Check apikey or Authorization header", code: "PGRST301" });
  }

  const table = req.query.table || req.url?.split("?")[0].split("/").filter(Boolean).pop();
  if (!table || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    return res.status(400).json({ message: "Invalid table name", code: "PGRST100" });
  }

  const prefer = req.headers["prefer"] || "";
  const returning = prefer.includes("return=representation");
  const { schema } = await getSchema();
  const schemaColumns = schema.tables?.[table]?.columns || null;

  try {
    const SQLEngine = await getSqlEngine();
    const { buffer, sha } = await getTableFile(table);

    if (!buffer) {
      return res.status(404).json({ message: `Table '${table}' does not exist`, code: "42P01", hint: "Create the table first via the SQL editor." });
    }

    const db = new SQLEngine.Database(buffer);

    if (req.method === "GET") {
      const selectCols = req.query.select || "*";
      const { whereClause, params } = parseFilters(req.query, schemaColumns);
      const order = parseOrder(req.query, schemaColumns);
      const limitOffset = parseLimitOffset(req.query);

      const rangeHeader = req.headers["range"];
      let limitClause = limitOffset;
      let rangeStart = 0, rangeEnd = null;
      if (rangeHeader) {
        const match = rangeHeader.match(/^(\d+)-(\d*)$/);
        if (match) {
          rangeStart = parseInt(match[1]);
          rangeEnd = match[2] ? parseInt(match[2]) : null;
          const rangeLimit = rangeEnd !== null ? rangeEnd - rangeStart + 1 : 1000;
          limitClause = ` LIMIT ${rangeLimit} OFFSET ${rangeStart}`;
        }
      }

      const safeCols = selectCols === "*" ? "*" : selectCols.split(",").map((c) => c.trim()).join(", ");
      const stmt = db.prepare(`SELECT ${safeCols} FROM ${table} ${whereClause} ${order}${limitClause}`);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();

      const countResult = db.exec(`SELECT COUNT(*) as c FROM ${table} ${whereClause}`, params);
      const total = countResult[0]?.values[0][0] ?? rows.length;
      db.close();

      res.setHeader("Content-Range", `${rangeStart}-${rangeStart + rows.length - 1}/${total}`);
      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const body = Array.isArray(req.body) ? req.body : [req.body];
      const inserted = [];

      for (const item of body) {
        const columns = schemaColumns ? validateColumns(Object.keys(item), schemaColumns) : Object.keys(item).filter((k) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
        if (!columns.length) continue;
        const placeholders = columns.map(() => "?").join(", ");
        const values = columns.map((c) => item[c]);
        db.run(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`, values);
        const id = db.exec("SELECT last_insert_rowid() AS id")[0]?.values?.[0]?.[0];
        if (returning) inserted.push({ id, ...item });
      }

      const newBuffer = Buffer.from(db.export());
      db.close();
      await saveTableFile(table, newBuffer, sha, `REST insert into ${table}`);

      res.setHeader("Prefer", prefer);
      if (returning) return res.status(201).json(inserted.length === 1 ? inserted[0] : inserted);
      return res.status(204).end();
    }

    if (req.method === "PATCH") {
      const { whereClause, params: filterParams } = parseFilters(req.query, schemaColumns);
      if (!whereClause) {
        db.close();
        return res.status(400).json({ message: "PATCH requires at least one filter", code: "PGRST105", hint: "Use ?column=eq.value" });
      }
      const body = req.body || {};
      const columns = Object.keys(body).filter((k) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
      if (!columns.length) { db.close(); return res.status(400).json({ message: "Body is empty" }); }

      const setClause = columns.map((c) => `${c} = ?`).join(", ");
      db.run(`UPDATE ${table} SET ${setClause} ${whereClause}`, [...columns.map((c) => body[c]), ...filterParams]);

      let updated = [];
      if (returning) {
        const stmt = db.prepare(`SELECT * FROM ${table} ${whereClause}`);
        stmt.bind(filterParams);
        while (stmt.step()) updated.push(stmt.getAsObject());
        stmt.free();
      }

      const newBuffer = Buffer.from(db.export());
      db.close();
      await saveTableFile(table, newBuffer, sha, `REST update ${table}`);

      if (returning) return res.status(200).json(updated);
      return res.status(204).end();
    }

    if (req.method === "DELETE") {
      const { whereClause, params: filterParams } = parseFilters(req.query, schemaColumns);
      if (!whereClause) {
        db.close();
        return res.status(400).json({ message: "DELETE requires at least one filter", code: "PGRST105" });
      }

      let deleted = [];
      if (returning) {
        const stmt = db.prepare(`SELECT * FROM ${table} ${whereClause}`);
        stmt.bind(filterParams);
        while (stmt.step()) deleted.push(stmt.getAsObject());
        stmt.free();
      }

      db.run(`DELETE FROM ${table} ${whereClause}`, filterParams);
      const newBuffer = Buffer.from(db.export());
      db.close();
      await saveTableFile(table, newBuffer, sha, `REST delete from ${table}`);

      if (returning) return res.status(200).json(deleted);
      return res.status(204).end();
    }

    db.close();
    return res.status(405).json({ message: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message, code: "XX000" });
  }
}
