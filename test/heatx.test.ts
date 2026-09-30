import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMeasurement, effectiveness, logMean, solve } from "../src/core/heatx.js";
import { AppError } from "../src/core/errors.js";
import {
  balancedCounter,
  counterCrossing,
  crHalf,
  hugeNtu,
  tinyNtu,
  withFouling,
} from "./fixtures.js";

const APPROX = 1e-9;

test("balanced counterflow hand calculation (cr = 1, equal terminal differences)", () => {
  const s = solve(balancedCounter);
  assert.equal(s.minSide, "hot");
  assert.ok(Math.abs(s.cr - 1) < APPROX);
  assert.ok(Math.abs(s.ntu - 1) < APPROX);
  assert.ok(Math.abs(s.effectiveness - 0.5) < APPROX);
  assert.ok(Math.abs(s.q - 80000) < 1e-7);
  assert.ok(Math.abs(s.thOut - 80) < 1e-9);
  assert.ok(Math.abs(s.tcOut - 80) < 1e-9);
  assert.ok(Math.abs(s.deltaT1 - s.deltaT2) < APPROX);
  assert.ok(Math.abs(s.lmtd - 40) < 1e-9);
  assert.ok(Math.abs(s.qLmtd - 80000) < 1e-6);
  assert.ok(s.lmtdResidualRel < 1e-9);
  assert.ok(s.energyResidualRel < 1e-12);
});

test("balanced parallel hand calculation", () => {
  const s = solve({ ...balancedCounter, arrangement: "parallel" });
  const epsExpected = (1 - Math.exp(-2)) / 2;
  assert.ok(Math.abs(s.effectiveness - epsExpected) < APPROX);
  assert.ok(Math.abs(s.q - epsExpected * 160000) < 1e-6);
  assert.ok(s.thOut > s.tcOut);
  assert.ok(s.lmtdResidualRel < 1e-9);
});

test("cr = 0.5 counterflow closed form", () => {
  const s = solve(crHalf);
  const epsExpected =
    (1 - Math.exp(-0.5)) / (1 - 0.5 * Math.exp(-0.5));
  assert.ok(Math.abs(s.cr - 0.5) < APPROX);
  assert.ok(Math.abs(s.effectiveness - epsExpected) < 1e-12);
  assert.ok(s.lmtdResidualRel < 1e-9);
});

test("NTU -> 0 stable limit: no transfer, inlets equal outlets", () => {
  const s = solve(tinyNtu);
  assert.equal(s.ntu, 0);
  assert.ok(Math.abs(s.q) < 1e-7);
  assert.ok(Math.abs(s.thOut - 150) < 1e-9);
  assert.ok(Math.abs(s.tcOut - 30) < 1e-9);
  assert.equal(s.lmtd, 120);
});

test("effectiveness small-NTU expansion is finite and positive", () => {
  assert.ok(effectiveness("counter", 1e-13, 1) > 0);
  assert.ok(effectiveness("parallel", 1e-13, 0.3) > 0);
  assert.ok(Math.abs(effectiveness("counter", 0, 1)) < 1e-12);
});

test("huge NTU approaches effectiveness 1 with bounded outlets", () => {
  const s = solve(hugeNtu);
  assert.ok(s.ntu > 100);
  assert.ok(s.effectiveness > 0.999);
  assert.ok(s.tcOut <= 150 + 1e-9);
  assert.ok(s.thOut >= 30 - 1e-9);
  assert.ok(s.q <= s.qMax + 1e-6);
});

test("effectiveness bounds 0 <= eps <= 1 for both arrangements", () => {
  for (const arrangement of ["parallel", "counter"] as const) {
    for (const ntu of [0.01, 0.3, 1, 3, 30]) {
      for (const cr of [0, 0.25, 0.9, 1]) {
        const eps = effectiveness(arrangement, ntu, cr);
        assert.ok(eps >= 0 && eps <= 1, `${arrangement} ntu=${ntu} cr=${cr}`);
      }
    }
  }
});

test("counterflow is always at least as effective as parallel", () => {
  for (const cr of [0.1, 0.5, 0.99, 1]) {
    for (const ntu of [0.1, 1, 5]) {
      assert.ok(
        effectiveness("counter", ntu, cr) + 1e-12 >=
          effectiveness("parallel", ntu, cr),
      );
    }
  }
});

