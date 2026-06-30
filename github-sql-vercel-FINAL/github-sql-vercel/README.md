# Engine — GitHub SQLite backend with dashboard

Engine is a self-provisioning Vercel API that stores each table as a SQLite file in a private GitHub repo. It now includes a console dashboard, safer table APIs, scoped keys, rate limiting, audit logs, admin health checks, and table policy metadata.

> Engine is not a full Supabase replacement yet. It is a compact GitHub-backed backend for prototypes and small apps. For high write volume, joins, realtime, or large datasets, add a Postgres storage adapter.

## Setup

1. Deploy this project to Vercel.
2. Create a GitHub token with repo creation and contents write permission.
3. Set environment variables:
   - `GITHUB_TOKEN`
   - `GITHUB_OWNER`
   - `GITHUB_REPO`
   - `GITHUB_BRANCH` optional, defaults to `main`
   - `API_KEY` required for legacy admin/service access
   - `API_KEYS` optional comma-separated scoped keys: `name:key:role`
4. Redeploy after adding environment variables.
5. Open `/` and enter the API key in the Engine Console.

## Windows CMD examples

Replace `https://your-project.vercel.app` with your deployment URL.

```cmd
curl -H "x-api-key: Testplay" https://your-project.vercel.app/api/init
```

```cmd
curl -X POST https://your-project.vercel.app/api/query ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: Testplay" ^
  -d "{\"sql\":\"CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT)\"}"
```

```cmd
curl -X POST https://your-project.vercel.app/api/tables/users ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: Testplay" ^
  -d "{\"name\":\"Asha\",\"email\":\"asha@example.com\"}"
```

```cmd
curl -H "x-api-key: Testplay" "https://your-project.vercel.app/api/tables/users?order=id.desc&limit=10"
```

```cmd
curl -X PUT "https://your-project.vercel.app/api/tables/users?id=eq.1" ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: Testplay" ^
  -d "{\"name\":\"Updated Asha\"}"
```

```cmd
curl -X DELETE "https://your-project.vercel.app/api/tables/users?id=eq.1" ^
  -H "x-api-key: Testplay"
```

## API surface

- `GET /api/init` bootstraps the GitHub storage repo.
- `GET /api/admin/health` returns storage health and limits.
- `GET /api/admin/audit` returns recent in-memory audit events.
- `GET /api/admin/operations` returns pending buffered GitHub writes.
- `POST /api/admin/operations` flushes one table immediately.
- `GET /api/admin/policies` lists table policies.
- `PUT /api/admin/policies` updates table role policies.
- `GET /api/tables` lists schema registry tables.
- `GET /api/tables/:table` reads rows with filters.
- `POST /api/tables/:table` inserts a row.
- `PUT /api/tables/:table` updates rows with required filters.
- `DELETE /api/tables/:table` deletes rows with required filters.
- `POST /api/query` runs admin-only single-statement SQL.

## GitHub API optimization

REST row writes are buffered by default to protect GitHub PAT/API limits. When several inserts, updates, or deletes hit the same table in a short window, Engine updates the in-memory SQLite buffer immediately, returns to the user immediately, and flushes the latest table snapshot to GitHub as one commit after `ENGINE_WRITE_FLUSH_MS` milliseconds. Reads on the same server instance use the pending buffer, so the dashboard feels instant while GitHub receives fewer writes.

Configuration:

- `ENGINE_BUFFERED_WRITES=true` enables buffered writes. Set `false` for strict synchronous commits.
- `ENGINE_WRITE_FLUSH_MS=1000` controls the coalescing window.
- `ENGINE_SCHEMA_CACHE_MS=30000` caches schema metadata briefly to reduce GitHub reads.

Admin visibility:

```cmd
curl -H "x-api-key: Testplay" https://your-project.vercel.app/api/admin/operations
```

Force a table flush:

```cmd
curl -X POST https://your-project.vercel.app/api/admin/operations ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: Testplay" ^
  -d "{\"table\":\"users\"}"
```

## Security and platform improvements included

- API keys can be configured as scoped records via `API_KEYS=name:key:role`.
- Requests are rate-limited per key/IP in memory.
- Dynamic table and column identifiers are validated before SQL construction.
- REST writes validate request body columns against schema metadata when available.
- Raw SQL is admin/service-only.
- Table policies are stored in schema metadata and enforced by REST and SQL paths.
- `DROP TABLE` now deletes the table file and unregisters schema metadata.
- Audit events are recorded for table operations and exposed through an admin endpoint.
- Buffered REST writes coalesce multiple quick row mutations into fewer GitHub commits.
- The dashboard includes overview, data editor, SQL editor, operations, policies, audit logs, and API docs.

## Limitations

- GitHub-backed SQLite is not suited for high concurrent writes.
- Each logical table is a separate SQLite file, so cross-table joins are intentionally unsupported.
- Audit, rate-limit, table-cache, and buffered-operation state are in-memory per serverless instance.
- Password login, OAuth, realtime subscriptions, storage buckets, billing, and Postgres storage are architectural next steps.
