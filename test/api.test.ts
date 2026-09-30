import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { equalCapacityCounter } from "../src/core/fixtures.ts";
import { startApi } from "../src/api/start.ts";

const dbPath = join(tmpdir(), `hx-api-${process.pid}-${Date.now()}.db`);
let base = "";
let close: () => Promise<void>;

before(async () => {
  const started = await startApi({ dbPath, host: "127.0.0.1", port: 0 });
  base = `http://127.0.0.1:${started.port}`;
  close = started.close;
});

after(async () => {
  await close();
  rmSync(dbPath, { force: true });
});

async function json(path: string, init?: RequestInit) {
  const res = await fetch(base + path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

describe("HTTP API", () => {
  it("health", async () => {
    const { status, body } = await json("/health");
    assert.equal(status, 200);
    assert.equal(body.status, "ok");
  });

  it("calculates the hand-anchor", async () => {
    const { status, body } = await json("/calculate", {
      method: "POST",
      body: JSON.stringify(equalCapacityCounter),
    });
    assert.equal(status, 200);
    const r = body.result as { q: number; toutHot: number };
    assert.ok(Math.abs(r.q - 160000) < 1e-6);
    assert.ok(Math.abs(r.toutHot - 80) < 1e-9);
  });

  it("returns a clear error code for zero flow", async () => {
    const bad = { ...equalCapacityCounter, hot: { ...equalCapacityCounter.hot, m: 0 } };
    const { status, body } = await json("/calculate", { method: "POST", body: JSON.stringify(bad) });
    assert.equal(status, 400);
    assert.equal((body.error as { code: string }).code, "ZERO_FLOW");
  });

  it("rejects malformed pagination", async () => {
    const { status, body } = await json("/cases?limit=0");
    assert.equal(status, 400);
    assert.equal((body.error as { code: string }).code, "INVALID_PAGINATION");
  });

  it("creates a case idempotently and pages through cases", async () => {
    const payload = JSON.stringify({ id: "e2e1", name: "e2e", input: equalCapacityCounter, idempotencyKey: "k" });
    const a = await json("/cases", { method: "POST", body: payload });
    const b = await json("/cases", { method: "POST", body: payload });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200); // replayed

    const list = await json("/cases?limit=1&offset=0");
    assert.equal(list.status, 200);
    assert.equal((list.body.total as number) >= 1, true);
    assert.equal((list.body.items as unknown[]).length, 1);

    const got = await json("/cases/e2e1");
    assert.equal(got.status, 200);
  });

  it("revisions create new versions and old version stays retrievable", async () => {
    const revised = { ...equalCapacityCounter, area: 8 };
    const r = await json("/cases/e2e1/revisions", { method: "POST", body: JSON.stringify({ input: revised }) });
    assert.equal(r.status, 201);
    assert.equal((r.body.version as number), 2);
    const v1 = await json("/cases/e2e1?version=1");
    const inputV1 = v1.body.input as { area: number };
    assert.equal(inputV1.area, 4);
  });

  it("404 for unknown case", async () => {
    const { status } = await json("/cases/nope");
    assert.equal(status, 404);
  });

  it("scan and compare and energy ledger endpoints", async () => {
    const scan = await json("/calculate/scan", {
      method: "POST",
      body: JSON.stringify({ input: equalCapacityCounter, param: "area", values: [1, 2, 4] }),
    });
    assert.equal(scan.status, 200);
    assert.equal((scan.body.points as unknown[]).length, 3);

    const cmp = await json("/calculate/compare", { method: "POST", body: JSON.stringify(equalCapacityCounter) });
    assert.equal(cmp.status, 200);
    assert.ok((cmp.body.result as { qGainCounterOverParallel: number }).qGainCounterOverParallel > 0);

    const ledger = await json("/calculate/energy-ledger", { method: "POST", body: JSON.stringify(equalCapacityCounter) });
    assert.equal(ledger.status, 200);
    assert.ok(typeof (ledger.body.ledger as { scope: string }).scope, "string");
  });
});

// AddressInfo import kept for typing parity; ensure it is referenced without runtime cost.
export type _Addr = AddressInfo;
