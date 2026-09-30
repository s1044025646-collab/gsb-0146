import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaseRepository, Db, type Clock } from "../src/db/database.ts";

function fixedClock(): Clock {
  let n = 0;
  return {
    now: () => "2026-09-30T00:00:00.000Z",
    random: () => `000000000000000${(n++).toString(16)}`.slice(-16),
  };
}

const dbPath = join(tmpdir(), `hx-persist-${process.pid}-${Date.now()}.db`);

describe("versioned cases, rollback, persistence and idempotency", () => {
  let db: Db;
  let repo: CaseRepository;

  before(() => {
    db = new Db(dbPath);
    db.migrate(fixedClock());
    repo = new CaseRepository(db);
  });

  after(() => {
    db.close();
  });

  it("migrations are repeatable", () => {
    db.migrate(fixedClock());
    db.migrate(fixedClock());
    const v = db.sqlite.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    assert.equal(v.v, 4);
  });

  it("creates v1 and revising produces a new version while retaining the old one", () => {
    repo.create("c1", "first", { area: 1 }, fixedClock());
    const v1 = repo.getVersion("c1", 1);
    const revised = repo.revise("c1", { area: 2 }, fixedClock());
    assert.equal(revised.version, 2);
    assert.equal(repo.getHeader("c1")?.current_version, 2);
    assert.deepEqual(JSON.parse(v1!.input_json), { area: 1 });
    assert.equal(repo.listVersions("c1").length, 2);
  });

  it("rolls back a failed revision (invalid case id) leaving version count unchanged", () => {
    const before = repo.listVersions("c1").length;
    assert.throws(() => repo.revise("missing", { area: 9 }, fixedClock()));
    assert.equal(repo.listVersions("c1").length, before);
  });

  it("repeated idempotency key replays the same stored response", () => {
    let calls = 0;
    const produce = () => (calls++, { ok: true, n: calls });
    const a = repo.withIdempotency("key-1", produce, fixedClock());
    const b = repo.withIdempotency("key-1", produce, fixedClock());
    assert.equal(a.replayed, false);
    assert.equal(b.replayed, true);
    assert.deepEqual(b.value, { ok: true, n: 1 });
    assert.equal(calls, 1);
  });

  it("persists across restart using the same file", () => {
    db.close();
    const reopened = new Db(dbPath);
    reopened.migrate(fixedClock());
    const reopenedRepo = new CaseRepository(reopened);
    assert.equal(reopenedRepo.getHeader("c1")?.current_version, 2);
    assert.equal(reopenedRepo.listVersions("c1").length, 2);
    const { items, total } = reopenedRepo.list(10, 0);
    assert.equal(total, 1);
    assert.equal(items[0]?.id, "c1");
    reopened.close();
    rmSync(dbPath, { force: true });
  });
});
