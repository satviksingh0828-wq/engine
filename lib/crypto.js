import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALG = "aes-256-gcm";

function getDerivedKey() {
  const secret = process.env.ENCRYPTION_KEY || "supaforge-default-key-change-in-prod";
  const salt = process.env.ENCRYPTION_SALT || "supaforge-salt-v1";
  return scryptSync(secret, salt, 32);
}

export function encrypt(text) {
  if (!text) return text;
  const key = getDerivedKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

export function decrypt(payload) {
  if (!payload || !payload.includes(".")) return payload;
  try {
    const [ivHex, tagHex, encHex] = payload.split(".");
    const key = getDerivedKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return payload;
  }
}

export function encryptObject(obj) {
  return encrypt(JSON.stringify(obj));
}

export function decryptObject(payload) {
  const str = decrypt(payload);
  try { return JSON.parse(str); } catch { return null; }
}
