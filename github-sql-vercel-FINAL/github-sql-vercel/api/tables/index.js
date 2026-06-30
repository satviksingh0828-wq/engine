import { checkApiKey } from "../../lib/auth.js";
import { listTables } from "../../lib/github.js";

export default async function handler(req, res) {
  if (!checkApiKey(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const tables = await listTables();
    return res.status(200).json({ tables });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
