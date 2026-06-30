export const DEFAULT_POLICIES = {
  select: { roles: ["admin", "service", "anon"] },
  insert: { roles: ["admin", "service"] },
  update: { roles: ["admin", "service"] },
  delete: { roles: ["admin", "service"] },
};

export function resolveRole(req) {
  const role = req.headers["x-engine-role"] || "service";
  return ["admin", "service", "anon"].includes(role) ? role : "anon";
}

export function canRunPolicy(schema, table, operation, role) {
  const policies = schema?.tables?.[table]?.policies || DEFAULT_POLICIES;
  const policy = policies[operation] || DEFAULT_POLICIES[operation];
  return policy?.roles?.includes(role);
}

export function ensurePolicy(schema, table, operation, role) {
  if (!canRunPolicy(schema, table, operation, role)) {
    throw new Error(`Role '${role}' is not allowed to ${operation} rows in '${table}'.`);
  }
}
