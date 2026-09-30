/**
 * Repeatable end-to-end demonstration against a project-local SQLite file.
 * The database is recreated on every run and the clock is fixed, so output is
 * byte-stable apart from numeric formatting (which is fixed precision).
 */
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { openDatabase, type Clock } from "../src/db/database.js";
import { CaseService, linspace, scan } from "../src/services/case-service.js";
import { modelScope } from "../src/core/heatx.js";
import { isAppError } from "../src/core/errors.js";

const dir = join(process.cwd(), "data");
mkdirSync(dir, { recursive: true });
const dbFile = join(dir, "demo.sqlite");
for (const suffix of ["", "-wal", "-shm"]) {
  if (existsSync(dbFile + suffix)) rmSync(dbFile + suffix);
}

let tick = 0;
const fixedClock: Clock = { now: () => new Date(Date.UTC(2026, 0, 1 + tick++)) };

const db = openDatabase(dbFile);
const service = new CaseService(db, fixedClock);

const balanced = {
  name: "demo-balanced-cr1",
  arrangement: "counter" as const,
  thIn: 120,
  tcIn: 40,
  mh: 2,
  mc: 2,
  cph: 1000,
  cpc: 1000,
  uClean: 400,
  area: 5,
  rfHot: 0,
  rfCold: 0,
};

console.log("=== hexcheck repeatable demo ===");
console.log("\n[1] create balanced counterflow case (hand-check: Q = 80 kW)");
const c1 = service.createCase(balanced);
console.log(
  `case #${c1.caseId} v1: eps=${c1.solution.effectiveness.toFixed(4)} ` +
    `NTU=${c1.solution.ntu.toFixed(4)} Q=${(c1.solution.q / 1000).toFixed(3)} kW ` +
    `Th,out=${c1.solution.thOut.toFixed(2)}C Tc,out=${c1.solution.tcOut.toFixed(2)}C ` +
    `LMTD-check-rel-err=${c1.solution.lmtdResidualRel.toExponential(2)}`,
);

console.log("\n[2] revision: area 5 -> 8 m2 produces v2 (v1 immutable)");
const c2 = service.revise(c1.caseId, {
  ...balanced,
  name: c1.definition.name,
  area: 8,
  baseVersion: 1,
  changeNote: "larger bundle",
});
console.log(`v2 Q=${(c2.solution.q / 1000).toFixed(3)} kW; v1 still Q=80.000 kW`);

console.log("\n[3] add fouling Rf,hot=0.001 m2K/W as v3");
const c3 = service.revise(c1.caseId, {
  ...balanced,
  name: c1.definition.name,
  area: 8,
  rfHot: 0.001,
  baseVersion: 2,
  changeNote: "fouled",
});
console.log(
  `U_eff drops ${c2.solution.uEffective.toFixed(1)} -> ${c3.solution.uEffective.toFixed(1)} W/m2K, ` +
    `Q drops to ${(c3.solution.q / 1000).toFixed(3)} kW`,
);

console.log("\n[4] parallel vs counter comparison on v1 inputs");
const cmp = service.compareArrangements(c1.caseId, 1);
console.log(
  `parallel Q=${(cmp.parallel.q / 1000).toFixed(3)} kW, ` +
    `counter Q=${(cmp.counter.q / 1000).toFixed(3)} kW, winner=${cmp.winner}`,
);

console.log("\n[5] counterflow outlet-crossing case (legal, not a violation)");
const cross = service.createCase({
  name: "demo-counter-crossing",
  arrangement: "counter",
  thIn: 100,
  tcIn: 20,
  mh: 1,
  mc: 1,
  cph: 1000,
  cpc: 4000,
  uClean: 300,
  area: 20,
  rfHot: 0,
  rfCold: 0,
});
console.log(
  `Th,out=${cross.solution.thOut.toFixed(2)}C < Tc,out=${cross.solution.tcOut.toFixed(2)}C ` +
    `feasible=${cross.solution.feasible}`,
);

console.log("\n[6] measurement check: imbalance retained, values not corrected");
const meas = service.checkMeasured(cross.caseId, {
  thOutMeasured: 55,
  tcOutMeasured: 60,
});
console.log(
  `Qhot=${meas.qHotMeasured.toFixed(0)} W Qcold=${meas.qColdMeasured.toFixed(0)} W ` +
    `imbalance=${meas.measuredImbalance.toFixed(0)} W crossing=${meas.outletCrossing} ` +
    `violation=${meas.localHeatViolation}`,
);

console.log("\n[7] flow scan on v1 (cold flow 0.5..4 kg/s)");
for (const point of scan(c1.definition, "mc", linspace(0.5, 4, 5))) {
  console.log(
    `mc=${point.value.toFixed(2)} kg/s -> Q=${(point.solution.q / 1000).toFixed(3)} kW eps=${point.solution.effectiveness.toFixed(4)}`,
  );
}

console.log("\n[8] energy ledger (both-side heat duties + residuals)");
const ledger = service.ledger(c1.caseId, 50, 0);
for (const row of ledger.items as Array<Record<string, number | string>>) {
  console.log(
    `v${row.version}: Qhot=${Number(row.q_hot).toFixed(2)} Qcold=${Number(row.q_cold).toFixed(2)} ` +
      `Qlmtd=${Number(row.q_lmtd).toFixed(2)} residual=${Number(row.residual).toExponential(2)} W`,
  );
}

console.log("\n[9] failure paths are rejected with explicit codes");
for (const bad of [
  { ...balanced, mc: 0 },
  { ...balanced, cph: -1 },
  { ...balanced, thIn: 20, tcIn: 80 },
]) {
  try {
    service.createCase(bad);
  } catch (err) {
    if (isAppError(err)) console.log(`rejected: ${err.code} - ${err.message}`);
  }
}

console.log("\n[10] idempotent repeat submit does not duplicate");
const a = service.createCase({ ...balanced, name: "demo-idem" }, "demo-key");
const b = service.createCase({ ...balanced, name: "demo-idem" }, "demo-key");
console.log(`same caseId=${a.caseId === b.caseId}, total cases=${service.listCases(100, 0).total}`);

console.log("\nmodel scope:");
for (const line of modelScope()) console.log(`  - ${line}`);

db.close();
console.log(`\ndemo database left at ${dbFile} (remove with npm run clean)`);
