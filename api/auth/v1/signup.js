import { createUser } from "../../../lib/authUsers.js";
import { signAccessToken, signRefreshToken } from "../../../lib/jwt.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });

  const { email, password, data: metadata = {}, options = {} } = req.body || {};

  if (!email || !password) {
    return res.status(422).json({
      error: { message: "Email and password are required." },
    });
  }
  if (password.length < 6) {
    return res.status(422).json({
      error: { message: "Password must be at least 6 characters." },
    });
  }

  try {
    const user = await createUser({ email, password, metadata });
    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = signRefreshToken({ sub: user.id });

    return res.status(200).json({
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: refreshToken,
      user,
    });
  } catch (err) {
    return res.status(err.status || 400).json({
      error: { message: err.message, code: err.code },
    });
  }
}
