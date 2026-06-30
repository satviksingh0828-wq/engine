import { getUserFromRequest } from "../../../lib/jwt.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: { message: "Not authenticated" } });
  return res.status(204).end();
}
