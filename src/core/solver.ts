import { AppError } from "./errors.ts";
import {
  cpToJPerKgK,
  flowToKgPerS,
  toCelsius,
  uToWPerM2K,
} from "./units.ts";
import type { CheckResult, HxInput, SolveResult } from "./types.ts";

const EPS = 1e-9;

export interface Normalized {
  tinHot: number;
  tinCold: number;
  cHot: number;
  cCold: number;
  mHot: number;
  mCold: number;
  cpHot: number;
  cpCold: number;
  uClean: number;
  area: number;
  rfHot: number;
  rfCold: number;
  arrange: "counter" | "parallel";
}

/** Validate inputs and normalize everything to SI (Celsius, kg/s, J/kgK, W). */
export function normalize(input: HxInput): Normalized {
  const arrange = input.arrange;
  if (input.phaseChange === true) {
    throw new AppError(
      "PHASE_CHANGE_UNSUPPORTED",
      "Phase change / latent duty is outside the sensible-heat model scope."
    );
  }
  if (arrange !== "counter" && arrange !== "parallel") {
    throw new AppError("INVALID_ARRANGE", `Unsupported arrangement: ${String(arrange)}`);
  }

  const mHot = flowToKgPerS(input.hot.m, input.hot.mUnit);
  const mCold = flowToKgPerS(input.cold.m, input.cold.mUnit);
  if (!Number.isFinite(mHot) || !Number.isFinite(mCold)) {
    throw new AppError("VALIDATION_ERROR", "Mass flow must be finite numbers.");
  }
  if (mHot <= 0) {
    throw new AppError("ZERO_FLOW", "Hot-side mass flow must be strictly positive.", { side: "hot" });
  }
  if (mCold <= 0) {
    throw new AppError("ZERO_FLOW", "Cold-side mass flow must be strictly positive.", { side: "cold" });
  }

  const cpHot = cpToJPerKgK(input.hot.cp, input.hot.cpUnit);
  const cpCold = cpToJPerKgK(input.cold.cp, input.cold.cpUnit);
  if (!Number.isFinite(cpHot) || !Number.isFinite(cpCold)) {
    throw new AppError("VALIDATION_ERROR", "Specific heat must be finite numbers.");
  }
  if (cpHot <= 0) {
    throw new AppError("NON_POSITIVE_CP", "Hot-side specific heat must be positive.", { side: "hot" });
  }
  if (cpCold <= 0) {
    throw new AppError("NON_POSITIVE_CP", "Cold-side specific heat must be positive.", { side: "cold" });
  }

  const uClean = uToWPerM2K(input.u, input.uUnit);
  if (!Number.isFinite(uClean)) throw new AppError("VALIDATION_ERROR", "U must be finite.");
  if (uClean <= 0) {
    throw new AppError("NON_POSITIVE_U", "Overall heat-transfer coefficient must be positive.");
  }
  const area = input.area;
  if (!Number.isFinite(area)) throw new AppError("VALIDATION_ERROR", "Area must be finite.");
  if (area <= 0) {
    throw new AppError("NON_POSITIVE_AREA", "Heat-transfer area must be positive.");
  }
  const rfHot = input.rfHot;
  const rfCold = input.rfCold;
  if (!Number.isFinite(rfHot) || !Number.isFinite(rfCold)) {
    throw new AppError("VALIDATION_ERROR", "Fouling resistances must be finite.");
  }
  if (rfHot < 0 || rfCold < 0) {
    throw new AppError("NEGATIVE_FOULING", "Fouling resistances cannot be negative.");
  }

  const tinHot = toCelsius(input.hot.tin, input.hot.tinUnit);
  const tinCold = toCelsius(input.cold.tin, input.cold.tinUnit);
  if (!Number.isFinite(tinHot) || !Number.isFinite(tinCold)) {
    throw new AppError("VALIDATION_ERROR", "Inlet temperatures must be finite.");
  }
  if (tinHot <= tinCold) {
    throw new AppError(
      "INVALID_DRIVING_TEMPERATURE",
      "Hot inlet must be strictly hotter than cold inlet (sensible-heat model)."
    );
  }

  const cHot = mHot * cpHot;
  const cCold = mCold * cpCold;

  return {
    tinHot,
    tinCold,
    cHot,
    cCold,
    mHot,
    mCold,
    cpHot,
    cpCold,
    uClean,
    area,
    rfHot,
    rfCold,
    arrange,
  };
}

/** Effective U after combining hot and cold fouling resistances. */
export function effectiveU(uClean: number, rfHot: number, rfCold: number): number {
  return 1 / (1 / uClean + rfHot + rfCold);
}

/**
 * Effectiveness as a function of NTU and capacity-rate ratio Cr.
 * Stable limits are used for Cr -> 1 and NTU -> 0.
 */
