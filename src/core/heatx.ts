import { AppError } from "./errors.js";
import type { ErrorCode } from "./errors.js";
import type {
  CaseInputs,
  MeasurementReport,
  MeasuredOutlets,
  Solution,
} from "./types.js";

const EPS = 1e-12;

/** Numerically stable (1 - exp(-x)) / x -> 1 as x -> 0. */
function oneMinusExpOverX(x: number): number {
  if (x < 1e-4) return 1 - x / 2 + (x * x) / 6;
  return -Math.expm1(-x) / x;
}

/** (exp(x) - 1) / x -> 1 as x -> 0. */
function expm1OverX(x: number): number {
  if (Math.abs(x) < 1e-4) return 1 + x / 2 + (x * x) / 6;
  return Math.expm1(x) / x;
}

/**
 * Stable logarithmic mean of two non-negative terminal differences:
 * (a - b) / ln(a/b), with a == b -> a, and (0,0) -> 0.
 */
export function logMean(a: number, b: number): number {
  if (a < -EPS || b < -EPS) {
    throw new AppError(
      "LOCAL_HEAT_FLOW_VIOLATION",
      "Negative terminal temperature difference: local heat-flow direction violated",
      { deltaTA: a, deltaTB: b },
    );
  }
  const aa = Math.max(0, a);
  const bb = Math.max(0, b);
  if (aa === 0 && bb === 0) return 0;
  if (Math.abs(aa - bb) <= 1e-7 * Math.max(1, aa, bb)) return (aa + bb) / 2;
  return (aa - bb) / Math.log(aa / bb);
}

/** Effectiveness of a pure parallel or counterflow recuperative exchanger. */
export function effectiveness(
  arrangement: CaseInputs["arrangement"],
  ntu: number,
  cr: number,
): number {
  if (ntu <= EPS) return ntu; // NTU -> 0 limit: epsilon -> 0 (slope 1)
  if (cr <= EPS) {
    // cr -> 0: one side behaves as an isothermal reservoir (no finite phase
    // change is modelled; this is only the limit of strongly unbalanced cp).
    // Both arrangements collapse to epsilon = 1 - exp(-NTU).
    void arrangement;
    return -Math.expm1(-ntu);
  }
  if (Math.abs(cr - 1) < 1e-9) {
    // cr -> 1 limits
    if (arrangement === "parallel") {
      // epsilon = (1 - exp(-2 NTU)) / 2
      return -Math.expm1(-2 * ntu) / 2;
    }
    // counterflow: epsilon = NTU / (1 + NTU)
    return ntu / (1 + ntu);
  }
  if (arrangement === "parallel") {
    // epsilon = [1 - exp(-NTU(1+Cr))] / (1+Cr)
    return -Math.expm1(-ntu * (1 + cr)) / (1 + cr);
  }
  // counterflow:
  // epsilon = [1 - exp(-NTU(1-Cr))] / [1 - Cr exp(-NTU(1-Cr))]
  const d = (1 - cr) * ntu;
  if (d < 1e-7) {
    // stable expansion near Cr=1 to avoid 0/0
    const e = -Math.expm1(-d);
    return e / (1 - cr * Math.exp(-d));
  }
  const e = -Math.expm1(-d);
  return e / (1 - cr * Math.exp(-d));
}

export function validateInputs(raw: CaseInputs): void {
  const fail = (
    code: ErrorCode,
    message: string,
    details?: unknown,
  ) => {
    throw new AppError(code, message, details);
  };

  if (raw.arrangement !== "parallel" && raw.arrangement !== "counter") {
    fail("VALIDATION_ERROR", "arrangement must be 'parallel' or 'counter'");
  }
  for (const [k, v] of Object.entries({
    thIn: raw.thIn,
    tcIn: raw.tcIn,
    mh: raw.mh,
    mc: raw.mc,
    cph: raw.cph,
    cpc: raw.cpc,
    uClean: raw.uClean,
    area: raw.area,
  })) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      fail("VALIDATION_ERROR", `${k} must be a finite number`, { field: k });
    }
  }
  if (raw.mh <= 0 || raw.mc <= 0) {
    fail("ZERO_FLOW", "Mass flow on both sides must be strictly positive", {
      mh: raw.mh,
      mc: raw.mc,
    });
  }
  if (raw.cph <= 0 || raw.cpc <= 0) {
    fail("NON_POSITIVE_CP", "Specific heat capacities must be strictly positive (constant cp model; phase change unsupported)");
  }
  if (!(raw.thIn > raw.tcIn)) {
    fail(
      "INVALID_TEMPERATURE_SPREAD",
      "Hot-side inlet must be strictly hotter than cold-side inlet for heat to flow hot -> cold",
      { thIn: raw.thIn, tcIn: raw.tcIn },
    );
  }
  if (raw.uClean <= 0) fail("NON_POSITIVE_U", "Clean overall heat-transfer coefficient U must be positive");
  if (raw.area < 0) fail("NEGATIVE_AREA", "Area must be non-negative");
  if (raw.rfHot < 0 || raw.rfCold < 0) {
    fail("NEGATIVE_FOULING", "Fouling resistances must be non-negative");
  }
}

