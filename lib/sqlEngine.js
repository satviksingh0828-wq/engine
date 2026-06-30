import initSqlJs from "sql.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

let SQL;
export async function getSqlEngine() {
  if (!SQL) {
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    SQL = await initSqlJs({ locateFile: () => wasmPath });
  }
  return SQL;
}
