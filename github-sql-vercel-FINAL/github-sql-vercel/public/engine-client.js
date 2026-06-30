export function createClient(url, apiKey, options = {}) {
  const baseUrl = String(url || "").replace(/\/$/, "");
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  async function request(path, init = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers || {}) },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error?.message || body?.error || `HTTP ${res.status}`);
    return body;
  }

  function from(table) {
    const filters = new URLSearchParams();
    const builder = {
      select(columns = "*") {
        filters.set("select", columns);
        return builder;
      },
      eq(column, value) { filters.set(column, `eq.${value}`); return builder; },
      neq(column, value) { filters.set(column, `neq.${value}`); return builder; },
      gt(column, value) { filters.set(column, `gt.${value}`); return builder; },
      gte(column, value) { filters.set(column, `gte.${value}`); return builder; },
      lt(column, value) { filters.set(column, `lt.${value}`); return builder; },
      lte(column, value) { filters.set(column, `lte.${value}`); return builder; },
      like(column, value) { filters.set(column, `like.${value}`); return builder; },
      order(column, { ascending = true } = {}) {
        filters.set("order", `${column}.${ascending ? "asc" : "desc"}`);
        return builder;
      },
      range(from, to) {
        filters.set("offset", String(from));
        filters.set("limit", String(Math.max(0, to - from + 1)));
        return builder;
      },
      limit(count) { filters.set("limit", String(count)); return builder; },
      async get() {
        return request(`/api/rest/v1/${encodeURIComponent(table)}?${filters.toString()}`);
      },
      async insert(values) {
        return request(`/api/rest/v1/${encodeURIComponent(table)}`, { method: "POST", body: JSON.stringify(values) });
      },
      async update(values) {
        return request(`/api/rest/v1/${encodeURIComponent(table)}?${filters.toString()}`, { method: "PUT", body: JSON.stringify(values) });
      },
      async delete() {
        return request(`/api/rest/v1/${encodeURIComponent(table)}?${filters.toString()}`, { method: "DELETE" });
      },
    };
    return builder;
  }

  return {
    from,
    sql(statement) { return request("/api/query", { method: "POST", body: JSON.stringify({ sql: statement }) }); },
    tables() { return request("/api/tables"); },
    health() { return request("/api/admin/health"); },
    operations() { return request("/api/admin/operations"); },
    openapi() { return request("/api/openapi"); },
  };
}
