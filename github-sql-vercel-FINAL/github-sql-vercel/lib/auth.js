export function checkApiKey(req, res) {
  const provided = req.headers["x-api-key"];
  const expected = process.env.API_KEY;

  if (!expected) {
    res.status(500).json({ error: "Server misconfigured: API_KEY env var is not set." });
    return false;
  }

  if (!provided || provided !== expected) {
    res.status(401).json({ error: "Unauthorized: missing or invalid x-api-key header." });
    return false;
  }

  return true;
}
