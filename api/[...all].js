import { createUser, authenticateUser, getUserById, updateUser, deleteUser, listUsers } from "../lib/authUsers.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken, getUserFromRequest } from "../lib/jwt.js";
import { checkApiKey, requireAdmin } from "../lib/auth.js";
import { listBuckets, createBucket, getBucket, updateBucket, deleteBucket, uploadObject, downloadObject, deleteObject, listObjects } from "../lib/storageBuckets.js";
import { getSqlEngine } from "../lib/sqlEngine.js";
import { ensureRepoBootstrapped, getTableFile, saveTableFile, deleteTableFile, registerTable, unregisterTable, listTables, getSchema, updateTablePolicies } from "../lib/github.js";
import { parseFilters, parseOrder, parseLimitOffset } from "../lib/filters.js";
import { assertIdentifier, validateColumns } from "../lib/validators.js";
import { ensurePolicy } from "../lib/policies.js";
import { recordAuditEvent, listAuditEvents } from "../lib/audit.js";
import { parseStatement } from "../lib/parseSql.js";

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) return req.body;
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

function isAuthedUser(req) {
  const user = getUserFromRequest(req);
  if (user) return true;
  const k = req.headers["x-api-key"] || req.headers["apikey"];
  if (!k) return false;
  const keys = (process.env.API_KEY ? [process.env.API_KEY] : []).concat(
    (process.env.API_KEYS || "").split(",").map((x) => x.split(":")[1]).filter(Boolean)
  );
  return keys.includes(k);
}

async function handleAuthSignup(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });
  const { email, password, data: metadata = {} } = req.body || {};
  if (!email || !password) return res.status(422).json({ error: { message: "Email and password are required." } });
  if (password.length < 6) return res.status(422).json({ error: { message: "Password must be at least 6 characters." } });
  try {
    const user = await createUser({ email, password, metadata });
    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = signRefreshToken({ sub: user.id });
    return res.status(200).json({ access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refreshToken, user });
  } catch (err) {
    return res.status(err.status || 400).json({ error: { message: err.message, code: err.code } });
  }
}

async function handleAuthToken(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });
  const grantType = req.query.grant_type || req.body?.grant_type;
  if (grantType === "password") {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: { message: "email and password are required" } });
    try {
      const user = await authenticateUser(email, password);
      const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
      const refreshToken = signRefreshToken({ sub: user.id });
      return res.status(200).json({ access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refreshToken, user });
    } catch (err) {
      return res.status(err.status || 400).json({ error: { message: err.message, code: err.code } });
    }
  }
  if (grantType === "refresh_token") {
    const { refresh_token } = req.body || {};
    const payload = verifyRefreshToken(refresh_token);
    if (!payload) return res.status(401).json({ error: { message: "Invalid refresh token" } });
    const accessToken = signAccessToken({ sub: payload.sub, role: "authenticated" });
    const newRefresh = signRefreshToken({ sub: payload.sub });
    return res.status(200).json({ access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: newRefresh });
  }
  return res.status(400).json({ error: { message: `Unsupported grant_type: ${grantType}` } });
}

async function handleAuthUser(req, res) {
  const payload = getUserFromRequest(req);
  if (!payload) return res.status(401).json({ error: { message: "Not authenticated" } });
  if (req.method === "GET") {
    const user = await getUserById(payload.sub);
    if (!user) return res.status(404).json({ error: { message: "User not found" } });
    return res.status(200).json(user);
  }
  if (req.method === "PUT") {
    const user = await updateUser(payload.sub, req.body || {});
    return res.status(200).json(user);
  }
  return res.status(405).json({ error: { message: "Method not allowed" } });
}

async function handleAdminUsers(req, res) {
  if (!checkApiKey(req, res)) return;
  const id = req.query.id;
  if (req.method === "GET" && !id) {
    const result = await listUsers({ page: Number(req.query.page) || 1, perPage: Number(req.query.per_page) || 50 });
    return res.status(200).json(result);
  }
  if (req.method === "GET" && id) {
    const user = await getUserById(id);
    if (!user) return res.status(404).json({ error: { message: "User not found" } });
    return res.status(200).json(user);
  }
  if (req.method === "POST") {
    try {
      const { email, password, role, user_metadata } = req.body || {};
      const user = await createUser({ email, password, role, metadata: user_metadata });
      return res.status(201).json(user);
    } catch (err) {
      return res.status(err.status || 400).json({ error: { message: err.message } });
    }
  }
  if (req.method === "PUT" && id) {
    const user = await updateUser(id, req.body || {});
    return res.status(200).json(user);
  }
  if (req.method === "DELETE" && id) {
    await deleteUser(id);
    return res.status(200).json({ message: "User deleted" });
  }
  return res.status(405).json({ error: { message: "Method not allowed" } });
}

