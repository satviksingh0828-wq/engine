const MAX_EVENTS = 250;
const events = [];

export function recordAuditEvent(req, event) {
  const apiKey = req?.headers?.["x-api-key"] || "";
  const maskedKey = apiKey ? `${String(apiKey).slice(0, 4)}…${String(apiKey).slice(-2)}` : null;
  events.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    method: req?.method,
    path: req?.url,
    key: maskedKey,
    ...event,
  });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
}

export function listAuditEvents(limit = 100) {
  return events.slice(0, Math.max(1, Math.min(Number(limit) || 100, MAX_EVENTS)));
}
