const buckets = new Map();

export function rateLimit(req, res, { windowMs = 60_000, max = 120 } = {}) {
  const key = req.headers["x-api-key"] || req.headers["x-forwarded-for"] || "anonymous";
  const now = Date.now();
  const bucket = buckets.get(key) || { resetAt: now + windowMs, count: 0 };

  if (now > bucket.resetAt) {
    bucket.resetAt = now + windowMs;
    bucket.count = 0;
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > max) {
    res.status(429).json({ error: { code: "rate_limited", message: "Too many requests. Please retry later." } });
    return false;
  }
  return true;
}
