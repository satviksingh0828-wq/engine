import { uploadObject, downloadObject, deleteObject, listObjects } from "../../../lib/storageBuckets.js";
import { getUserFromRequest } from "../../../lib/jwt.js";

function isAuthed(req) {
  const user = getUserFromRequest(req);
  if (user) return true;
  const k = req.headers["x-api-key"] || req.headers["apikey"];
  if (!k) return false;
  const keys = (process.env.API_KEY ? [process.env.API_KEY] : []).concat(
    (process.env.API_KEYS || "").split(",").map((x) => x.split(":")[1]).filter(Boolean)
  );
  return keys.includes(k);
}

function parseBucketAndPath(req) {
  const paramBucket = req.params?.bucket;
  const paramPath = req.params?.path;
  if (paramBucket) return { bucket: paramBucket, filePath: Array.isArray(paramPath) ? paramPath.join("/") : paramPath || "" };

  const url = (req.url || "").split("?")[0];
  const parts = url
    .replace(/^\/(api\/)?storage\/v1\/objects?\/?(list\/)?/, "")
    .split("/")
    .filter(Boolean);
  return { bucket: parts[0] || "", filePath: parts.slice(1).join("/") };
}

export default async function handler(req, res) {
  if (!isAuthed(req)) return res.status(401).json({ error: "Unauthorized" });

  const url = req.url || "";
  const isListRequest = req.query?.list || url.includes("/list/");

  if (isListRequest) {
    const bucket = req.query?.bucket || parseBucketAndPath(req).bucket;
    if (!bucket) return res.status(400).json({ error: "bucket is required" });
    const { prefix, limit, offset } = req.body || req.query || {};
    const objects = await listObjects(bucket, {
      prefix: prefix || "",
      limit: Number(limit) || 100,
      offset: Number(offset) || 0,
    });
    return res.status(200).json(objects);
  }

  if (req.method === "POST" || req.method === "PUT") {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const bucket = body?.bucket || req.headers["x-bucket"] || parseBucketAndPath(req).bucket;
    const filePath = body?.path || req.headers["x-path"] || parseBucketAndPath(req).filePath;

    if (!bucket) return res.status(400).json({ error: "bucket is required" });
    if (!filePath) return res.status(400).json({ error: "path is required" });

    let fileBuffer;
    if (body?.data) {
      const encoding = body.encoding || "base64";
      fileBuffer = Buffer.from(body.data, encoding);
    } else if (Buffer.isBuffer(req.body)) {
      fileBuffer = req.body;
    } else {
      const chunks = [];
      await new Promise((resolve, reject) => {
        req.on("data", (c) => chunks.push(c));
        req.on("end", resolve);
        req.on("error", reject);
      });
      fileBuffer = Buffer.concat(chunks);
    }

    const ct = req.headers["content-type"] || "application/octet-stream";
    const result = await uploadObject(bucket, filePath, fileBuffer, { contentType: ct });
    return res.status(200).json({ Key: result.Key, Id: result.Id });
  }

  if (req.method === "GET") {
    const { bucket, filePath } = parseBucketAndPath(req);
    if (!bucket || !filePath) return res.status(400).json({ error: "bucket and path are required" });
    try {
      const buffer = await downloadObject(bucket, filePath);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${filePath.split("/").pop()}"`);
      return res.status(200).send(buffer);
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    const { bucket, filePath } = parseBucketAndPath(req);
    if (!bucket || !filePath) return res.status(400).json({ error: "bucket and path required" });
    try {
      await deleteObject(bucket, filePath);
      return res.status(200).json({ message: "Successfully deleted" });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
