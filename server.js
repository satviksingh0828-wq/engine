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

let catchAll;
async function getHandler() {
  if (!catchAll) {
    const mod = await import("./api/[...all].js");
    catchAll = mod.default;
  }
  return catchAll;
}

const API_PREFIXES = ["/auth/v1", "/rest/v1", "/storage/v1", "/api"];

app.all("*", async (req, res, next) => {
  const url = req.url.split("?")[0];

  let apiPath = null;
  if (url.startsWith("/api/")) {
    apiPath = url.slice(5);
  } else if (url.startsWith("/auth/v1/")) {
    apiPath = "auth/v1/" + url.slice(9);
  } else if (url.startsWith("/rest/v1/")) {
    apiPath = "rest/v1/" + url.slice(9);
  } else if (url.startsWith("/storage/v1/")) {
    apiPath = "storage/v1/" + url.slice(12);
  }

  if (apiPath !== null) {
    req.query.all = apiPath.split("/").filter(Boolean);
    try {
      const handler = await getHandler();
      return await handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
    return;
  }

  next();
});

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
