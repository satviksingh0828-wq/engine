# Self-Provisioning GitHub-SQL (Vercel)

Deploy this once, set 3 environment variables, and the app creates and configures
the GitHub repo itself on first use. You never touch the repo by hand.

## What "auto setup" actually does

On the first request (or when you hit `/api/init` manually), the app:
1. Checks whether `GITHUB_REPO` exists under `GITHUB_OWNER`. If not, creates it as
   **private**.
2. Adds a `tables/` folder (where each table's SQLite file will live).
3. Adds `meta/_schema.json` — a registry tracking every table you create and its
   columns, so the app always knows what exists without scanning the whole repo.
4. Adds a README inside the data repo itself, noting it's machine-managed.

After that, every `CREATE TABLE` you send creates a new file in `tables/` and
registers it in the schema file automatically.

## Setup

1. **Deploy this project to Vercel** (`vercel deploy`, or connect the repo in the
   Vercel dashboard).

2. **Create a GitHub token.** This part matters: creating a brand-new repo requires
   more than the fine-grained "Contents" permission used elsewhere in this app.
   Use ONE of:
   - A **classic PAT** with the `repo` scope (simplest, works for personal accounts).
   - A **fine-grained PAT** with account-level `Administration: write` permission
     (needed specifically to create new repos), plus `Contents: write` on
     "All repositories" so it can also write to the one it just created.

3. **Set environment variables in Vercel** (Project → Settings → Environment Variables):
   - `GITHUB_TOKEN` — token from step 2
   - `GITHUB_OWNER` — your GitHub username or org
   - `GITHUB_REPO` — the repo name you want (it does NOT need to exist yet — leave
     it "blank" in the sense of unused/new, the app creates it)
   - `GITHUB_BRANCH` — optional, defaults to `main`
   - `API_KEY` — **required.** Make up any secret string. Every API route (and the
     dashboard itself) is locked behind this — without it you'll get
     `500: Server misconfigured: API_KEY env var is not set.` on every request and
     the dashboard will never load past the "Enter API Key" screen.

4. **Redeploy** after adding env vars (Vercel requires a redeploy to pick them up).

5. **Verify setup**: call `https://your-project.vercel.app/api/init` with header
   `x-api-key: <the API_KEY value you set>` (e.g. `curl -H "x-api-key: yourkey"
   https://your-project.vercel.app/api/init`). You should see `{ "success": true, ... }`.
   If it fails, the error message tells you which part to fix (usually token
   permissions).

6. **Open the dashboard** at `https://your-project.vercel.app/`. When prompted,
   enter the same `API_KEY` value — it's stored in your browser's local storage
   and sent as the `x-api-key` header on every request.

## Using it

```
POST /api/query
{ "sql": "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)" }

POST /api/query
{ "sql": "INSERT INTO users (name, email) VALUES ('Asha', 'asha@example.com')" }

POST /api/query
{ "sql": "SELECT * FROM users" }

GET /api/query
-> { "tables": { "users": { "columns": [...], "createdAt": "..." } } }
```

## What's "advanced and proper" about this version vs. the basic one

- **Auto-provisioning**: no manual repo setup — just env vars and deploy.
- **Schema registry**: `meta/_schema.json` tracks every table and its columns
  centrally, instead of relying on directory listing (which breaks on empty repos).
- **Retry with backoff**: concurrent writes to the same table no longer fail
  outright — the app retries automatically if GitHub rejects a stale commit.
- **Basic SQL hardening**: rejects stacked statements (`DROP TABLE x; SELECT...`)
  and validates table names against a strict pattern.

## Still true regardless of version (read this)

- **No cross-table joins** — each table is a separate SQLite file. Combine tables
  into one shared file if you need joins.
- **Round-trip latency** to GitHub's API on every call (roughly 200–500ms).
- **Not built for high concurrent write volume** — retries help with occasional
  collisions, not sustained heavy traffic. For that, use a real hosted database
  (Postgres via Neon/Supabase/Vercel Postgres).
- **This is not production-hardened SQL injection protection** — it blocks the
  obvious stacked-statement attack but is not a substitute for parameterized
  queries or a real SQL parser/validator. Don't expose this endpoint directly to
  untrusted public users without adding an auth layer (API key, JWT, etc.) in front.
- **Repo size target**: keep total size under ~2GB as planned — comfortably inside
  GitHub's recommended limits for many SQLite tables of structured data.
