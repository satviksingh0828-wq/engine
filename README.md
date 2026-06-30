# SupaForge

A full-featured, drop-in Supabase alternative that uses GitHub as encrypted storage. Deploy to Vercel in minutes — no Postgres, no servers, no extra infra.

## Features

- **Supabase-compatible REST API** — `/rest/v1/table` with the same filter syntax (`eq`, `neq`, `gt`, `like`, etc.)
- **Auth API** — JWT sign-up / sign-in / refresh at `/auth/v1/` — works with `supabase-js` out of the box
- **File Storage** — Bucket-based file storage at `/storage/v1/` backed by GitHub
- **Table Editor** — Visual data browser with insert / edit / delete rows
- **SQL Editor** — Run raw SQL against your tables with history
- **Row-Level Policies** — Per-table role-based access control
- **AES-256-GCM Encryption** — Auth users and storage metadata encrypted at rest
- **Audit Logs** — Every API call tracked in memory
- **Supabase Dashboard UI** — Identical look and feel

## Drop-in replacement

```js
import { createClient } from '@supabase/supabase-js'

// Just swap the URL — everything else is identical
const supabase = createClient('https://your-project.vercel.app', 'YOUR_API_KEY')

const { data } = await supabase.from('users').select('*').limit(10)
const { data } = await supabase.auth.signInWithPassword({ email, password })
await supabase.storage.from('bucket').upload('file.txt', blob)
```

## Deploy to Vercel

1. Push this repo to GitHub
2. Import into [Vercel](https://vercel.com/new)
3. Add environment variables (see below)
4. Done — your SupaForge instance is live

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `GITHUB_TOKEN` | GitHub PAT with `repo` scope | ✅ |
| `GITHUB_OWNER` | GitHub username or org | ✅ |
| `GITHUB_REPO` | Repository name for storage | ✅ |
| `GITHUB_BRANCH` | Branch to use (default: `main`) | — |
| `API_KEY` | Master admin API key | ✅ |
| `API_KEYS` | Scoped keys: `name:key:role,...` | — |
| `JWT_SECRET` | JWT signing secret | Recommended |
| `ENCRYPTION_KEY` | AES-256 encryption key | Recommended |
| `ENCRYPTION_SALT` | Key derivation salt | Recommended |

## API Reference

### REST — `/rest/v1/{table}`

```
GET    /rest/v1/users?select=*&limit=10
GET    /rest/v1/users?id=eq.1&name=like.Al*
POST   /rest/v1/users          body: { name, email }
PATCH  /rest/v1/users?id=eq.1  body: { name }
DELETE /rest/v1/users?id=eq.1
```

Headers: `x-api-key: KEY` or `Authorization: Bearer JWT`  
Set `Prefer: return=representation` to get inserted/updated rows back.

### Auth — `/auth/v1/`

```
POST /auth/v1/signup        { email, password }
POST /auth/v1/token?grant_type=password  { email, password }
POST /auth/v1/token?grant_type=refresh_token  { refresh_token }
GET  /auth/v1/user          (Bearer token)
PUT  /auth/v1/user          (Bearer token)
POST /auth/v1/logout
```

### Storage — `/storage/v1/`

```
GET    /api/storage/v1/buckets
POST   /api/storage/v1/buckets     { id, name, public }
DELETE /api/storage/v1/buckets?id=NAME
POST   /api/storage/v1/objects     { bucket, path, data: base64, encoding: "base64" }
GET    /api/storage/v1/objects/:bucket/:path
DELETE /api/storage/v1/objects/:bucket/:path
```

## Local development (Replit)

```
node server.js
```

Open `http://localhost:5000` — the dashboard works the same as Vercel.
