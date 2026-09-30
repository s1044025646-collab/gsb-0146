import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  counterOutletCross,
  equalCapacityCounter,
  equalCapacityParallel,
  fouledCounter,
  hugeNtuCounter,
  mixedUnits,
  tinyNtuCounter,
} from "../src/core/fixtures.ts";
import { effectiveness, effectiveU, normalize, solve } from "../src/core/solver.ts";
import { AppError } from "../src/core/errors.ts";
import type { HxInput } from "../src/core/types.ts";

const approx = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ~ ${b} (tol ${tol})`);

describe("hand-calculated anchor", () => {
  it("equal capacity counterflow NTU=1 gives eps=0.5, outlets 80/80", () => {
    const r = solve(equalCapacityCounter);
    approx(r.effectiveness, 0.5, 1e-12);
    approx(r.q, 160000, 1e-7);
    approx(r.toutHot, 80, 1e-9);
    approx(r.toutCold, 80, 1e-9);
    assert.equal(r.cMinSide, "hot");
    approx(r.cr, 1, 1e-12);
  });

  it("equal capacity parallel gives eps=(1-e^-2)/2", () => {
    const r = solve(equalCapacityParallel);
    approx(r.effectiveness, (1 - Math.exp(-2)) / 2, 1e-12);
  });
});

describe("stable limits", () => {
  it("Cr=1 uses the limit NTU/(1+NTU) rather than 0/0", () => {
    approx(effectiveness("counter", 1, 1), 0.5, 1e-12);
    approx(effectiveness("counter", 1, 1 + 1e-12), 0.5, 1e-9);
  });

  it("NTU->0 effectiveness approaches NTU", () => {
    assert.ok(effectiveness("counter", 0, 1) === 0);
    approx(effectiveness("counter", 1e-12, 0.5), 1e-12, 1e-13);
    const r = solve(tinyNtuCounter);
    approx(r.effectiveness, r.ntu, 1e-9);
    approx(r.q, r.ntu * r.qMax, 1e-6);
  });

  it("huge NTU counterflow effectiveness approaches 1", () => {
    const r = solve(hugeNtuCounter);
    assert.ok(r.effectiveness > 0.999, `eps=${r.effectiveness}`);
    assert.ok(r.effectiveness <= 1 + 1e-12);
  });

  it("equal end differences use arithmetic-mean LMTD limit", () => {
    const r = solve(equalCapacityCounter);
    approx(r.deltaT1, r.deltaT2, 1e-9);
    approx(r.lmtd, 40, 1e-9);
  });
});

describe("fouling", () => {
  it("fouling resistances reduce effective U and duty", () => {
    const clean = solve(equalCapacityCounter);
    const dirty = solve(fouledCounter);
    approx(dirty.uEffective, effectiveU(1000, 0.0002, 0.0001), 1e-9);
    assert.ok(dirty.uEffective < dirty.uClean);
    approx(dirty.uEffective, 1 / (0.001 + 0.0003), 1e-6);
    assert.ok(dirty.q < clean.q);
  });
});

describe("counterflow outlet crossing", () => {
  it("allows cold outlet hotter than hot outlet when local dT stays positive", () => {
    const r = solve(counterOutletCross);
    assert.ok(r.outletTemperatureCross);
    assert.ok(r.toutCold > r.toutHot);
    assert.ok(r.deltaT1 > 0 && r.deltaT2 > 0);
    approx(r.lmtdResidual, 0, 1e-9);
  });
});

describe("rejections", () => {
  const bad = (patch: (h: HxInput) => void, code: string) => {
    const h = structuredClone(equalCapacityCounter);
    patch(h);
    assert.throws(() => solve(h), (e: unknown) => e instanceof AppError && e.code === code);
  };

  it("zero flow", () => bad((h) => (h.hot.m = 0), "ZERO_FLOW"));
  it("non-positive cp", () => bad((h) => (h.cold.cp = 0), "NON_POSITIVE_CP"));
  it("hot not hotter than cold", () => bad((h) => (h.cold.tin = 120), "INVALID_DRIVING_TEMPERATURE"));
  it("non-positive U", () => bad((h) => (h.u = -1), "NON_POSITIVE_U"));
  it("non-positive area", () => bad((h) => (h.area = 0), "NON_POSITIVE_AREA"));
  it("negative fouling", () => bad((h) => (h.rfHot = -0.01), "NEGATIVE_FOULING"));
  it("phase change unsupported", () => bad((h) => (h.phaseChange = true), "PHASE_CHANGE_UNSUPPORTED"));

  it("parallel outlet crossing is a local heat-flow violation", () => {
    const h = structuredClone(counterOutletCross);
    h.arrange = "parallel";
    h.area = 100;
    assert.throws(() => solve(h), (e: unknown) => e instanceof AppError && e.code === "LOCAL_HEAT_FLOW_VIOLATION");
  });
});

describe("invariants", () => {
  it("energy conservation: qHot = qCold = q", () => {
    for (const fx of [equalCapacityCounter, equalCapacityParallel, hugeNtuCounter, counterOutletCross]) {
      const r = solve(fx);
      approx(r.qHot, r.q, 1e-6 * Math.max(1, Math.abs(r.q)));
      approx(r.qCold, r.q, 1e-6 * Math.max(1, Math.abs(r.q)));
      approx(r.balanceResidual, 0, 1e-5);
    }
  });

  it("effectiveness stays within [0,1]", () => {
    for (const fx of [equalCapacityCounter, equalCapacityParallel, hugeNtuCounter, tinyNtuCounter, fouledCounter]) {
      const r = solve(fx);
      assert.ok(r.effectiveness >= 0 && r.effectiveness <= 1 + 1e-12);
    }
  });

  it("duty is monotonic non-decreasing with area", () => {
    const areas = [0.5, 1, 2, 4, 8, 16, 32];
    let prev = -Infinity;
    for (const area of areas) {
      const r = solve({ ...equalCapacityCounter, area });
      assert.ok(r.q >= prev - 1e-9, `not monotone at area=${area}`);
      prev = r.q;
    }
  });

  it("temperature-scale translation is invariant", () => {
    const kelvin: HxInput = {
      ...equalCapacityCounter,
      hot: { ...equalCapacityCounter.hot, tin: 120 + 273.15, tinUnit: "K" },
      cold: { ...equalCapacityCounter.cold, tin: 40 + 273.15, tinUnit: "K" },
    };
    const a = solve(equalCapacityCounter);
    const b = solve(kelvin);
    approx(a.q, b.q, 1e-6);
    approx(a.toutHot, b.toutHot, 1e-8);
    approx(a.toutCold, b.toutCold, 1e-8);
  });

  it("mixed units fixture normalizes to the same SI physics", () => {
    const n = normalize(mixedUnits);
    approx(n.tinHot, 120, 1e-9); // 248 F
    approx(n.tinCold, 40, 1e-9); // 104 F
    approx(n.mHot, 1, 1e-12); // 3600 kg/h
    approx(n.cpHot, 4000, 1e-9); // 4 kJ
    approx(n.uClean, 1000, 1e-9); // 1 kW
    const r = solve(mixedUnits);
    const ref = solve(equalCapacityCounter);
    approx(r.q, ref.q, 1e-6);
  });
});