test("fouling strictly lowers U_eff, NTU, effectiveness and Q", () => {
  const clean = solve(balancedCounter);
  const fouled = solve(withFouling(balancedCounter, 0.001, 0.0005));
  const expectedU = 1 / (1 / 400 + 0.0015);
  assert.ok(Math.abs(fouled.uEffective - expectedU) < 1e-12);
  assert.ok(fouled.uEffective < clean.uEffective);
  assert.ok(fouled.ntu < clean.ntu);
  assert.ok(fouled.effectiveness < clean.effectiveness);
  assert.ok(fouled.q < clean.q);
});

test("area monotonicity: Q and eps non-decreasing with area", () => {
  let prevQ = -1;
  for (const area of [0, 0.5, 1, 2, 5, 10, 50, 500]) {
    const s = solve({ ...crHalf, area });
    assert.ok(s.q >= prevQ - 1e-9);
    prevQ = s.q;
  }
});

test("temperature-scale translation invariance", () => {
  const shifted = solve({
    ...balancedCounter,
    thIn: 120 + 273.15,
    tcIn: 40 + 273.15,
  });
  const base = solve(balancedCounter);
  for (const key of ["q", "effectiveness", "ntu", "lmtd"] as const) {
    assert.ok(Math.abs(shifted[key] - base[key]) < 1e-8 * Math.max(1, base[key]));
  }
  assert.ok(Math.abs((shifted.thOut - 273.15) - base.thOut) < 1e-8);
});

test("counterflow outlet crossing (Th,out < Tc,out) is feasible, not a violation", () => {
  const s = solve(counterCrossing);
  assert.ok(s.thOut < s.tcOut, "expect crossing");
  assert.equal(s.feasible, true);
  assert.ok(s.deltaT1 >= -1e-12 && s.deltaT2 >= -1e-12);
});

test("parallel flow crossing is infeasible at the outlet end", () => {
  // cr = 1 parallel never crosses; force cr < 1 with high area is also safe,
  // so construct a direct measurement-style check instead.
  const report = checkMeasurement(
    { ...balancedCounter, arrangement: "parallel" },
    { thOutMeasured: 70, tcOutMeasured: 90 },
  );
  assert.equal(report.outletCrossing, true);
  assert.equal(report.localHeatViolation, true);
});

test("counterflow true local violation is rejected even without outlet crossing", () => {
  const report = checkMeasurement(counterCrossing, {
    thOutMeasured: 10, // < cold inlet 20 at the cold-inlet end
    tcOutMeasured: 95,
  });
  assert.equal(report.localHeatViolation, true);
  assert.match(report.violationReason ?? "", /Counterflow/);
});

test("counterflow legal crossing measurement is accepted with imbalance retained", () => {
  const report = checkMeasurement(counterCrossing, {
    thOutMeasured: 55,
    tcOutMeasured: 60,
  });
  assert.equal(report.localHeatViolation, false);
  assert.equal(report.outletCrossing, true);
  assert.notEqual(report.measuredImbalance, 0);
  // values preserved verbatim
  assert.equal(report.retained.thOutMeasured, 55);
  assert.equal(report.retained.tcOutMeasured, 60);
});

test("rejections: zero flow, non-positive cp, inverted inlets", () => {
  assert.throws(
    () => solve({ ...balancedCounter, mc: 0 }),
    (e: unknown) => e instanceof AppError && e.code === "ZERO_FLOW",
  );
  assert.throws(
    () => solve({ ...balancedCounter, cph: -10 }),
    (e: unknown) => e instanceof AppError && e.code === "NON_POSITIVE_CP",
  );
  assert.throws(
    () => solve({ ...balancedCounter, thIn: 20, tcIn: 90 }),
    (e: unknown) => e instanceof AppError && e.code === "INVALID_TEMPERATURE_SPREAD",
  );
  assert.throws(
    () => solve({ ...balancedCounter, area: -1 }),
    (e: unknown) => e instanceof AppError && e.code === "NEGATIVE_AREA",
  );
});

test("logMean stable limits", () => {
  assert.ok(Math.abs(logMean(40, 40) - 40) < 1e-12);
  assert.equal(logMean(0, 0), 0);
  assert.ok(Math.abs(logMean(100, 50) - (50 / Math.log(2))) < 1e-10);
  assert.throws(() => logMean(-1, 10), AppError);
});
