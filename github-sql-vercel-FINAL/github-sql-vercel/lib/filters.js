import { assertIdentifier } from "./validators.js";

const OPS = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
};

const RESERVED_PARAMS = new Set(["limit", "offset", "order", "table", "select"]);

function validateFilterColumn(key, allowedColumns) {
  assertIdentifier(key, `Filter column '${key}'`);
  if (Array.isArray(allowedColumns) && !allowedColumns.includes(key)) {
    throw new Error(`Filter column '${key}' does not exist in this table schema.`);
  }
}

export function parseFilters(query, allowedColumns = null) {
  const conditions = [];
  const params = [];

  for (const [key, rawValue] of Object.entries(query || {})) {
    if (RESERVED_PARAMS.has(key)) continue;
    validateFilterColumn(key, allowedColumns);

    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const dotIndex = String(value).indexOf(".");
    if (dotIndex === -1) {
      throw new Error(`Invalid filter syntax for '${key}'. Expected format: ${key}=eq.value`);
    }

    const op = String(value).slice(0, dotIndex);
    const val = String(value).slice(dotIndex + 1);

    if (!OPS[op]) {
      throw new Error(`Unsupported filter operator '${op}'. Allowed: ${Object.keys(OPS).join(", ")}`);
    }

    conditions.push(`${key} ${OPS[op]} ?`);
    params.push(op === "like" ? val.replace(/\*/g, "%") : val);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export function parseSelect(query, allowedColumns = null) {
  const requested = String(query?.select || "*").trim();
  if (!requested || requested === "*") return "*";

  const columns = requested.split(",").map((column) => column.trim()).filter(Boolean);
  if (!columns.length) return "*";

  for (const column of columns) {
    validateFilterColumn(column, allowedColumns);
  }

  return columns.join(", ");
}

export function parseOrder(query, allowedColumns = null) {
  if (!query?.order) return "";
  const match = String(query.order).match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(asc|desc)$/);
  if (!match) return "";
  const [, column, direction] = match;
  if (Array.isArray(allowedColumns) && !allowedColumns.includes(column)) return "";
  return `ORDER BY ${column} ${direction.toUpperCase()}`;
}

export function parseLimitOffset(query) {
  const limit = Number.isInteger(Number(query?.limit)) ? Math.max(0, Math.min(Number(query.limit), 500)) : null;
  const offset = Number.isInteger(Number(query?.offset)) ? Math.max(0, Number(query.offset)) : null;
  let clause = "";
  if (limit !== null) clause += ` LIMIT ${limit}`;
  if (offset !== null) clause += ` OFFSET ${offset}`;
  return clause;
}
