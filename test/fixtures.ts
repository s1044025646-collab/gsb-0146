import type { CaseInputs } from "../src/core/types.js";

/**
 * Fictitious worked examples (no real plant data). All SI units.
 *
 * Hand-check of `balanced`: Ch = Cc = 2000 W/K, U*A = 2000 W/K, NTU = 1.
 * Counterflow cr=1: eps = NTU/(1+NTU) = 0.5
 *   Q = 0.5 * 2000 * 80 = 80000 W
 *   Th,out = 120 - 80000/2000 = 80 C
 *   Tc,out = 40 + 80000/2000 = 80 C
 *   dT1 = dT2 = 40 K -> LMTD = 40 K -> Q_LMTD = 80000 W exactly.
 * Parallel cr=1: eps = (1 - e^-2)/2 = 0.43233236
 *   Q = 69173.18 W, Th,out = 85.4134, Tc,out = 74.5866 C.
 */

export const balancedCounter: CaseInputs = {
  arrangement: "counter",
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

/** Unequal capacity rates, cr = 0.5, NTU = 1 (counterflow). */
export const crHalf: CaseInputs = {
  arrangement: "counter",
  thIn: 100,
  tcIn: 20,
  mh: 1,
  mc: 1,
  cph: 1000,
  cpc: 2000,
  uClean: 500,
  area: 2,
  rfHot: 0,
  rfCold: 0,
};

/** Very large NTU counterflow: effectiveness -> 1, cold outlet approaches hot inlet. */
export const hugeNtu: CaseInputs = {
  arrangement: "counter",
  thIn: 150,
  tcIn: 30,
  mh: 1,
  mc: 1,
  cph: 1000,
  cpc: 1000,
  uClean: 1000,
  area: 1000,
  rfHot: 0,
  rfCold: 0,
};

/** NTU -> 0: vanishing area, no heat transfer. */
export const tinyNtu: CaseInputs = {
  arrangement: "counter",
  thIn: 150,
  tcIn: 30,
  mh: 1,
  mc: 2,
  cph: 1000,
  cpc: 1000,
  uClean: 1000,
  area: 0,
  rfHot: 0,
  rfCold: 0,
};

/** Counterflow case where Th,out < Tc,out (legal outlet crossing). */
export const counterCrossing: CaseInputs = {
  arrangement: "counter",
  thIn: 100,
  tcIn: 20,
  mh: 1,
  mc: 1,
  cph: 1000, // Cmin = hot = 1000
  cpc: 4000, // cr = 0.25
  uClean: 300,
  area: 20, // NTU = 6 -> eps high
  rfHot: 0,
  rfCold: 0,
};

export function withFouling(base: CaseInputs, rfHot: number, rfCold: number): CaseInputs {
  return { ...base, rfHot, rfCold };
}
