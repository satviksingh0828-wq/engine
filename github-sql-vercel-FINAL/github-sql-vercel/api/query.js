// api/query.js  (Vercel serverless function)
// POST { "sql": "..." } -> runs SQL against the matching table file in GitHub.
// Auto-creates and bootstraps the repo on the very first call.

import initSqlJs from "sql.js";
import {
  ensureRepoBootstrapped,
  getTableFile,
  saveTableFile,
  registerTable,
  listTables,
} from "../lib/github.js";
import { parseStatement } from "../lib/parseSql.js";

let SQL;
async function getSqlEngine() {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) => `node_modules/sql.js/dist/${file}`,
    });
  }
  return SQL;
}

export default async function handler(req, res) {
  try {
    await ensureRepoBootstrapped();
  } catch (err) {
    console.error("Bootstrap failed:", err);
    return res.status(500).json({
      error:
        "Repo setup failed. Check GITHUB_TOKEN has repo-creation permission, and GITHUB_OWNER/GITHUB_REPO are set correctly.",
      detail: err.message,
    });
  }

  if (req.method === "GET") {
    const tables = await listTables();
    return res.status(200).json({ tables });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { sql } = req.body || {};
  let statement;
  try {
    statement = parseStatement(sql);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { type, table, columns } = statement;
  const SQLEngine = await getSqlEngine();

  try {
    const { buffer, sha } = await getTableFile(table);

    if (!buffer && type !== "CREATE") {
      return res.status(404).json({ error: `Table '${table}' does not exist.` });
    }

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

    return res.status(200).json({
      type,
      table,
      rows: type === "READ" ? rows : undefined,
      success: true,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
