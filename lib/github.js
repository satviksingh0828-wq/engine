import { ghGet, ghPut, ghPost, ghDelete, cfg } from "./ghApi.js";
import { withRetry } from "./retry.js";

function tablePath(tableName) {
  return `tables/${tableName}.db`;
}

async function repoExists() {
  const { owner, repo } = cfg();
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status });
  return true;
}

async function createRepo() {
  const { repo } = cfg();
  await ghPost("/user/repos", {
    name: repo,
    private: true,
    auto_init: true,
    description: "Auto-provisioned SQL storage repo (managed by SupaForge)",
  });
}

async function fileExists(path) {
  const { owner, repo, branch } = cfg();
  const data = await ghGet(`/repos/${owner}/${repo}/contents/${path}`, branch);
  return data !== null;
}

async function createFile(path, contentString, message) {
  const { owner, repo, branch } = cfg();
  await ghPut(`/repos/${owner}/${repo}/contents/${path}`, {
    message,
    content: Buffer.from(contentString).toString("base64"),
    branch,
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
      "# Auto-provisioned SQL storage\n\nManaged by SupaForge. Do not edit manually.\n",
      "Bootstrap: add README"
    );
  }
  bootstrapped = true;
}

export async function getTableFile(tableName) {
  const { owner, repo, branch } = cfg();
  const data = await ghGet(`/repos/${owner}/${repo}/contents/${tablePath(tableName)}`, branch);
  if (!data) return { buffer: null, sha: null };
  return { buffer: Buffer.from(data.content, "base64"), sha: data.sha };
}

export async function saveTableFile(tableName, buffer, sha, commitMessage) {
  const { owner, repo, branch } = cfg();
  return withRetry(() => {
    const body = {
      message: commitMessage || `Update table ${tableName}`,
      content: buffer.toString("base64"),
      branch,
    };
    if (sha) body.sha = sha;
    return ghPut(`/repos/${owner}/${repo}/contents/${tablePath(tableName)}`, body);
  });
}

export async function deleteTableFile(tableName, sha) {
  const { owner, repo, branch } = cfg();
  const current = sha || (await getTableFile(tableName)).sha;
  if (!current) return null;
  return withRetry(() =>
    ghDelete(`/repos/${owner}/${repo}/contents/${tablePath(tableName)}`, {
      message: `Delete table ${tableName}`,
      sha: current,
      branch,
    })
  );
}

export async function getSchema() {
  const { owner, repo, branch } = cfg();
  const data = await ghGet(`/repos/${owner}/${repo}/contents/meta/_schema.json`, branch);
  if (!data) return { schema: { tables: {} }, sha: null };
  return {
    schema: JSON.parse(Buffer.from(data.content, "base64").toString("utf-8")),
    sha: data.sha,
  };
}

export async function saveSchema(schemaObj, sha) {
  const { owner, repo, branch } = cfg();
  return withRetry(() => {
    const body = {
      message: "Update schema registry",
      content: Buffer.from(JSON.stringify(schemaObj, null, 2)).toString("base64"),
      branch,
    };
    if (sha) body.sha = sha;
    return ghPut(`/repos/${owner}/${repo}/contents/meta/_schema.json`, body);
  });
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