export function solve(raw: CaseInputs): Solution {
  validateInputs(raw);
  const warnings: string[] = [];

  const ch = raw.mh * raw.cph;
  const cc = raw.mc * raw.cpc;
  let cmin: number, cmax: number, minSide: "hot" | "cold";
  if (ch <= cc) {
    cmin = ch;
    cmax = cc;
    minSide = "hot";
  } else {
    cmin = cc;
    cmax = ch;
    minSide = "cold";
  }
  const cr = cmax > 0 ? cmin / cmax : 0;

  // Fouling reduces the effective overall coefficient:
  // 1/U_eff = 1/U_clean + Rf,hot + Rf,cold
  const rf = raw.rfHot + raw.rfCold;
  const uEffective = 1 / (1 / raw.uClean + rf);
  if (rf > 0 && uEffective < 0.5 * raw.uClean) {
    warnings.push("Fouling reduces effective U to less than 50% of clean U");
  }

  const ntu = cmin > 0 ? (uEffective * raw.area) / cmin : 0;
  if (ntu === 0) warnings.push("NTU is zero (zero area): no heat transfer");
  if (ntu > 10) warnings.push("NTU > 10: exchanger is very large; effectiveness near its asymptote");

  const eps = effectiveness(raw.arrangement, ntu, cr);
  const qMax = cmin * (raw.thIn - raw.tcIn);
  const q = eps * qMax;

  const thOut = raw.thIn - q / ch;
  const tcOut = raw.tcIn + q / cc;

  const qHot = raw.mh * raw.cph * (raw.thIn - thOut);
  const qCold = raw.mc * raw.cpc * (tcOut - raw.tcIn);
  const energyResidual = qHot - qCold;
  const energyResidualRel = q > 0 ? Math.abs(energyResidual) / q : 0;

  // Terminal differences (counterflow orientation for LMTD; arrangement only
  // affects epsilon via the flow correction already implicit).
  // Terminal differences must pair the streams at the SAME physical end:
  // parallel: inlet-end and outlet-end co-located pairs;
  // counter:  hot-inlet/cold-outlet and hot-outlet/cold-inlet pairs.
  const deltaT1 =
    raw.arrangement === "parallel"
      ? raw.thIn - raw.tcIn
      : raw.thIn - tcOut;
  const deltaT2 =
    raw.arrangement === "parallel"
      ? thOut - tcOut
      : thOut - raw.tcIn;

  let feasible = true;
  if (raw.arrangement === "parallel") {
    // In parallel flow both streams travel in the same direction, so at the
    // outlet end the local difference Th,out - Tc,out must remain >= 0.
    if (thOut < tcOut - EPS) {
      feasible = false;
      warnings.push(
        "Parallel-flow local heat-flow violation: hot outlet below cold outlet",
      );
    }
  }
  // Counterflow allows Th,out < Tc,out (outlet crossing) — the streams never
  // meet at that end physically — as long as each terminal difference above
  // stays non-negative, which the eps-NTU solution guarantees here.
  if (deltaT1 < -EPS || deltaT2 < -EPS) {
    feasible = false;
    warnings.push("Negative terminal difference indicates local heat-flow violation");
  }

  const lmtd = logMean(Math.max(0, deltaT1), Math.max(0, deltaT2));
  const qLmtd = uEffective * raw.area * lmtd;
  const lmtdResidualRel = q > 0 ? Math.abs(q - qLmtd) / q : qLmtd === 0 ? 0 : 1;

  return {
    inputs: { ...raw },
    ch,
    cc,
    cmin,
    cmax,
    cr,
    minSide,
    uEffective,
    foulingFactor: rf,
    ntu,
    effectiveness: eps,
    qMax,
    q,
    thOut,
    tcOut,
    qHot,
    qCold,
    energyResidual,
    energyResidualRel,
    deltaT1,
    deltaT2,
    lmtd,
    qLmtd,
    lmtdResidualRel,
    feasible,
    warnings,
  };
}

