import { authenticateUser } from "../../../lib/authUsers.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken, getUserFromRequest } from "../../../lib/jwt.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });

  const grantType = req.query.grant_type || req.body?.grant_type;

  if (grantType === "password") {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: { message: "email and password are required" } });
    }
    try {
      const user = await authenticateUser(email, password);
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
      return res.status(err.status || 400).json({ error: { message: err.message, code: err.code } });
    }
  }

  if (grantType === "refresh_token") {
    const { refresh_token } = req.body || {};
    const payload = verifyRefreshToken(refresh_token);
    if (!payload) return res.status(401).json({ error: { message: "Invalid refresh token" } });

    const accessToken = signAccessToken({ sub: payload.sub, role: "authenticated" });
    const newRefresh = signRefreshToken({ sub: payload.sub });
    return res.status(200).json({
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: newRefresh,
    });
  }

  return res.status(400).json({ error: { message: `Unsupported grant_type: ${grantType}` } });
}
