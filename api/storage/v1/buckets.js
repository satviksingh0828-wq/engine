import { checkApiKey } from "../../../lib/auth.js";
import { listBuckets, createBucket, getBucket, updateBucket, deleteBucket } from "../../../lib/storageBuckets.js";

export default async function handler(req, res) {
  if (!checkApiKey(req, res)) return;

  const id = req.query.id || req.url?.split("/").filter(Boolean).pop();

  if (req.method === "GET" && !req.query.id) {
    const buckets = await listBuckets();
    return res.status(200).json(buckets);
  }

  if (req.method === "GET" && req.query.id) {
    const bucket = await getBucket(req.query.id);
    if (!bucket) return res.status(404).json({ error: "Bucket not found" });
    return res.status(200).json(bucket);
  }

  if (req.method === "POST") {
    const { id: bucketId, name, public: isPublic } = req.body || {};
    if (!bucketId) return res.status(400).json({ error: "id is required" });
    try {
      const bucket = await createBucket({ id: bucketId, name, public: isPublic });
      return res.status(200).json({ name: bucket.id });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }

  if (req.method === "PUT" && req.query.id) {
    const bucket = await updateBucket(req.query.id, req.body || {});
    return res.status(200).json({ message: "Successfully updated" });
  }

  if (req.method === "DELETE" && req.query.id) {
    try {
      await deleteBucket(req.query.id);
      return res.status(200).json({ message: "Successfully deleted" });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
