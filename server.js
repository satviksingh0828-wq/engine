import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, apikey, Prefer, Range, x-engine-role, x-bucket, x-path");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, X-Total-Count");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.use((req, res, next) => {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("application/json")) {
    express.json({ limit: "50mb" })(req, res, next);
  } else if (ct.includes("application/x-www-form-urlencoded")) {
    express.urlencoded({ extended: true, limit: "50mb" })(req, res, next);
  } else {
    express.raw({ type: "*/*", limit: "50mb" })(req, res, next);
  }
});

function wrap(importFn) {
  return async (req, res) => {
    try {
      const mod = await importFn();
      await mod.default(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  };
}

app.use(["/api/rest/v1/:table", "/rest/v1/:table"], (req, res, next) => {
  req.query.table = req.params.table;
  next();
}, wrap(() => import("./api/rest/v1/[table].js")));

app.post(["/api/auth/v1/signup", "/auth/v1/signup"], wrap(() => import("./api/auth/v1/signup.js")));
app.post(["/api/auth/v1/token", "/auth/v1/token"], wrap(() => import("./api/auth/v1/token.js")));
app.post(["/api/auth/v1/logout", "/auth/v1/logout"], wrap(() => import("./api/auth/v1/logout.js")));
app.get(["/api/auth/v1/user", "/auth/v1/user"], wrap(() => import("./api/auth/v1/user.js")));
app.put(["/api/auth/v1/user", "/auth/v1/user"], wrap(() => import("./api/auth/v1/user.js")));
app.all("/api/auth/v1/admin/users", wrap(() => import("./api/auth/v1/admin/users.js")));

app.all(["/api/storage/v1/buckets", "/api/storage/v1/buckets/:id", "/storage/v1/bucket", "/storage/v1/bucket/:id"],
  (req, res, next) => {
    if (req.params.id) req.query.id = req.params.id;
    next();
  }, wrap(() => import("./api/storage/v1/buckets.js"))
);

app.all([
  "/api/storage/v1/objects",
  "/api/storage/v1/objects/:bucket",
  "/api/storage/v1/objects/:bucket/*",
  "/storage/v1/object/:bucket/*",
], (req, res, next) => {
  const wildcard = req.params[0];
  if (req.params.bucket) req.params.bucket = req.params.bucket;
  if (wildcard) req.params.path = wildcard;
  next();
}, wrap(() => import("./api/storage/v1/objects.js")));

app.get("/api/admin/health", wrap(() => import("./api/admin/health.js")));
app.all("/api/admin/policies", wrap(() => import("./api/admin/policies.js")));
app.get("/api/admin/audit", wrap(() => import("./api/admin/audit.js")));
app.get("/api/tables", wrap(() => import("./api/tables/index.js")));
app.all("/api/tables/:table", (req, res, next) => {
  req.query.table = req.params.table;
  next();
}, wrap(() => import("./api/tables/[table].js")));
app.get("/api/init", wrap(() => import("./api/init.js")));
app.post("/api/query", wrap(() => import("./api/query.js")));

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🟢 SupaForge running on http://0.0.0.0:${PORT}`);
  console.log(`   Dashboard : http://0.0.0.0:${PORT}/`);
  console.log(`   REST API  : http://0.0.0.0:${PORT}/rest/v1/{table}`);
  console.log(`   Auth API  : http://0.0.0.0:${PORT}/auth/v1/`);
  console.log(`   Storage   : http://0.0.0.0:${PORT}/storage/v1/`);
  console.log(`\n   Vercel-ready: deploy this repo to Vercel as-is\n`);
});
