/**
 * Unit conversion to SI internals.
 *
 * Temperatures are normalised to degrees Celsius for storage/display, but all
 * driving temperature differences are affine-shift invariant, so choosing K
 * vs degC never changes heat duty, effectiveness, NTU or LMTD.
 */

export type TemperatureUnit = "C" | "K" | "F";
export type MassFlowUnit = "kg/s" | "kg/h" | "t/h" | "lb/h";
export type CpUnit = "J/kg.K" | "kJ/kg.K" | "Btu/lb.F";
export type UUnit = "W/m2.K" | "kcal/m2.h.C" | "Btu/ft2.h.F";
export type AreaUnit = "m2" | "ft2";
export type RfUnit = "m2.K/W" | "m2.h.C/kcal" | "ft2.h.F/Btu";

export const TEMPERATURE_UNITS: TemperatureUnit[] = ["C", "K", "F"];
export const MASS_FLOW_UNITS: MassFlowUnit[] = ["kg/s", "kg/h", "t/h", "lb/h"];
export const CP_UNITS: CpUnit[] = ["J/kg.K", "kJ/kg.K", "Btu/lb.F"];
export const U_UNITS: UUnit[] = ["W/m2.K", "kcal/m2.h.C", "Btu/ft2.h.F"];
export const AREA_UNITS: AreaUnit[] = ["m2", "ft2"];
export const RF_UNITS: RfUnit[] = ["m2.K/W", "m2.h.C/kcal", "ft2.h.F/Btu"];

export interface UnitSet {
  temperature: TemperatureUnit;
  massFlow: MassFlowUnit;
  cp: CpUnit;
  u: UUnit;
  area: AreaUnit;
  rf: RfUnit;
}

export const SI_UNITS: UnitSet = {
  temperature: "C",
  massFlow: "kg/s",
  cp: "J/kg.K",
  u: "W/m2.K",
  area: "m2",
  rf: "m2.K/W",
};

const MASS_FLOW_TO_KG_S: Record<MassFlowUnit, number> = {
  "kg/s": 1,
  "kg/h": 1 / 3600,
  "t/h": 1000 / 3600,
  "lb/h": 0.45359237 / 3600,
};

const CP_TO_J_KG_K: Record<CpUnit, number> = {
  "J/kg.K": 1,
  "kJ/kg.K": 1000,
  "Btu/lb.F": 4186.8,
};

const U_TO_W_M2_K: Record<UUnit, number> = {
  "W/m2.K": 1,
  "kcal/m2.h.C": 1.163,
  "Btu/ft2.h.F": 5.678263338,
};

const AREA_TO_M2: Record<AreaUnit, number> = {
  m2: 1,
  ft2: 0.09290304,
};

// fouling factor: 1 m2.h.C/kcal = 1/1.163 m2.K/W
const RF_TO_M2_K_W: Record<RfUnit, number> = {
  "m2.K/W": 1,
  "m2.h.C/kcal": 1 / 1.163,
  "ft2.h.F/Btu": 1 / 5.678263338,
};

export function toCelsius(value: number, unit: TemperatureUnit): number {
  if (unit === "C") return value;
  if (unit === "K") return value - 273.15;
  return ((value - 32) * 5) / 9;
}

export function fromCelsius(valueC: number, unit: TemperatureUnit): number {
  if (unit === "C") return valueC;
  if (unit === "K") return valueC + 273.15;
  return (valueC * 9) / 5 + 32;
}

export const massFlowToKgS = (v: number, u: MassFlowUnit) => v * MASS_FLOW_TO_KG_S[u];
export const cpToJkgK = (v: number, u: CpUnit) => v * CP_TO_J_KG_K[u];
export const uToWm2K = (v: number, u: UUnit) => v * U_TO_W_M2_K[u];
export const areaToM2 = (v: number, u: AreaUnit) => v * AREA_TO_M2[u];
export const rfToM2KW = (v: number, u: RfUnit) => v * RF_TO_M2_K_W[u];

export function isUnitSet(x: unknown): x is UnitSet {
  if (typeof x !== "object" || x === null) return false;
  const u = x as Record<string, unknown>;
  return (
    TEMPERATURE_UNITS.includes(u.temperature as TemperatureUnit) &&
    MASS_FLOW_UNITS.includes(u.massFlow as MassFlowUnit) &&
    CP_UNITS.includes(u.cp as CpUnit) &&
    U_UNITS.includes(u.u as UUnit) &&
    AREA_UNITS.includes(u.area as AreaUnit) &&
    RF_UNITS.includes(u.rf as RfUnit)
  );
}