async function handleBuckets(req, res) {
  if (!checkApiKey(req, res)) return;
  const id = req.query.id;
  if (req.method === "GET" && !id) return res.status(200).json(await listBuckets());
  if (req.method === "GET" && id) {
    const bucket = await getBucket(id);
    if (!bucket) return res.status(404).json({ error: "Bucket not found" });
    return res.status(200).json(bucket);
  }
  if (req.method === "POST") {
    const { id: bucketId, name, public: isPublic } = req.body || {};
    if (!bucketId) return res.status(400).json({ error: "id is required" });
    try {
      const bucket = await createBucket({ id: bucketId, name, public: isPublic });
      return res.status(200).json({ name: bucket.id });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }
  if (req.method === "PUT" && id) {
    await updateBucket(id, req.body || {});
    return res.status(200).json({ message: "Successfully updated" });
  }
  if (req.method === "DELETE" && id) {
    try {
      await deleteBucket(id);
      return res.status(200).json({ message: "Successfully deleted" });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }
  return res.status(405).json({ error: "Method not allowed" });
}

async function handleObjects(req, res, pathSegments) {
  if (!isAuthedUser(req)) return res.status(401).json({ error: "Unauthorized" });
  const url = req.url || "";
  const isListRequest = req.query?.list || url.includes("/list/");
  if (isListRequest) {
    const bucket = req.query?.bucket || pathSegments[0];
    if (!bucket) return res.status(400).json({ error: "bucket is required" });
    const { prefix, limit, offset } = req.body || req.query || {};
    return res.status(200).json(await listObjects(bucket, { prefix: prefix || "", limit: Number(limit) || 100, offset: Number(offset) || 0 }));
  }
  if (req.method === "POST" || req.method === "PUT") {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const bucket = body?.bucket || pathSegments[0];
    const filePath = body?.path || pathSegments.slice(1).join("/");
    if (!bucket) return res.status(400).json({ error: "bucket is required" });
    if (!filePath) return res.status(400).json({ error: "path is required" });
    let fileBuffer;
    if (body?.data) {
      fileBuffer = Buffer.from(body.data, body.encoding || "base64");
    } else if (Buffer.isBuffer(req.body)) {
      fileBuffer = req.body;
    } else {
      const chunks = [];
      await new Promise((resolve, reject) => { req.on("data", (c) => chunks.push(c)); req.on("end", resolve); req.on("error", reject); });
      fileBuffer = Buffer.concat(chunks);
    }
    const result = await uploadObject(bucket, filePath, fileBuffer, { contentType: req.headers["content-type"] || "application/octet-stream" });
    return res.status(200).json({ Key: result.Key, Id: result.Id });
  }
  if (req.method === "GET") {
    const bucket = pathSegments[0]; const filePath = pathSegments.slice(1).join("/");
    if (!bucket || !filePath) return res.status(400).json({ error: "bucket and path are required" });
    try {
      const buffer = await downloadObject(bucket, filePath);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${filePath.split("/").pop()}"`);
      return res.status(200).send(buffer);
    } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
  }
  if (req.method === "DELETE") {
    const bucket = pathSegments[0]; const filePath = pathSegments.slice(1).join("/");
    if (!bucket || !filePath) return res.status(400).json({ error: "bucket and path required" });
    try { await deleteObject(bucket, filePath); return res.status(200).json({ message: "Successfully deleted" }); }
    catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
  }
  return res.status(405).json({ error: "Method not allowed" });
}

async function handleRest(req, res) {
  if (!isAuthedUser(req)) {
    return res.status(401).json({ message: "JWT is missing or invalid", hint: "Check apikey or Authorization header", code: "PGRST301" });
  }
  const table = req.query.table;
  if (!table || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) return res.status(400).json({ message: "Invalid table name", code: "PGRST100" });
  const prefer = req.headers["prefer"] || "";
  const returning = prefer.includes("return=representation");
  const { schema } = await getSchema();
  const schemaColumns = schema.tables?.[table]?.columns || null;
  try {
    const SQLEngine = await getSqlEngine();
    const { buffer, sha } = await getTableFile(table);
    if (!buffer) return res.status(404).json({ message: `Table '${table}' does not exist`, code: "42P01" });
    const db = new SQLEngine.Database(buffer);
    if (req.method === "GET") {
      const { whereClause, params } = parseFilters(req.query, schemaColumns);
      const order = parseOrder(req.query, schemaColumns);
      const limitOffset = parseLimitOffset(req.query);
      const safeCols = (req.query.select || "*") === "*" ? "*" : req.query.select.split(",").map((c) => c.trim()).join(", ");
      const stmt = db.prepare(`SELECT ${safeCols} FROM ${table} ${whereClause} ${order}${limitOffset}`);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      const countResult = db.exec(`SELECT COUNT(*) as c FROM ${table} ${whereClause}`, params);
      const total = countResult[0]?.values[0][0] ?? rows.length;
      db.close();
      res.setHeader("Content-Range", `0-${rows.length - 1}/${total}`);
      return res.status(200).json(rows);
    }
    if (req.method === "POST") {
      const body = Array.isArray(req.body) ? req.body : [req.body];
      const inserted = [];
      for (const item of body) {
        const columns = schemaColumns ? validateColumns(Object.keys(item), schemaColumns) : Object.keys(item).filter((k) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
        if (!columns.length) continue;
        db.run(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((c) => item[c]));
        const id = db.exec("SELECT last_insert_rowid() AS id")[0]?.values?.[0]?.[0];
        if (returning) inserted.push({ id, ...item });
      }
      const newBuffer = Buffer.from(db.export()); db.close();
      await saveTableFile(table, newBuffer, sha, `REST insert into ${table}`);
      if (returning) return res.status(201).json(inserted.length === 1 ? inserted[0] : inserted);
      return res.status(204).end();
    }
    if (req.method === "PATCH") {
      const { whereClause, params: filterParams } = parseFilters(req.query, schemaColumns);
      if (!whereClause) { db.close(); return res.status(400).json({ message: "PATCH requires at least one filter", code: "PGRST105" }); }
      const body = req.body || {};
      const columns = Object.keys(body).filter((k) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
      if (!columns.length) { db.close(); return res.status(400).json({ message: "Body is empty" }); }
      db.run(`UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(", ")} ${whereClause}`, [...columns.map((c) => body[c]), ...filterParams]);
      let updated = [];
      if (returning) {
        const stmt = db.prepare(`SELECT * FROM ${table} ${whereClause}`); stmt.bind(filterParams);
        while (stmt.step()) updated.push(stmt.getAsObject()); stmt.free();
      }
      const newBuffer = Buffer.from(db.export()); db.close();
      await saveTableFile(table, newBuffer, sha, `REST update ${table}`);
      if (returning) return res.status(200).json(updated);
      return res.status(204).end();
    }
    if (req.method === "DELETE") {
      const { whereClause, params: filterParams } = parseFilters(req.query, schemaColumns);
      if (!whereClause) { db.close(); return res.status(400).json({ message: "DELETE requires at least one filter", code: "PGRST105" }); }
      let deleted = [];
      if (returning) {
        const stmt = db.prepare(`SELECT * FROM ${table} ${whereClause}`); stmt.bind(filterParams);
        while (stmt.step()) deleted.push(stmt.getAsObject()); stmt.free();
      }
      db.run(`DELETE FROM ${table} ${whereClause}`, filterParams);
      const newBuffer = Buffer.from(db.export()); db.close();
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

async function handleTable(req, res) {
  if (!checkApiKey(req, res)) return;
  const table = req.query.table;
  try { assertIdentifier(table, "Table name"); }
  catch (err) { return res.status(400).json({ error: { code: "invalid_table", message: err.message } }); }
  try {
    const { schema } = await getSchema();
    const role = req.engineAuth?.role || "service";
    const schemaColumns = schema.tables?.[table]?.columns || null;
    const SQLEngine = await getSqlEngine();
    const { buffer, sha } = await getTableFile(table);
    if (!buffer) return res.status(404).json({ error: { code: "not_found", message: `Table '${table}' does not exist.` } });
    const db = new SQLEngine.Database(buffer);
    if (req.method === "GET") {
      ensurePolicy(schema, table, "select", role);
      const { whereClause, params } = parseFilters(req.query, schemaColumns);
      const stmt = db.prepare(`SELECT * FROM ${table} ${whereClause} ${parseOrder(req.query, schemaColumns)}${parseLimitOffset(req.query)}`);
      stmt.bind(params);
      const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); db.close();
      recordAuditEvent(req, { action: "select", table, status: "success", count: rows.length });
      return res.status(200).json({ data: rows, count: rows.length });
    }
    if (req.method === "POST") {
      ensurePolicy(schema, table, "insert", role);
      const body = req.body || {};
      const columns = validateColumns(Object.keys(body), schemaColumns);
      if (!columns.length) { db.close(); return res.status(400).json({ error: { code: "empty_body", message: "Request body must contain at least one column." } }); }
      db.run(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((c) => body[c]));
      const insertedId = db.exec("SELECT last_insert_rowid() AS id")[0]?.values?.[0]?.[0];
      const newBuffer = Buffer.from(db.export()); db.close();
      await saveTableFile(table, newBuffer, sha, `Insert row into ${table}`);
      recordAuditEvent(req, { action: "insert", table, status: "success" });
      return res.status(201).json({ data: { id: insertedId, ...body } });
    }
    if (req.method === "PUT") {
      ensurePolicy(schema, table, "update", role);
      const { whereClause, params: filterParams } = parseFilters(req.query, schemaColumns);
      if (!whereClause) { db.close(); return res.status(400).json({ error: { code: "missing_filter", message: "PUT requires at least one filter." } }); }
      const body = req.body || {};
      const columns = validateColumns(Object.keys(body), schemaColumns);
      if (!columns.length) { db.close(); return res.status(400).json({ error: { code: "empty_body", message: "Request body must contain at least one column." } }); }
      db.run(`UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(", ")} ${whereClause}`, [...columns.map((c) => body[c]), ...filterParams]);
      const newBuffer = Buffer.from(db.export()); db.close();
      await saveTableFile(table, newBuffer, sha, `Update rows in ${table}`);
      recordAuditEvent(req, { action: "update", table, status: "success" });
      return res.status(200).json({ success: true });
    }
    if (req.method === "DELETE") {
      ensurePolicy(schema, table, "delete", role);
      const { whereClause, params } = parseFilters(req.query, schemaColumns);
      if (!whereClause) { db.close(); return res.status(400).json({ error: { code: "missing_filter", message: "DELETE requires at least one filter." } }); }
      db.run(`DELETE FROM ${table} ${whereClause}`, params);
      const newBuffer = Buffer.from(db.export()); db.close();
      await saveTableFile(table, newBuffer, sha, `Delete rows from ${table}`);
      recordAuditEvent(req, { action: "delete", table, status: "success" });
      return res.status(200).json({ success: true });
    }
    db.close();
    return res.status(405).json({ error: { code: "method_not_allowed", message: "Method not allowed" } });
  } catch (err) {
    console.error(err);
    recordAuditEvent(req, { action: "table_request", table, status: "error", error: err.message });
    return res.status(500).json({ error: { code: "request_failed", message: err.message } });
  }
}

async function handleQuery(req, res) {
  if (!requireAdmin(req, res)) return;
  try { await ensureRepoBootstrapped(); }
  catch (err) { return res.status(500).json({ error: { code: "bootstrap_failed", message: err.message } }); }
  if (req.method === "GET") return res.status(200).json({ tables: await listTables() });
  if (req.method !== "POST") return res.status(405).json({ error: { code: "method_not_allowed", message: "Method not allowed" } });
  const { sql } = req.body || {};
  let statement;
  try { statement = parseStatement(sql); }
  catch (err) { return res.status(400).json({ error: { code: "invalid_sql", message: err.message } }); }
  const { type, table, columns } = statement;
  try {
    const { schema } = await getSchema();
    const role = req.engineAuth?.role || "service";
    const op = type === "READ" ? "select" : type === "CREATE" ? "insert" : type === "DROP" ? "delete" : "update";
    if (schema.tables?.[table]) ensurePolicy(schema, table, op, role);
    const { buffer, sha } = await getTableFile(table);
    if (!buffer && type !== "CREATE") return res.status(404).json({ error: { code: "not_found", message: `Table '${table}' does not exist.` } });
    if (type === "DROP") {
      await deleteTableFile(table, sha);
      await unregisterTable(table);
      recordAuditEvent(req, { action: "drop_table", table, status: "success" });
      return res.status(200).json({ type, table, success: true });
    }
    const SQLEngine = await getSqlEngine();
    const db = buffer ? new SQLEngine.Database(buffer) : new SQLEngine.Database();
    let rows = [];
    if (type === "READ") {
      const result = db.exec(statement.sql);
      rows = result.length ? result[0].values.map((row) => Object.fromEntries(row.map((val, i) => [result[0].columns[i], val]))) : [];
    } else {
      db.run(statement.sql);
    }
    if (type !== "READ") { const newBuffer = Buffer.from(db.export()); await saveTableFile(table, newBuffer, sha, `${type} on ${table}`); }
    if (type === "CREATE") await registerTable(table, columns);
    db.close();
    recordAuditEvent(req, { action: type.toLowerCase(), table, status: "success", count: rows.length });
    return res.status(200).json({ type, table, rows: type === "READ" ? rows : undefined, success: true });
  } catch (err) {
    console.error(err);
    recordAuditEvent(req, { action: type?.toLowerCase() || "query", table, status: "error", error: err.message });
    return res.status(500).json({ error: { code: "query_failed", message: err.message } });
  }
}

export default async function handler(req, res) {
  req.body = await readBody(req);

  const segments = req.query.all || [];
  const path = (Array.isArray(segments) ? segments : [segments]).filter(Boolean);

  try {
    // Auth routes
    if (path[0] === "auth" && path[1] === "v1") {
      const sub = path[2];
      if (sub === "signup") return await handleAuthSignup(req, res);
      if (sub === "token") return await handleAuthToken(req, res);
      if (sub === "logout") {
        if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });
        if (!getUserFromRequest(req)) return res.status(401).json({ error: { message: "Not authenticated" } });
        return res.status(204).end();
      }
      if (sub === "user") return await handleAuthUser(req, res);
      if (sub === "admin" && path[3] === "users") return await handleAdminUsers(req, res);
      return res.status(404).json({ error: "Auth route not found" });
    }

    // Storage routes
    if (path[0] === "storage" && path[1] === "v1") {
      const sub = path[2];
      if (sub === "bucket" || sub === "buckets") return await handleBuckets(req, res);
      if (sub === "object" || sub === "objects") return await handleObjects(req, res, path.slice(3));
      return res.status(404).json({ error: "Storage route not found" });
    }

    // REST / PostgREST routes
    if (path[0] === "rest" && path[1] === "v1") {
      req.query.table = path[2];
      return await handleRest(req, res);
    }

    // Table CRUD (internal)
    if (path[0] === "tables") {
      if (!path[1]) {
        if (!checkApiKey(req, res)) return;
        if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
        return res.status(200).json({ tables: await listTables() });
      }
      req.query.table = path[1];
      return await handleTable(req, res);
    }

    // Admin routes
    if (path[0] === "admin") {
      const sub = path[1];
      if (sub === "audit") {
        if (!requireAdmin(req, res)) return;
        if (req.method !== "GET") return res.status(405).json({ error: { message: "Method not allowed" } });
        return res.status(200).json({ events: listAuditEvents(req.query?.limit) });
      }
      if (sub === "health") {
        if (!requireAdmin(req, res)) return;
        if (req.method !== "GET") return res.status(405).json({ error: { message: "Method not allowed" } });
        try {
          await ensureRepoBootstrapped();
          const tables = await listTables();
          return res.status(200).json({ status: "ok", storage: "github-sqlite", owner: process.env.GITHUB_OWNER, repo: process.env.GITHUB_REPO, branch: process.env.GITHUB_BRANCH || "main", tableCount: Object.keys(tables).length, limits: { maxRestLimit: 500, rateLimitPerMinute: 120 } });
        } catch (err) { return res.status(500).json({ error: { code: "health_failed", message: err.message } }); }
      }
      if (sub === "policies") {
        if (!requireAdmin(req, res)) return;
        if (req.method === "GET") {
          const { schema } = await getSchema();
          return res.status(200).json({ tables: schema.tables || {} });
        }
        if (req.method === "PUT") {
          try {
            const { table, policies } = req.body || {};
            assertIdentifier(table, "Table name");
            const OPS = ["select", "insert", "update", "delete"];
            const ROLES = ["admin", "service", "anon"];
            const normalized = {};
            for (const op of OPS) {
              const roles = Array.isArray(policies?.[op]?.roles) ? policies[op].roles : [];
              normalized[op] = { roles: roles.filter((r) => ROLES.includes(r)) };
            }
            const updated = await updateTablePolicies(table, normalized);
            return res.status(200).json({ table, schema: updated });
          } catch (err) { return res.status(400).json({ error: { code: "policy_update_failed", message: err.message } }); }
        }
        return res.status(405).json({ error: { message: "Method not allowed" } });
      }
      return res.status(404).json({ error: "Admin route not found" });
    }

    // Init
    if (path[0] === "init") {
      if (!checkApiKey(req, res)) return;
      try {
        await ensureRepoBootstrapped();
        const tables = await listTables();
        return res.status(200).json({ success: true, message: "Repo is created and bootstrapped.", owner: process.env.GITHUB_OWNER, repo: process.env.GITHUB_REPO, tableCount: Object.keys(tables).length });
      } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    }

    // SQL query
    if (path[0] === "query") return await handleQuery(req, res);

    return res.status(404).json({ error: "Not found", path });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
