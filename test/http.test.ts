import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../src/db/database.js";
import { startServer, type StartedServer } from "../src/server/http-server.js";
import { projectTemp, removeRetry } from "./tmp.js";

let server: StartedServer;
let dir: string;
let base: string;

const casePayload = {
  name: "e2e-balanced",
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

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as any;
  return { status: res.status, json };
}

before(async () => {
  dir = projectTemp("http-");
  const db = openDatabase(join(dir, "http.sqlite"));
  server = await startServer(db);
  base = `http://127.0.0.1:${server.port}`;
});

after(async () => {
  await server.close();
  removeRetry(dir);
});

test("health reports model scope", async () => {
  const { status, json } = await call("GET", "/health");
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.ok(Array.isArray(json.scope));
});

test("create -> get -> solution happy path", async () => {
  const created = await call("POST", "/cases", casePayload, {
    "idempotency-key": "e2e-1",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.version, 1);
  assert.ok(Math.abs(created.json.solution.q - 80000) < 1e-6);

  const repeat = await call("POST", "/cases", casePayload, {
    "idempotency-key": "e2e-1",
  });
  assert.equal(repeat.status, 201);
  assert.equal(repeat.json.caseId, created.json.caseId);

  const got = await call("GET", `/cases/${created.json.caseId}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.name, "e2e-balanced");

  const sol = await call("GET", `/cases/${created.json.caseId}/solution`);
  assert.equal(sol.json.lmtdResidualRel < 1e-9, true);
});

test("validation failure carries an explicit error code", async () => {
  const { status, json } = await call("POST", "/cases", {
    ...casePayload,
    thIn: 10,
    tcIn: 90,
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, "INVALID_TEMPERATURE_SPREAD");
});

test("zero flow rejected", async () => {
  const { status, json } = await call("POST", "/cases", {
    ...casePayload,
    name: "zero-flow",
    mc: 0,
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, "ZERO_FLOW");
});

test("invalid JSON -> 400", async () => {
  const res = await fetch(base + "/cases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(res.status, 400);
});

test("revision, compare, scan and ledger endpoints", async () => {
  const created = await call("POST", "/cases", casePayload, {
    "idempotency-key": "e2e-2",
  });
  const id = created.json.caseId;

  const rev = await call("POST", `/cases/${id}/revisions`, {
    ...casePayload,
    area: 8,
    baseVersion: 1,
    changeNote: "larger area",
  });
  assert.equal(rev.status, 201);
  assert.equal(rev.json.version, 2);

  const compare = await call("GET", `/cases/${id}/compare?version=1`);
  assert.equal(compare.status, 200);
  assert.ok(compare.json.counter.q >= compare.json.parallel.q);

  const scanRes = await call(
    "GET",
    `/cases/${id}/scan?param=area&from=0&to=10&count=6`,
  );
  assert.equal(scanRes.json.points.length, 6);
  const qs = scanRes.json.points.map((p: any) => p.solution.q);
  for (let i = 1; i < qs.length; i++) assert.ok(qs[i] >= qs[i - 1]);

  const ledger = await call("GET", `/cases/${id}/ledger`);
  assert.ok(ledger.json.total >= 2);
});

test("measurement check keeps imbalance and distinguishes counter crossing", async () => {
  const created = await call(
    "POST",
    "/cases",
    {
      name: "crossing",
      arrangement: "counter",
      thIn: 100,
      tcIn: 20,
      mh: 1,
      mc: 1,
      cph: 1000,
      cpc: 4000,
      uClean: 300,
      area: 20,
    },
    { "idempotency-key": "e2e-3" },
  );
  const id = created.json.caseId;
  const ok = await call("POST", `/cases/${id}/check`, {
    thOutMeasured: 55,
    tcOutMeasured: 60,
  });
  assert.equal(ok.json.localHeatViolation, false);
  assert.equal(ok.json.outletCrossing, true);
  assert.equal(ok.json.retained.tcOutMeasured, 60);

  const bad = await call("POST", `/cases/${id}/check`, {
    thOutMeasured: 10,
    tcOutMeasured: 95,
  });
  assert.equal(bad.json.localHeatViolation, true);
});

test("pagination metadata", async () => {
  for (let i = 0; i < 3; i++) {
    await call("POST", "/cases", { ...casePayload, name: `page-${i}` });
  }
  const page = await call("GET", "/cases?limit=2&offset=1");
  assert.equal(page.json.limit, 2);
  assert.equal(page.json.offset, 1);
  assert.ok(page.json.total >= 3);
  assert.equal(page.json.items.length, 2);
});

test("unknown route -> 404", async () => {
  const { status } = await call("GET", "/nope");
  assert.equal(status, 404);
});