export function effectiveness(
  arrange: "counter" | "parallel",
  ntu: number,
  cr: number
): number {
  if (ntu < 0) throw new AppError("VALIDATION_ERROR", "NTU cannot be negative.");

  // NTU -> 0: eps ~= NTU for both arrangements (single-pass).
  if (ntu <= EPS) {
    return ntu;
  }

  if (arrange === "parallel") {
    // eps = (1 - exp(-NTU(1+Cr))) / (1+Cr)
    const denom = 1 + cr;
    if (denom <= EPS) return ntu; // cr >= 0 so this is only cr ~ 0
    return (1 - Math.exp(-ntu * denom)) / denom;
  }

  // counterflow
  if (Math.abs(cr - 1) <= 1e-9) {
    // Cr = 1 stable limit: eps = NTU / (1 + NTU)
    return ntu / (1 + ntu);
  }
  const num = 1 - Math.exp(-ntu * (1 - cr));
  const den = 1 - cr * Math.exp(-ntu * (1 - cr));
  return num / den;
}

function logMean(a: number, b: number): number {
  if (a <= 0 || b <= 0) {
    throw new AppError(
      "LOCAL_HEAT_FLOW_VIOLATION",
      "Non-positive end temperature difference: local heat-flow direction violated.",
      { deltaT1: a, deltaT2: b }
    );
  }
  const rel = Math.abs(a - b) / Math.max(a, b);
  if (rel <= 1e-8) {
    // Equal end differences -> arithmetic mean is the stable LMTD limit.
    return (a + b) / 2;
  }
  return (a - b) / Math.log(a / b);
}

/** Solve the exchanger with the effectiveness-NTU method and cross-check via LMTD. */
export function solve(input: HxInput): SolveResult {
  const n = normalize(input);
  const { cHot, cCold, tinHot, tinCold } = n;

  const cMinSide = cHot <= cCold ? "hot" : "cold";
  const cMin = Math.min(cHot, cCold);
  const cMax = Math.max(cHot, cCold);
  const cr = cMin / cMax;

  const uEffective = effectiveU(n.uClean, n.rfHot, n.rfCold);
  const ntu = (uEffective * n.area) / cMin;

  const eps = effectiveness(n.arrange, ntu, cr);
  const qMax = cMin * (tinHot - tinCold);
  const q = eps * qMax;

  const toutHot = tinHot - q / cHot;
  const toutCold = tinCold + q / cCold;

  const qHot = cHot * (tinHot - toutHot);
  const qCold = cCold * (toutCold - tinCold);
  const balanceResidual = qHot - qCold;

  // End temperature differences along the exchanger.
  let deltaT1: number;
  let deltaT2: number;
  if (n.arrange === "parallel") {
    deltaT1 = tinHot - tinCold; // hot inlet vs cold inlet end
    deltaT2 = toutHot - toutCold; // hot outlet vs cold outlet end
  } else {
    deltaT1 = tinHot - toutCold; // hot inlet end
    deltaT2 = toutHot - tinCold; // cold inlet end
  }

  // Counterflow outlet crossing (Tcold,out > Thot,out) is physically allowed.
  // Distinguish it from a true local heat-flow violation (end dT <= 0).
  const outletTemperatureCross = toutCold > toutHot;
  if (n.arrange === "parallel" && outletTemperatureCross) {
    throw new AppError(
      "LOCAL_HEAT_FLOW_VIOLATION",
      "Parallel-flow cold outlet cannot exceed hot outlet.",
      { toutHot, toutCold }
    );
  }

  const lmtd = logMean(deltaT1, deltaT2);
  const qLmtd = uEffective * n.area * lmtd;
  const lmtdResidual = q > 0 ? Math.abs(q - qLmtd) / q : Math.abs(q - qLmtd);

  return {
    arrange: n.arrange,
    uEffective,
    uClean: n.uClean,
    cHot,
    cCold,
    cMin,
    cMax,
    cMinSide,
    cr,
    ntu,
    effectiveness: eps,
    qMax,
    q,
    qHot,
    qCold,
    balanceResidual,
    tinHot,
    tinCold,
    toutHot,
    toutCold,
    deltaT1,
    deltaT2,
    lmtd,
    qLmtd,
    lmtdResidual,
    outletTemperatureCross,
  };
}

/**
 * Compare measured outlets against the model prediction.
 * Measured values are retained as given; energy imbalance is reported,
 * never silently corrected to enforce conservation.
 */
export function checkMeasured(
  input: HxInput,
  measuredToutHot: number,
  measuredToutCold: number,
  toleranceW = 1e-6
): CheckResult {
  const n = normalize(input);
  const predicted = solve(input);

  const qHotMeasured = n.cHot * (n.tinHot - measuredToutHot);
  const qColdMeasured = n.cCold * (measuredToutCold - n.tinCold);
  const imbalance = qHotMeasured - qColdMeasured;

  return {
    measuredToutHot,
    measuredToutCold,
    qHotMeasured,
    qColdMeasured,
    imbalance,
    predictedToutHot: predicted.toutHot,
    predictedToutCold: predicted.toutCold,
    hotOutletErrorK: measuredToutHot - predicted.toutHot,
    coldOutletErrorK: measuredToutCold - predicted.toutCold,
    balanced: Math.abs(imbalance) <= toleranceW * Math.max(1, Math.abs(qHotMeasured)),
  };
}
