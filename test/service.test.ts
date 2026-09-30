import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase, type Clock } from "../src/db/database.js";
import { runMigrations } from "../src/db/database.js";
import { CaseService } from "../src/services/case-service.js";
import { AppError } from "../src/core/errors.js";
import { balancedCounter } from "./fixtures.js";
import { projectTemp, removeRetry } from "./tmp.js";

function tempDb(): { db: DatabaseSync; dir: string; clock: { t: string } & Clock } {
  const dir = projectTemp("svc-");
  const db = openDatabase(`${dir}/test.sqlite`);
  let counter = 0;
  const clock = {
    t: "",
    now() {
      this.t = new Date(Date.UTC(2026, 0, 1 + counter)).toISOString();
      counter++;
      return new Date(this.t);
    },
  };
  return { db, dir, clock };
}

function payload(over: Record<string, unknown> = {}) {
  return {
    name: "balanced",
    arrangement: "counter",
    thIn: 120,
    tcIn: 40,
    mh: 2,
    mc: 2,
    cph: 1000,
    cpc: 1000,
    uClean: 400,
    area: 5,
    ...over,
  };
}

test("create stores version 1 and ledger entry", () => {
  const { db, dir } = tempDb();
  const service = new CaseService(db);
  const created = service.createCase(payload());
  assert.equal(created.version, 1);
  assert.ok(Math.abs(created.solution.q - 80000) < 1e-6);
  const ledger = service.ledger(created.caseId, 10, 0);
  assert.equal(ledger.total, 1);
  db.close();
  removeRetry(dir);
});

test("revision appends a new version and never mutates history", () => {
  const { db, dir } = tempDb();
  const service = new CaseService(db);
  const created = service.createCase(payload());
  const v2 = service.revise(created.caseId, {
    ...payload(),
    area: 10,
    changeNote: "double area",
    baseVersion: 1,
  });
  assert.equal(v2.version, 2);
  assert.ok(v2.solution.q > created.solution.q);
  const v1 = service.getCase(created.caseId, 1);
  assert.equal(v1.inputs.area, 5);
  const page = service.listVersions(created.caseId, 10, 0);
  assert.equal(page.total, 2);
  db.close();
  removeRetry(dir);
});

test("optimistic version conflict", () => {
  const { db, dir } = tempDb();
  const service = new CaseService(db);
  const created = service.createCase(payload());
  service.revise(created.caseId, { ...payload(), area: 9, baseVersion: 1 });
  assert.throws(
    () => service.revise(created.caseId, { ...payload(), area: 8, baseVersion: 1 }),
    (e: unknown) => e instanceof AppError && e.code === "VERSION_CONFLICT",
  );
  db.close();
  removeRetry(dir);
});

test("failed revision rolls back: no stray version or ledger row", () => {
  const { db, dir } = tempDb();
  const service = new CaseService(db);
  const created = service.createCase(payload());
  assert.throws(() =>
    service.revise(created.caseId, { ...payload(), thIn: 10, tcIn: 90, baseVersion: 1 }),
  );
  assert.equal(service.listVersions(created.caseId, 10, 0).total, 1);
  assert.equal(service.ledger(created.caseId, 10, 0).total, 1);
  db.close();
  removeRetry(dir);
});

test("idempotent repeat submit returns the identical result", () => {
  const { db, dir } = tempDb();
  const service = new CaseService(db);
  const a = service.createCase(payload(), "key-123");
  const b = service.createCase(payload(), "key-123");
  assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)));
  assert.equal(service.listCases(100, 0).total, 1);
  assert.throws(
    () => service.createCase(payload({ area: 9 }), "key-123"),
    (e: unknown) => e instanceof AppError && e.code === "IDEMPOTENCY_CONFLICT",
  );
  db.close();
  removeRetry(dir);
});

test("injected clock gives reproducible timestamps; reopen persists", () => {
  const dir = projectTemp("svc-");
  const file = `${dir}/p.sqlite`;
  let db = openDatabase(file);
  let counter = 0;
  const clock: Clock = { now: () => new Date(Date.UTC(2030, 0, 1 + counter++)) };
  let service = new CaseService(db, clock);
  const created = service.createCase(payload());
  assert.equal(created.createdAt, "2030-01-01T00:00:00.000Z");
  db.close();

  db = openDatabase(file);
  service = new CaseService(db, clock);
  const reloaded = service.getCase(created.caseId, 1);
  assert.equal(reloaded.name, "balanced");
  assert.ok(Math.abs(reloaded.solution.q - created.solution.q) < 1e-12);
  db.close();
  removeRetry(dir);
});

test("migrations are repeatable", () => {
  const { db, dir } = tempDb();
  assert.doesNotThrow(() => runMigrations(db));
  assert.doesNotThrow(() => runMigrations(db));
  db.close();
  removeRetry(dir);
});

test("mixed units produce identical SI solution", () => {
  const { db, dir } = tempDb();
  const service = new CaseService(db);
  const si = service.createCase(payload({ name: "si" }));
  const mixed = service.createCase(
    payload({
      name: "mixed",
      thIn: 248,
      tcIn: 104,
      mh: 7200,
      mc: 7200,
      cph: 1,
      cpc: 1,
      uClean: 400 / 1.163,
      area: 5,
      units: {
        temperature: "F",
        massFlow: "kg/h",
        cp: "kJ/kg.K",
        u: "kcal/m2.h.C",
        area: "m2",
        rf: "m2.K/W",
      },
    }),
  );
  assert.ok(Math.abs(mixed.solution.q - si.solution.q) < 1e-6);
  db.close();
  removeRetry(dir);
});

test("pagination limits and offsets", () => {
  const { db, dir } = tempDb();
  const service = new CaseService(db);
  for (let i = 0; i < 5; i++) service.createCase(payload({ name: `case-${i}` }));
  const page = service.listCases(2, 2);
  assert.equal(page.total, 5);
  assert.equal(page.items.length, 2);
  assert.equal((page.items[0] as { name: string }).name, "case-2");
  db.close();
  removeRetry(dir);
});

test("not found error code", () => {
  const { db, dir } = tempDb();
  const service = new CaseService(db);
  assert.throws(
    () => service.getCase(999),
    (e: unknown) => e instanceof AppError && e.code === "NOT_FOUND",
  );
  db.close();
  removeRetry(dir);
});

test("balancedCounter fixture sanity", () => {
  assert.ok(balancedCounter.area > 0);
  assert.ok(existsSync(process.cwd()));
});
