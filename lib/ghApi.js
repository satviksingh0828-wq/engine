const BASE = "https://api.github.com";

function headers() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "SupaForge/1.0",
  };
}

export function cfg() {
  return {
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_BRANCH || "main",
  };
}

export async function ghGet(path, ref) {
  const url = ref ? `${BASE}${path}?ref=${encodeURIComponent(ref)}` : `${BASE}${path}`;
  const res = await fetch(url, { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status });
  return res.json();
}

export async function ghPut(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status });
  return res.json();
}

export async function ghPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status });
  return res.json();
}

export async function ghDelete(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status });
  return res.json();
}
