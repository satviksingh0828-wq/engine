// lib/parseSql.js
// Parses a single SQL statement, identifies its type and target table.
// Hardened slightly: rejects multiple stacked statements and obviously
// dangerous patterns. This is still not a substitute for a real SQL parser —
// see README security notes.

const ALLOWED_TYPES = ["CREATE", "READ", "WRITE", "DROP"];

export function parseStatement(sql) {
  if (typeof sql !== "string" || !sql.trim()) {
    throw new Error("SQL statement is required.");
  }

  const trimmed = sql.trim().replace(/;\s*$/, "");

  // Reject stacked statements like "DROP TABLE x; SELECT * FROM y"
  if (trimmed.includes(";")) {
    throw new Error("Multiple statements in one request are not allowed.");
  }

  const upper = trimmed.toUpperCase();
  let type, table, columns = [];

  if (upper.startsWith("CREATE TABLE")) {
    type = "CREATE";
    table = trimmed.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?(\w+)["`]?/i)?.[1];
    const colMatch = trimmed.match(/\(([^]*)\)/);
    if (colMatch) {
      columns = colMatch[1]
        .split(",")
        .map((c) => c.trim().split(/\s+/)[0])
        .filter(Boolean);
    }
  } else if (upper.startsWith("INSERT INTO")) {
    type = "WRITE";
    table = trimmed.match(/INSERT INTO\s+["`]?(\w+)["`]?/i)?.[1];
  } else if (upper.startsWith("UPDATE")) {
    type = "WRITE";
    table = trimmed.match(/UPDATE\s+["`]?(\w+)["`]?/i)?.[1];
  } else if (upper.startsWith("DELETE FROM")) {
    type = "WRITE";
    table = trimmed.match(/DELETE FROM\s+["`]?(\w+)["`]?/i)?.[1];
  } else if (upper.startsWith("SELECT")) {
    type = "READ";
    table = trimmed.match(/FROM\s+["`]?(\w+)["`]?/i)?.[1];
  } else if (upper.startsWith("DROP TABLE")) {
    type = "DROP";
    table = trimmed.match(/DROP TABLE\s+(?:IF EXISTS\s+)?["`]?(\w+)["`]?/i)?.[1];
  } else {
    throw new Error(
      "Unsupported statement. Allowed: CREATE TABLE, SELECT, INSERT, UPDATE, DELETE, DROP TABLE."
    );
  }

  if (!table) throw new Error("Could not determine target table from SQL.");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error("Invalid table name.");
  }
  if (!ALLOWED_TYPES.includes(type)) throw new Error("Unsupported statement type.");

  return { type, table, columns, sql: trimmed };
}
