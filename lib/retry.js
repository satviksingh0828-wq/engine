// lib/retry.js
// Retries a write operation if it fails due to a stale SHA (409 conflict),
// which happens when two requests try to write the same file at the same time.

export async function withRetry(fn, { attempts = 4, baseDelayMs = 200 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isConflict = err.status === 409 || err.status === 422;
      if (!isConflict || i === attempts - 1) throw err;
      const delay = baseDelayMs * 2 ** i + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
