import { encrypt, decrypt } from "./crypto.js";
import { ghGet, ghPut, ghDelete, cfg } from "./ghApi.js";

const META_PATH = "storage/_buckets.json";

async function readMeta() {
  const { owner, repo, branch } = cfg();
  const data = await ghGet(`/repos/${owner}/${repo}/contents/${META_PATH}`, branch);
  if (!data) return { meta: { buckets: {} }, sha: null };
  return {
    meta: JSON.parse(Buffer.from(data.content, "base64").toString()),
    sha: data.sha,
  };
}

async function writeMeta(meta, sha) {
  const { owner, repo, branch } = cfg();
  const body = {
    message: "Update storage metadata",
    content: Buffer.from(JSON.stringify(meta, null, 2)).toString("base64"),
    branch,
  };
  if (sha) body.sha = sha;
  await ghPut(`/repos/${owner}/${repo}/contents/${META_PATH}`, body);
}

export async function listBuckets() {
  const { meta } = await readMeta();
  return Object.values(meta.buckets || {});
}

export async function createBucket({ id, name, public: isPublic = false }) {
  const { meta, sha } = await readMeta();
  if (meta.buckets[id]) throw Object.assign(new Error(`Bucket '${id}' already exists`), { status: 409 });
  const now = new Date().toISOString();
  meta.buckets[id] = { id, name: name || id, public: isPublic, createdAt: now, updatedAt: now, objectCount: 0, size: 0 };
  await writeMeta(meta, sha);
  return meta.buckets[id];
}

export async function getBucket(id) {
  const { meta } = await readMeta();
  return meta.buckets[id] || null;
}

export async function updateBucket(id, updates) {
  const { meta, sha } = await readMeta();
  if (!meta.buckets[id]) throw Object.assign(new Error(`Bucket '${id}' not found`), { status: 404 });
  meta.buckets[id] = { ...meta.buckets[id], ...updates, updatedAt: new Date().toISOString() };
  await writeMeta(meta, sha);
  return meta.buckets[id];
}

export async function deleteBucket(id) {
  const { meta, sha } = await readMeta();
  if (!meta.buckets[id]) throw Object.assign(new Error(`Bucket '${id}' not found`), { status: 404 });
  delete meta.buckets[id];
  await writeMeta(meta, sha);
  return { message: `Bucket ${id} deleted successfully` };
}

function objectPath(bucket, filePath) {
  return `storage/${bucket}/${filePath.replace(/^\//, "")}`;
}

export async function uploadObject(bucket, filePath, fileBuffer, { contentType = "application/octet-stream", encrypt: shouldEncrypt = false } = {}) {
  const { owner, repo, branch } = cfg();
  const path = objectPath(bucket, filePath);
  let content = shouldEncrypt
    ? Buffer.from(encrypt(fileBuffer.toString("base64"))).toString("base64")
    : fileBuffer.toString("base64");

  const existing = await ghGet(`/repos/${owner}/${repo}/contents/${path}`, branch);
  const body = {
    message: `Upload ${filePath} to ${bucket}`,
    content,
    branch,
  };
  if (existing) body.sha = existing.sha;
  await ghPut(`/repos/${owner}/${repo}/contents/${path}`, body);

  const { meta, sha: metaSha } = await readMeta();
  if (meta.buckets[bucket]) {
    meta.buckets[bucket].objectCount = (meta.buckets[bucket].objectCount || 0) + (existing ? 0 : 1);
    meta.buckets[bucket].size = (meta.buckets[bucket].size || 0) + fileBuffer.length;
    meta.buckets[bucket].updatedAt = new Date().toISOString();
    await writeMeta(meta, metaSha);
  }

  return { Key: path, Id: `${bucket}/${filePath}` };
}

export async function downloadObject(bucket, filePath, { encrypted = false } = {}) {
  const { owner, repo, branch } = cfg();
  const path = objectPath(bucket, filePath);
  const data = await ghGet(`/repos/${owner}/${repo}/contents/${path}`, branch);
  if (!data) throw Object.assign(new Error("Object not found"), { status: 404 });
  const raw = Buffer.from(data.content, "base64");
  if (encrypted) {
    const dec = decrypt(raw.toString());
    return Buffer.from(dec, "base64");
  }
  return raw;
}

export async function deleteObject(bucket, filePath) {
  const { owner, repo, branch } = cfg();
  const path = objectPath(bucket, filePath);
  const data = await ghGet(`/repos/${owner}/${repo}/contents/${path}`, branch);
  if (!data) throw Object.assign(new Error("Object not found"), { status: 404 });
  await ghDelete(`/repos/${owner}/${repo}/contents/${path}`, {
    message: `Delete ${filePath} from ${bucket}`,
    sha: data.sha,
    branch,
  });
  return { message: "Successfully deleted" };
}

export async function listObjects(bucket, { prefix = "", limit = 100, offset = 0 } = {}) {
  const { owner, repo, branch } = cfg();
  const base = `storage/${bucket}`;
  const fullPath = prefix ? `${base}/${prefix}` : base;
  const data = await ghGet(`/repos/${owner}/${repo}/contents/${fullPath}`, branch);
  if (!data) return [];
  const items = Array.isArray(data) ? data : [data];
  return items
    .filter((f) => f.type === "file")
    .slice(offset, offset + limit)
    .map((f) => ({
      name: f.name,
      id: f.sha,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString(),
      metadata: { size: f.size, mimetype: "application/octet-stream", cacheControl: "no-cache" },
    }));
}

export async function getPublicUrl(bucket, filePath) {
  const base = process.env.APP_URL || "";
  return `${base}/storage/v1/object/public/${bucket}/${filePath}`;
}
