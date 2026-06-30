import { getUserFromRequest } from "../../../lib/jwt.js";
import { getUserById, updateUser } from "../../../lib/authUsers.js";

export default async function handler(req, res) {
  const payload = getUserFromRequest(req);
  if (!payload) return res.status(401).json({ error: { message: "Not authenticated" } });

  if (req.method === "GET") {
    const user = await getUserById(payload.sub);
    if (!user) return res.status(404).json({ error: { message: "User not found" } });
    return res.status(200).json(user);
  }

  if (req.method === "PUT") {
    const updates = req.body || {};
    const user = await updateUser(payload.sub, updates);
    return res.status(200).json(user);
  }

  return res.status(405).json({ error: { message: "Method not allowed" } });
}
