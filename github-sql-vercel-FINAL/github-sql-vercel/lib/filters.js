const OPS = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
};

const RESERVED_PARAMS = new Set(["limit", "offset", "order", "table"]);

export function parseFilters(query) {
  const conditions = [];
  const params = [];

  for (const [key, rawValue] of Object.entries(query || {})) {
    if (RESERVED_PARAMS.has(key)) continue;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid filter column name: ${key}`);
    }

    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const dotIndex = value.indexOf(".");
    if (dotIndex === -1) {
      throw new Error(
        `Invalid filter syntax for '${key}'. Expected format: ${key}=eq.value`
      );
    }

    const op = value.slice(0, dotIndex);
    const val = value.slice(dotIndex + 1);

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

export function parseOrder(query) {
  if (!query?.order) return "";
  const match = String(query.order).match(/^[a-zA-Z_][a-zA-Z0-9_]*\.(asc|desc)$/);
  if (!match) return "";
  const [column, direction] = query.order.split(".");
  return `ORDER BY ${column} ${direction.toUpperCase()}`;
}

export function parseLimitOffset(query) {
  const limit = Number.isInteger(Number(query?.limit)) ? Number(query.limit) : null;
  const offset = Number.isInteger(Number(query?.offset)) ? Number(query.offset) : null;
  let clause = "";
  if (limit !== null) clause += ` LIMIT ${limit}`;
  if (offset !== null) clause += ` OFFSET ${offset}`;
  return clause;
}
