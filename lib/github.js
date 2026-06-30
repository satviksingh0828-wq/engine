import { Octokit } from "@octokit/rest";
import { withRetry } from "./retry.js";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || "main";

function tablePath(tableName) {
  return `tables/${tableName}.db`;
}

async function repoExists() {
  try {
    await octokit.repos.get({ owner: OWNER, repo: REPO });
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

async function createRepo() {
  await octokit.repos.createForAuthenticatedUser({
    name: REPO,
    private: true,
    auto_init: true,
    description: "Auto-provisioned SQL storage repo (managed by Vercel app)",
  });
}

async function fileExists(path) {
  try {
    await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

async function createFile(path, contentString, message) {
  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER,
    repo: REPO,
    path,
    message,
    content: Buffer.from(contentString).toString("base64"),
    branch: BRANCH,
  });
}

let bootstrapped = false;

export async function ensureRepoBootstrapped() {
  if (bootstrapped) return;

  const exists = await repoExists();
  if (!exists) {
    await createRepo();
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!(await fileExists("tables/.gitkeep"))) {
    await createFile("tables/.gitkeep", "", "Bootstrap: create tables/ folder");
  }

  if (!(await fileExists("meta/_schema.json"))) {
    await createFile(
      "meta/_schema.json",
      JSON.stringify({ tables: {} }, null, 2),
      "Bootstrap: initialize schema registry"
    );
  }

  if (!(await fileExists("README.md"))) {
    await createFile(
      "README.md",
      `# Auto-provisioned SQL storage\n\nThis repo is managed automatically by a connected Vercel app.\nEach table lives in 'tables/<name>.db' as a real SQLite file.\nDo not edit files here by hand — use the app's API instead.\n`,
      "Bootstrap: add README"
    );
  }

  bootstrapped = true;
}

export async function getTableFile(tableName) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: tablePath(tableName),
      ref: BRANCH,
    });
    return { buffer: Buffer.from(data.content, "base64"), sha: data.sha };
  } catch (err) {
    if (err.status === 404) return { buffer: null, sha: null };
    throw err;
  }
}

export async function saveTableFile(tableName, buffer, sha, commitMessage) {
  return withRetry(() =>
    octokit.repos.createOrUpdateFileContents({
      owner: OWNER,
      repo: REPO,
      path: tablePath(tableName),
      message: commitMessage || `Update table ${tableName}`,
      content: buffer.toString("base64"),
      branch: BRANCH,
      sha: sha || undefined,
    })
  );
}

export async function deleteTableFile(tableName, sha) {
  const current = sha || (await getTableFile(tableName)).sha;
  if (!current) return null;
  return withRetry(() =>
    octokit.repos.deleteFile({
      owner: OWNER,
      repo: REPO,
      path: tablePath(tableName),
      message: `Delete table ${tableName}`,
      branch: BRANCH,
      sha: current,
    })
  );
}

export async function getSchema() {
  try {
    const { data } = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: "meta/_schema.json",
      ref: BRANCH,
    });
    return {
      schema: JSON.parse(Buffer.from(data.content, "base64").toString("utf-8")),
      sha: data.sha,
    };
  } catch (err) {
    if (err.status === 404) {
      return { schema: { tables: {} }, sha: null };
    }
    throw err;
  }
}

export async function saveSchema(schemaObj, sha) {
  return withRetry(() =>
    octokit.repos.createOrUpdateFileContents({
      owner: OWNER,
      repo: REPO,
      path: "meta/_schema.json",
      message: "Update schema registry",
      content: Buffer.from(JSON.stringify(schemaObj, null, 2)).toString("base64"),
      branch: BRANCH,
      sha: sha || undefined,
    })
  );
}

export async function registerTable(tableName, columns) {
  const { schema, sha } = await getSchema();
  schema.tables[tableName] = {
    columns,
    policies: schema.tables[tableName]?.policies || {
      select: { roles: ["admin", "service", "anon"] },
      insert: { roles: ["admin", "service"] },
      update: { roles: ["admin", "service"] },
      delete: { roles: ["admin", "service"] },
    },
    createdAt: schema.tables[tableName]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveSchema(schema, sha);
}

export async function unregisterTable(tableName) {
  const { schema, sha } = await getSchema();
  delete schema.tables[tableName];
  await saveSchema(schema, sha);
}

export async function updateTablePolicies(tableName, policies) {
  const { schema, sha } = await getSchema();
  if (!schema.tables[tableName]) throw new Error(`Table '${tableName}' does not exist.`);
  schema.tables[tableName].policies = policies;
  schema.tables[tableName].updatedAt = new Date().toISOString();
  await saveSchema(schema, sha);
  return schema.tables[tableName];
}

export async function listTables() {
  try {
    const { schema } = await getSchema();
    return schema.tables || {};
  } catch (err) {
    console.error("listTables fallback:", err.message);
    return {};
  }
}
