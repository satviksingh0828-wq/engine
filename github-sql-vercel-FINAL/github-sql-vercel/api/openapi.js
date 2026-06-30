import { checkApiKey } from "../lib/auth.js";

function serverUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "your-project.vercel.app";
  return `${proto}://${host}`;
}

export default function handler(req, res) {
  if (!checkApiKey(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: { code: "method_not_allowed", message: "Method not allowed" } });

  const base = serverUrl(req);
  return res.status(200).json({
    openapi: "3.1.0",
    info: {
      title: "Engine API",
      version: "3.0.0",
      description: "Supabase-inspired GitHub SQLite API with table REST, PostgREST-compatible aliases, SQL admin endpoint, policies, buffered operations, and audit logs.",
    },
    servers: [{ url: base }],
    components: {
      securitySchemes: {
        ApiKeyHeader: { type: "apiKey", in: "header", name: "x-api-key" },
        SupabaseApiKey: { type: "apiKey", in: "header", name: "apikey" },
        BearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } },
        TableList: { type: "object", properties: { tables: { type: "object" } } },
        Rows: { type: "object", properties: { data: { type: "array", items: { type: "object", additionalProperties: true } }, count: { type: "integer" } } },
      },
    },
    security: [{ ApiKeyHeader: [] }, { SupabaseApiKey: [] }, { BearerAuth: [] }],
    paths: {
      "/api/init": { get: { summary: "Bootstrap GitHub storage", responses: { 200: { description: "Storage is ready" } } } },
      "/api/auth/v1/user": { get: { summary: "Supabase-style current key/user metadata" } },
      "/api/tables": { get: { summary: "List tables", responses: { 200: { description: "Schema registry tables" } } } },
      "/api/tables/{table}": {
        get: { summary: "Select rows", parameters: [{ name: "table", in: "path", required: true, schema: { type: "string" } }, { name: "select", in: "query", schema: { type: "string", default: "*" } }, { name: "order", in: "query", schema: { type: "string", example: "id.desc" } }, { name: "limit", in: "query", schema: { type: "integer" } }], responses: { 200: { description: "Rows" } } },
        post: { summary: "Insert row", responses: { 201: { description: "Inserted row" } } },
        put: { summary: "Update rows by filter", responses: { 200: { description: "Updated" } } },
        delete: { summary: "Delete rows by filter", responses: { 200: { description: "Deleted" } } },
      },
      "/api/rest/v1/{table}": { get: { summary: "Supabase-style select alias" }, post: { summary: "Supabase-style insert alias" }, put: { summary: "Supabase-style update alias" }, delete: { summary: "Supabase-style delete alias" } },
      "/api/query": { post: { summary: "Admin SQL endpoint" } },
      "/api/admin/health": { get: { summary: "Admin health" } },
      "/api/admin/operations": { get: { summary: "Buffered operation status" }, post: { summary: "Flush a table" } },
      "/api/admin/policies": { get: { summary: "List policies" }, put: { summary: "Update policies" } },
      "/api/admin/audit": { get: { summary: "Recent audit events" } },
    },
  });
}
