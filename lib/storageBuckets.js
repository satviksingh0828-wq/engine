import { Octokit } from "@octokit/rest";
import { encrypt, decrypt } from "./crypto.js";

const META_PATH = "storage/_buckets.json";

function oc() { return new Octokit({ auth: process.env.GITHUB_TOKEN }); }
const OWNER = () => process.env.GITHUB_OWNER;
const REPO = () => process.env.GITHUB_REPO;
const BRANCH = () => process.env.GITHUB_BRANCH || "main";

async function readMeta() {
  try {
    const { data } = await oc().repos.getContent({
      owner: OWNER(), repo: REPO(), path: META_PATH, ref: BRANCH(),
    });
    return { meta: JSON.parse(Buffer.from(data.content, "base64").toString()), sha: data.sha };
  } catch (e) {
    if (e.status === 404) return { meta: { buckets: {} }, sha: null };
    throw e;
  }
}

async function writeMeta(meta, sha) {
  await oc().repos.createOrUpdateFileContents({
    owner: OWNER(), repo: REPO(), path: META_PATH,
    message: "Update storage metadata",
    content: Buffer.from(JSON.stringify(meta, null, 2)).toString("base64"),
    branch: BRANCH(), sha: sha || undefined,
  });
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
  const path = objectPath(bucket, filePath);
  let content;
  if (shouldEncrypt) {
    content = Buffer.from(encrypt(fileBuffer.toString("base64"))).toString("base64");
  } else {
    content = fileBuffer.toString("base64");
  }

  let sha;
  try {
    const { data } = await oc().repos.getContent({ owner: OWNER(), repo: REPO(), path, ref: BRANCH() });
    sha = data.sha;
  } catch {}

  await oc().repos.createOrUpdateFileContents({
    owner: OWNER(), repo: REPO(), path,
    message: `Upload ${filePath} to ${bucket}`,
    content, branch: BRANCH(), sha,
  });

  const { meta, sha: metaSha } = await readMeta();
  if (meta.buckets[bucket]) {
    meta.buckets[bucket].objectCount = (meta.buckets[bucket].objectCount || 0) + (sha ? 0 : 1);
    meta.buckets[bucket].size = (meta.buckets[bucket].size || 0) + fileBuffer.length;
    meta.buckets[bucket].updatedAt = new Date().toISOString();
    await writeMeta(meta, metaSha);
  }

  return {
    Key: path,
    Id: `${bucket}/${filePath}`,
  };
}

export async function downloadObject(bucket, filePath, { encrypted = false } = {}) {
  const path = objectPath(bucket, filePath);
  try {
    const { data } = await oc().repos.getContent({ owner: OWNER(), repo: REPO(), path, ref: BRANCH() });
    const raw = Buffer.from(data.content, "base64");
    if (encrypted) {
      const dec = decrypt(raw.toString());
      return Buffer.from(dec, "base64");
    }
    return raw;
  } catch (e) {
    if (e.status === 404) throw Object.assign(new Error("Object not found"), { status: 404 });
    throw e;
  }
}

export async function deleteObject(bucket, filePath) {
  const path = objectPath(bucket, filePath);
  try {
    const { data } = await oc().repos.getContent({ owner: OWNER(), repo: REPO(), path, ref: BRANCH() });
    await oc().repos.deleteFile({
      owner: OWNER(), repo: REPO(), path,
      message: `Delete ${filePath} from ${bucket}`,
      sha: data.sha, branch: BRANCH(),
    });
    return { message: "Successfully deleted" };
  } catch (e) {
    if (e.status === 404) throw Object.assign(new Error("Object not found"), { status: 404 });
    throw e;
  }
}

export async function listObjects(bucket, { prefix = "", limit = 100, offset = 0 } = {}) {
  try {
    const base = `storage/${bucket}`;
    const fullPath = prefix ? `${base}/${prefix}` : base;
    const { data } = await oc().repos.getContent({ owner: OWNER(), repo: REPO(), path: fullPath, ref: BRANCH() });
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
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

export async function getPublicUrl(bucket, filePath) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.APP_URL || "";
  return `${base}/storage/v1/object/public/${bucket}/${filePath}`;
}