/**
 * Compare measured outlets against the model. Measured values are kept as-is:
 * an energy imbalance is reported, never silently corrected to satisfy
 * conservation.
 */
export function checkMeasurement(
  inputs: CaseInputs,
  measured: MeasuredOutlets,
): MeasurementReport {
  const model = solve(inputs);
  const warnings: string[] = [];

  for (const [k, v] of [
    ["thOutMeasured", measured.thOutMeasured],
    ["tcOutMeasured", measured.tcOutMeasured],
  ] as const) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new AppError("VALIDATION_ERROR", `${k} must be a finite number`);
    }
  }

  const qHotMeasured = inputs.mh * inputs.cph * (inputs.thIn - measured.thOutMeasured);
  const qColdMeasured = inputs.mc * inputs.cpc * (measured.tcOutMeasured - inputs.tcIn);
  const measuredImbalance = qHotMeasured - qColdMeasured;
  const denom = Math.max(Math.abs(qHotMeasured), Math.abs(qColdMeasured), EPS);
  const measuredImbalanceRel = Math.abs(measuredImbalance) / denom;
  if (measuredImbalanceRel > 0.02) {
    warnings.push(
      "Measured energy imbalance exceeds 2%: check instruments, insulation or steady-state assumption",
    );
  }

  // Local heat-flow direction checks — distinct from mere outlet crossing.
  let localHeatViolation = false;
  let violationReason: string | undefined;
  if (measured.thOutMeasured > inputs.thIn + EPS) {
    localHeatViolation = true;
    violationReason = "Measured hot outlet hotter than hot inlet: heat would need to flow cold -> hot";
  }
  if (measured.tcOutMeasured < inputs.tcIn - EPS) {
    localHeatViolation = true;
    violationReason = "Measured cold outlet colder than cold inlet";
  }
  if (inputs.arrangement === "parallel" && measured.thOutMeasured < measured.tcOutMeasured - EPS) {
    localHeatViolation = true;
    violationReason =
      "Parallel flow: measured hot outlet below cold outlet violates local heat-flow direction";
  }
  // Counterflow terminal constraints (the physically co-located pairs):
  if (inputs.arrangement === "counter") {
    if (inputs.thIn < measured.tcOutMeasured - EPS) {
      localHeatViolation = true;
      violationReason = "Counterflow: cold outlet exceeds hot inlet at the same end";
    }
    if (measured.thOutMeasured < inputs.tcIn - EPS) {
      localHeatViolation = true;
      violationReason = "Counterflow: hot outlet below cold inlet at the same end";
    }
  }

  // Outlet crossing: legal in counterflow, illegal in parallel.
  const outletCrossing = measured.thOutMeasured < measured.tcOutMeasured;
  if (outletCrossing && inputs.arrangement === "counter" && !localHeatViolation) {
    warnings.push(
      "Counterflow outlet crossing (Th,out < Tc,out) is physically allowed",
    );
  }

  return {
    qHotMeasured,
    qColdMeasured,
    measuredImbalance,
    measuredImbalanceRel,
    retained: { ...measured },
    model,
    deltaThOut: measured.thOutMeasured - model.thOut,
    deltaTcOut: measured.tcOutMeasured - model.tcOut,
    localHeatViolation,
    violationReason,
    outletCrossing,
    warnings,
  };
}

/** Applicability envelope of the constant-cp, steady-state model. */
export function modelScope(): string[] {
  return [
    "Steady-state operation only",
    "No heat loss to surroundings (adiabatic shell)",
    "Constant specific heat capacities; no phase change",
    "Single-pass parallel or counterflow arrangement (correction factor F = 1)",
    "No axial conduction, no ambient kinetic/potential energy effects",
    "Fouling represented as additive uniform wall resistances",
  ];
}
