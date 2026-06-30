import { checkApiKey } from "../../../../lib/auth.js";
import { listUsers, createUser, updateUser, deleteUser, getUserById } from "../../../../lib/authUsers.js";

export default async function handler(req, res) {
  if (!checkApiKey(req, res)) return;

  const id = req.query.id;

  if (req.method === "GET" && !id) {
    const page = Number(req.query.page) || 1;
    const perPage = Number(req.query.per_page) || 50;
    const result = await listUsers({ page, perPage });
    return res.status(200).json(result);
  }

  if (req.method === "GET" && id) {
    const user = await getUserById(id);
    if (!user) return res.status(404).json({ error: { message: "User not found" } });
    return res.status(200).json(user);
  }

  if (req.method === "POST") {
    const { email, password, role, user_metadata } = req.body || {};
    try {
      const user = await createUser({ email, password, role, metadata: user_metadata });
      return res.status(201).json(user);
    } catch (err) {
      return res.status(err.status || 400).json({ error: { message: err.message } });
    }
  }

  if (req.method === "PUT" && id) {
    const user = await updateUser(id, req.body || {});
    return res.status(200).json(user);
  }

  if (req.method === "DELETE" && id) {
    await deleteUser(id);
    return res.status(200).json({ message: "User deleted" });
  }

  return res.status(405).json({ error: { message: "Method not allowed" } });
}
