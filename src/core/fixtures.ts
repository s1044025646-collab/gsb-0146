import type { HxInput } from "./types.ts";

/**
 * Fictional but dimensionally consistent worked examples.
 * Water/water-like sensible fluids only; no real equipment data.
 */

// Hand calculation anchor:
// Ch = Cc = 4000 W/K, Ueff*A = 4000 W/K -> NTU = 1, Cr = 1.
// Counterflow eps = 1/(1+1) = 0.5; q = 0.5*4000*(120-40) = 160000 W.
// Th,out = 120 - 160000/4000 = 80 C; Tc,out = 40 + 160000/4000 = 80 C.
export const equalCapacityCounter: HxInput = {
  arrange: "counter",
  hot: { tin: 120, tinUnit: "C", m: 1, mUnit: "kg/s", cp: 4000, cpUnit: "J/(kg.K)" },
  cold: { tin: 40, tinUnit: "C", m: 1, mUnit: "kg/s", cp: 4000, cpUnit: "J/(kg.K)" },
  u: 1000,
  uUnit: "W/(m2.K)",
  area: 4,
  areaUnit: "m2",
  rfHot: 0,
  rfCold: 0,
  foulingUnit: "(m2.K)/W",
};

// Parallel flow, same capacity rates and NTU.
// eps = (1 - e^-2)/2 = 0.432332...
export const equalCapacityParallel: HxInput = {
  ...equalCapacityCounter,
  arrange: "parallel",
};

// Very large NTU counterflow: effectiveness -> 1 (kept below the
// local heat-flow limit where Tc,out would reach Th,in).
export const hugeNtuCounter: HxInput = {
  arrange: "counter",
  hot: { tin: 100, tinUnit: "C", m: 2, mUnit: "kg/s", cp: 2000, cpUnit: "J/(kg.K)" },
  cold: { tin: 20, tinUnit: "C", m: 1, mUnit: "kg/s", cp: 1000, cpUnit: "J/(kg.K)" },
  u: 1000,
  uUnit: "W/(m2.K)",
  area: 40,
  areaUnit: "m2",
  rfHot: 0,
  rfCold: 0,
  foulingUnit: "(m2.K)/W",
};

// Near-zero NTU: tiny area -> eps ~ NTU.
export const tinyNtuCounter: HxInput = {
  ...equalCapacityCounter,
  area: 1e-6,
};

// Fouling reduces effective U (same geometry/clean U).
export const fouledCounter: HxInput = {
  ...equalCapacityCounter,
  rfHot: 0.0002,
  rfCold: 0.0001,
};

// Counterflow outlet temperature cross (cold outlet hotter than hot outlet),
// which is physically valid for counterflow.
export const counterOutletCross: HxInput = {
  arrange: "counter",
  hot: { tin: 150, tinUnit: "C", m: 1, mUnit: "kg/s", cp: 2000, cpUnit: "J/(kg.K)" },
  cold: { tin: 30, tinUnit: "C", m: 4, mUnit: "kg/s", cp: 1000, cpUnit: "J/(kg.K)" },
  u: 800,
  uUnit: "W/(m2.K)",
  area: 6,
  areaUnit: "m2",
  rfHot: 0,
  rfCold: 0,
  foulingUnit: "(m2.K)/W",
};

// Mixed units: kg/h hot flow, kJ cp, Fahrenheit inlets, kW U.
export const mixedUnits: HxInput = {
  arrange: "counter",
  hot: { tin: 248, tinUnit: "F", m: 3600, mUnit: "kg/h", cp: 4.0, cpUnit: "kJ/(kg.K)" },
  cold: { tin: 104, tinUnit: "F", m: 1, mUnit: "kg/s", cp: 4000, cpUnit: "J/(kg.K)" },
  u: 1,
  uUnit: "kW/(m2.K)",
  area: 4,
  areaUnit: "m2",
  rfHot: 0,
  rfCold: 0,
  foulingUnit: "(m2.K)/W",
};

export const allFixtures: Record<string, HxInput> = {
  equalCapacityCounter,
  equalCapacityParallel,
  hugeNtuCounter,
  tinyNtuCounter,
  fouledCounter,
  counterOutletCross,
  mixedUnits,
};
