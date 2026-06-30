export const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function isValidIdentifier(value) {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

export function assertIdentifier(value, label = "Identifier") {
  if (!isValidIdentifier(value)) {
    throw new Error(`${label} must start with a letter or underscore and contain only letters, numbers, and underscores.`);
  }
  return value;
}

export function validateColumns(columns, allowedColumns = null) {
  const allowed = Array.isArray(allowedColumns) ? new Set(allowedColumns) : null;
  return columns.map((column) => {
    assertIdentifier(column, `Column '${column}'`);
    if (allowed && !allowed.has(column)) {
      throw new Error(`Column '${column}' does not exist in this table schema.`);
    }
    return column;
  });
}
