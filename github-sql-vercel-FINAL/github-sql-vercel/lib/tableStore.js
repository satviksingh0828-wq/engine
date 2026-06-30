import { getTableFile, saveTableFile } from "./github.js";

const DEFAULT_FLUSH_MS = 1000;
const tableCache = new Map();
const locks = new Map();

function flushDelayMs() {
  return Math.max(0, Number(process.env.ENGINE_WRITE_FLUSH_MS || DEFAULT_FLUSH_MS));
}

function bufferedWritesEnabled() {
  return String(process.env.ENGINE_BUFFERED_WRITES || "true") !== "false";
}

function stateFor(table) {
  if (!tableCache.has(table)) {
    tableCache.set(table, {
      table,
      buffer: null,
      sha: null,
      dirty: false,
      flushTimer: null,
      flushPromise: null,
      pendingWrites: 0,
      lastQueuedAt: null,
      lastFlushedAt: null,
      lastError: null,
      commitMessage: null,
    });
  }
  return tableCache.get(table);
}

export async function withTableLock(table, fn) {
  const previous = locks.get(table) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => current);
  locks.set(table, chained);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(table) === chained) locks.delete(table);
  }
}

export async function getBufferedTableFile(table) {
  const state = stateFor(table);
  if (state.buffer) {
    return { buffer: state.buffer, sha: state.sha, pending: state.dirty };
  }

  const file = await getTableFile(table);
  state.buffer = file.buffer;
  state.sha = file.sha;
  return { ...file, pending: false };
}

export async function persistTableFile(table, buffer, sha, commitMessage, { flushNow = false } = {}) {
  const state = stateFor(table);
  state.buffer = buffer;
  state.sha = sha || state.sha;
  state.dirty = true;
  state.pendingWrites += 1;
  state.lastQueuedAt = new Date().toISOString();
  state.commitMessage = commitMessage || `Update table ${table}`;
  state.lastError = null;

  if (!bufferedWritesEnabled() || flushNow) {
    await flushTable(table);
    return { queued: false, pendingWrites: 0 };
  }

  scheduleFlush(table);
  return {
    queued: true,
    flushInMs: flushDelayMs(),
    pendingWrites: state.pendingWrites,
  };
}

function scheduleFlush(table) {
  const state = stateFor(table);
  if (state.flushTimer) clearTimeout(state.flushTimer);
  state.flushTimer = setTimeout(() => {
    flushTable(table).catch((err) => {
      state.lastError = err.message;
      console.error(`Buffered flush failed for ${table}:`, err);
      scheduleFlush(table);
    });
  }, flushDelayMs());
  state.flushTimer.unref?.();
}

export async function flushTable(table) {
  const state = stateFor(table);
  if (state.flushPromise) return state.flushPromise;
  if (!state.dirty || !state.buffer) return null;

  state.flushPromise = (async () => {
    if (state.flushTimer) clearTimeout(state.flushTimer);
    state.flushTimer = null;

    const bufferToFlush = state.buffer;
    const pendingWrites = state.pendingWrites;
    const commitMessage = state.commitMessage;
    const latest = await getTableFile(table);
    const response = await saveTableFile(table, bufferToFlush, latest.sha, commitMessage);
    state.sha = response?.data?.content?.sha || latest.sha || state.sha;
    state.lastFlushedAt = new Date().toISOString();
    state.lastError = null;

    if (state.buffer === bufferToFlush && state.pendingWrites === pendingWrites) {
      state.dirty = false;
      state.pendingWrites = 0;
    } else {
      state.pendingWrites = Math.max(1, state.pendingWrites - pendingWrites);
      scheduleFlush(table);
    }

    return response;
  })();

  try {
    return await state.flushPromise;
  } finally {
    state.flushPromise = null;
  }
}

export function forgetTable(table) {
  const state = tableCache.get(table);
  if (state?.flushTimer) clearTimeout(state.flushTimer);
  tableCache.delete(table);
}

export function listBufferedOperations() {
  return [...tableCache.values()].map((state) => ({
    table: state.table,
    dirty: state.dirty,
    pendingWrites: state.pendingWrites,
    lastQueuedAt: state.lastQueuedAt,
    lastFlushedAt: state.lastFlushedAt,
    lastError: state.lastError,
    flushInMs: state.dirty ? flushDelayMs() : 0,
  }));
}

export function bufferedWriteSettings() {
  return {
    enabled: bufferedWritesEnabled(),
    flushDelayMs: flushDelayMs(),
  };
}
