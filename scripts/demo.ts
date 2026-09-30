#!/usr/bin/env node
/**
 * Repeatable end-to-end demo.
 * Uses an isolated database under data/ and deterministic inputs (no random
 * values needed for the calculation path); safe to run repeatedly.
 */
import { rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { energyLedger, compareArrangements, scan } from "../src/core/analysis.ts";
import { checkMeasured, solve } from "../src/core/solver.ts";
import {
  counterOutletCross,
  equalCapacityCounter,
  fouledCounter,
} from "../src/core/fixtures.ts";
import { CaseRepository, Db } from "../src/db/database.ts";
import { startApi } from "../src/api/start.ts";

const dbPath = resolve("data/demo.db");
if (existsSync(dbPath)) rmSync(dbPath);
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Db(dbPath);
db.migrate();
const repo = new CaseRepository(db);

console.log("== 1. Hand-calculated anchor (equal capacity, counter, NTU=1) ==");
const anchor = solve(equalCapacityCounter);
console.log(`q=${anchor.q.toFixed(2)} W  Th,out=${anchor.toutHot.toFixed(2)}  Tc,out=${anchor.toutCold.toFixed(2)}`);
console.log(`LMTD cross-check residual=${anchor.lmtdResidual.toExponential(2)}, balance residual=${anchor.balanceResidual.toExponential(2)}`);

console.log("\n== 2. Counter vs parallel for the same exchanger ==");
const cmp = compareArrangements(equalCapacityCounter);
console.log(`counter q=${cmp.counter.q.toFixed(2)}  parallel q=${cmp.parallel.q.toFixed(2)}  preferred=${cmp.preferred}`);

console.log("\n== 3. Fouling reduces effective U ==");
const dirty = solve(fouledCounter);
console.log(`U clean=${dirty.uClean.toFixed(1)} -> effective=${dirty.uEffective.toFixed(1)} W/m2K, q=${dirty.q.toFixed(2)} W`);

console.log("\n== 4. Counterflow outlet cross is allowed ==");
const cross = solve(counterOutletCross);
console.log(`Th,out=${cross.toutHot.toFixed(2)} < Tc,out=${cross.toutCold.toFixed(2)} (cross=${cross.outletTemperatureCross}); end dT ${cross.deltaT1.toFixed(2)}/${cross.deltaT2.toFixed(2)} > 0`);

console.log("\n== 5. Area sweep (monotone duty) ==");
for (const p of scan(equalCapacityCounter, "area", [1, 2, 4, 8])) {
  console.log(`A=${String(p.value).padStart(2)} m2 -> q=${p.q.toFixed(1)} W eps=${p.effectiveness.toFixed(4)}`);
}

console.log("\n== 6. Measured outlets: imbalance retained, not corrected ==");
const check = checkMeasured(equalCapacityCounter, 79, 82);
console.log(`measured 79/82 C -> imbalance=${check.imbalance.toFixed(1)} W, balanced=${check.balanced}`);

console.log("\n== 7. Versioned persistence ==");
repo.create("demo", "demo case", equalCapacityCounter);
repo.revise("demo", { ...equalCapacityCounter, area: 8 });
console.log(`current version=${repo.getHeader("demo")?.current_version}, retained versions=${repo.listVersions("demo").length}`);
db.close();

console.log("\n== 8. Energy ledger export ==");
const ledger = energyLedger(anchor);
writeFileSync(resolve("data/demo-ledger.json"), JSON.stringify(ledger, null, 2));
console.log("wrote data/demo-ledger.json");

console.log("\n== 9. Live API on localhost auto port ==");
const api = await startApi({ dbPath, host: "127.0.0.1", port: 0 });
try {
  const res = await fetch(`http://127.0.0.1:${api.port}/calculate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(equalCapacityCounter),
  });
  const body = (await res.json()) as { result: { q: number } };
  console.log(`POST /calculate -> HTTP ${res.status}, q=${body.result.q.toFixed(2)} W (port ${api.port})`);
} finally {
  await api.close();
}

console.log("\nDemo complete. Database: data/demo.db (delete to reset).");
