import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, type StartedServer } from "../src/server/http-server.js";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db/database.js";
import { projectTemp, removeRetry } from "./tmp.js";

/**
 * Full lifecycle: open API -> write -> close -> reopen same file -> verify,
 * covering persistence across a simulated restart.
 */
test("data survives a full process-style reopen", async () => {
  const dir = projectTemp("persist-");
  const file = `${dir}/p.sqlite`;

  let db: DatabaseSync = openDatabase(file);
  let server: StartedServer = await startServer(db, { port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  const payload = {
    name: "persist",
    arrangement: "counter",
    thIn: 120,
    tcIn: 40,
    mh: 2,
    mc: 2,
    cph: 1000,
    cpc: 1000,
    uClean: 400,
    area: 5,
  };
  const res = await fetch(`${base}/cases`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "persist-1" },
    body: JSON.stringify(payload),
  });
  const created = (await res.json()) as { caseId: number; solution: { q: number } };
  await server.close();
  db.close();

  db = openDatabase(file);
  server = await startServer(db);
  const base2 = `http://127.0.0.1:${server.port}`;
  const got = await fetch(`${base2}/cases/${created.caseId}`);
  const body = (await got.json()) as {
    latestVersion: number;
    solution: { q: number };
  };
  assert.equal(body.latestVersion, 1);
  assert.ok(Math.abs(body.solution.q - 80000) < 1e-6);

  // idempotency table also persisted
  const dup = await fetch(`${base2}/cases`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "persist-1" },
    body: JSON.stringify(payload),
  });
  const dupBody = (await dup.json()) as { caseId: number };
  assert.equal(dupBody.caseId, created.caseId);

  await server.close();
  db.close();
  removeRetry(dir);
});
