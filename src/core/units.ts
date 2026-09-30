/**
 * Unit handling. All temperatures are normalized to Celsius internally;
 * only differences/offsets are used in calculations, so temperature-scale
 * translation is invariant (see tests).
 */

export type TemperatureUnit = "C" | "K" | "F";
export type FlowUnit = "kg/s" | "kg/h" | "g/s";
export type SpecificHeatUnit = "J/(kg.K)" | "kJ/(kg.K)";
export type UUnit = "W/(m2.K)" | "kW/(m2.K)";
export type AreaUnit = "m2";
export type FoulingUnit = "(m2.K)/W";

const FLOW_TO_KG_S: Record<FlowUnit, number> = {
  "kg/s": 1,
  "kg/h": 1 / 3600,
  "g/s": 1 / 1000,
};

const CP_TO_J: Record<SpecificHeatUnit, number> = {
  "J/(kg.K)": 1,
  "kJ/(kg.K)": 1000,
};

const U_TO_W: Record<UUnit, number> = {
  "W/(m2.K)": 1,
  "kW/(m2.K)": 1000,
};

/** Convert a temperature value to Celsius. */
export function toCelsius(value: number, unit: TemperatureUnit): number {
  switch (unit) {
    case "C":
      return value;
    case "K":
      return value - 273.15;
    case "F":
      return ((value - 32) * 5) / 9;
    default: {
      const exhaustive: never = unit;
      throw new Error(`Unsupported temperature unit: ${String(exhaustive)}`);
    }
  }
}

export function flowToKgPerS(value: number, unit: FlowUnit): number {
  const factor = FLOW_TO_KG_S[unit];
  if (factor === undefined) throw new Error(`Unsupported flow unit: ${unit}`);
  return value * factor;
}

export function cpToJPerKgK(value: number, unit: SpecificHeatUnit): number {
  const factor = CP_TO_J[unit];
  if (factor === undefined) throw new Error(`Unsupported cp unit: ${unit}`);
  return value * factor;
}

export function uToWPerM2K(value: number, unit: UUnit): number {
  const factor = U_TO_W[unit];
  if (factor === undefined) throw new Error(`Unsupported U unit: ${unit}`);
  return value * factor;
}

export const TEMP_UNITS: readonly TemperatureUnit[] = ["C", "K", "F"];
export const FLOW_UNITS: readonly FlowUnit[] = ["kg/s", "kg/h", "g/s"];
export const CP_UNITS: readonly SpecificHeatUnit[] = ["J/(kg.K)", "kJ/(kg.K)"];
export const U_UNITS: readonly UUnit[] = ["W/(m2.K)", "kW/(m2.K)"];
export const AREA_UNITS: readonly AreaUnit[] = ["m2"];
export const FOULING_UNITS: readonly FoulingUnit[] = ["(m2.K)/W"];
