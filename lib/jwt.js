import jwt from "jsonwebtoken";

function getSecret() {
  return process.env.JWT_SECRET || "supaforge-jwt-secret-change-in-prod";
}

export function signAccessToken(payload) {
  return jwt.sign(payload, getSecret(), {
    expiresIn: process.env.JWT_EXPIRY || "3600s",
    issuer: "supaforge",
  });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, getSecret() + "-refresh", {
    expiresIn: "7d",
    issuer: "supaforge",
  });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, getSecret(), { issuer: "supaforge" });
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, getSecret() + "-refresh", { issuer: "supaforge" });
  } catch {
    return null;
  }
}

export function extractBearerToken(req) {
  const auth = req.headers["authorization"] || req.headers["apikey"] || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return auth || null;
}

export function getUserFromRequest(req) {
  const token = extractBearerToken(req);
  if (!token) return null;
  return verifyAccessToken(token);
}
