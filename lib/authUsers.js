import { Octokit } from "@octokit/rest";
import bcrypt from "bcryptjs";
import { encrypt, decrypt } from "./crypto.js";

const USERS_PATH = "auth/_users.json";

function octokit() {
  return new Octokit({ auth: process.env.GITHUB_TOKEN });
}

const OWNER = () => process.env.GITHUB_OWNER;
const REPO = () => process.env.GITHUB_REPO;
const BRANCH = () => process.env.GITHUB_BRANCH || "main";

async function readUsersFile() {
  try {
    const { data } = await octokit().repos.getContent({
      owner: OWNER(), repo: REPO(), path: USERS_PATH, ref: BRANCH(),
    });
    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    const decrypted = decrypt(raw);
    return { users: JSON.parse(decrypted), sha: data.sha };
  } catch (err) {
    if (err.status === 404) return { users: [], sha: null };
    throw err;
  }
}

async function writeUsersFile(users, sha) {
  const content = Buffer.from(encrypt(JSON.stringify(users))).toString("base64");
  await octokit().repos.createOrUpdateFileContents({
    owner: OWNER(), repo: REPO(), path: USERS_PATH,
    message: "Update auth users",
    content,
    branch: BRANCH(),
    sha: sha || undefined,
  });
}

export async function createUser({ email, password, role = "authenticated", metadata = {} }) {
  const { users, sha } = await readUsersFile();

  if (users.find((u) => u.email === email)) {
    throw Object.assign(new Error("User already registered"), { code: "user_already_exists", status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    email,
    passwordHash,
    role,
    emailConfirmedAt: now,
    createdAt: now,
    updatedAt: now,
    lastSignInAt: null,
    rawUserMetaData: metadata,
    isSuperAdmin: false,
  };

  users.push(user);
  await writeUsersFile(users, sha);

  return sanitizeUser(user);
}

export async function authenticateUser(email, password) {
  const { users, sha } = await readUsersFile();
  const user = users.find((u) => u.email === email);

  if (!user) {
    throw Object.assign(new Error("Invalid login credentials"), { code: "invalid_credentials", status: 400 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error("Invalid login credentials"), { code: "invalid_credentials", status: 400 });
  }

  user.lastSignInAt = new Date().toISOString();
  await writeUsersFile(users, sha);

  return sanitizeUser(user);
}

export async function getUserById(id) {
  const { users } = await readUsersFile();
  const user = users.find((u) => u.id === id);
  return user ? sanitizeUser(user) : null;
}

export async function listUsers({ page = 1, perPage = 50 } = {}) {
  const { users } = await readUsersFile();
  const start = (page - 1) * perPage;
  return {
    users: users.slice(start, start + perPage).map(sanitizeUser),
    total: users.length,
  };
}

export async function updateUser(id, updates) {
  const { users, sha } = await readUsersFile();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) throw Object.assign(new Error("User not found"), { status: 404 });

  if (updates.password) {
    updates.passwordHash = await bcrypt.hash(updates.password, 12);
    delete updates.password;
  }

  users[idx] = { ...users[idx], ...updates, updatedAt: new Date().toISOString() };
  await writeUsersFile(users, sha);
  return sanitizeUser(users[idx]);
}

export async function deleteUser(id) {
  const { users, sha } = await readUsersFile();
  const filtered = users.filter((u) => u.id !== id);
  if (filtered.length === users.length) throw Object.assign(new Error("User not found"), { status: 404 });
  await writeUsersFile(filtered, sha);
  return { success: true };
}

function sanitizeUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}
