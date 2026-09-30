import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../db/database.js";
import { startServer } from "./http-server.js";

const DATA_DIR = join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });
const dbPath = process.env.HEXCHECK_DB ?? join(DATA_DIR, "hexcheck.sqlite");
const pidFile = join(DATA_DIR, "server.pid");
const portFile = join(DATA_DIR, "server.port");

const db = openDatabase(dbPath);
const started = await startServer(db, {
  host: process.env.HEXCHECK_HOST ?? "127.0.0.1",
  port: process.env.HEXCHECK_PORT ? Number(process.env.HEXCHECK_PORT) : 0,
});

writeFileSync(pidFile, String(process.pid));
writeFileSync(portFile, String(started.port));

console.log(`[hexcheck] HTTP API listening on http://127.0.0.1:${started.port}`);
console.log(`[hexcheck] database: ${dbPath}`);
console.log(`[hexcheck] pid file: ${pidFile}`);

let stopped = false;
async function shutdown(signal: string): Promise<void> {
  if (stopped) return;
  stopped = true;
  console.log(`[hexcheck] received ${signal}, shutting down...`);
  await started.close();
  db.close();
  console.log("[hexcheck] stopped");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
