import { requireAdmin } from "../../lib/auth.js";
import { ensureRepoBootstrapped, listTables } from "../../lib/github.js";
import { bufferedWriteSettings, listBufferedOperations } from "../../lib/tableStore.js";

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: { code: "method_not_allowed", message: "Method not allowed" } });

  try {
    await ensureRepoBootstrapped();
    const tables = await listTables();
    return res.status(200).json({
      status: "ok",
      storage: "github-sqlite",
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      branch: process.env.GITHUB_BRANCH || "main",
      tableCount: Object.keys(tables).length,
      limits: { maxRestLimit: 500, rateLimitPerMinute: 120 },
      bufferedWrites: bufferedWriteSettings(),
      pendingOperations: listBufferedOperations().filter((operation) => operation.dirty).length,
    });
  } catch (err) {
    return res.status(500).json({ error: { code: "health_failed", message: err.message } });
  }
}
