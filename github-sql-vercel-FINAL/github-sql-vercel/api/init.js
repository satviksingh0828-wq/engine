// api/init.js  (Vercel serverless function)
// Manually trigger repo creation/bootstrap, and check setup status.
// Useful right after deploying, to confirm everything connected correctly
// before you start sending SQL.

import { ensureRepoBootstrapped, listTables } from "../lib/github.js";

export default async function handler(req, res) {
  try {
    await ensureRepoBootstrapped();
    const tables = await listTables();
    return res.status(200).json({
      success: true,
      message: "Repo is created and bootstrapped.",
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      tableCount: Object.keys(tables).length,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: err.message,
      hint:
        "Common causes: GITHUB_TOKEN missing repo-creation permission, GITHUB_OWNER/GITHUB_REPO not set, or repo name already taken by someone else.",
    });
  }
}
