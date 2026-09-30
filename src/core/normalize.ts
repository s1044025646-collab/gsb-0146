import { AppError } from "./errors.js";
import {
  SI_UNITS,
  areaToM2,
  cpToJkgK,
  isUnitSet,
  massFlowToKgS,
  rfToM2KW,
  toCelsius,
  uToWm2K,
  type UnitSet,
} from "./units.js";
import type { CaseDefinition, CaseInputs, FlowArrangement } from "./types.js";

/** Raw API payload, values are expressed in the declared units. */
export interface RawCasePayload {
  name?: unknown;
  note?: unknown;
  arrangement?: unknown;
  thIn?: unknown;
  tcIn?: unknown;
  mh?: unknown;
  mc?: unknown;
  cph?: unknown;
  cpc?: unknown;
  uClean?: unknown;
  area?: unknown;
  rfHot?: unknown;
  rfCold?: unknown;
  units?: unknown;
}

type NumField =
  | "thIn" | "tcIn" | "mh" | "mc"
  | "cph" | "cpc" | "uClean" | "area";

const NUM_FIELDS: readonly NumField[] = [
  "thIn", "tcIn", "mh", "mc", "cph", "cpc", "uClean", "area",
];

function readNum(payload: RawCasePayload, key: NumField, errors: string[]): number {
  const val = payload[key];
  if (typeof val !== "number" || !Number.isFinite(val)) {
    errors.push(`${key} must be a finite number`);
    return NaN;
  }
  return val;
}

export function normalizePayload(payload: RawCasePayload): CaseDefinition {
  const errors: string[] = [];
  const name =
    typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : "";
  if (!name) errors.push("name is required");

  if (payload.arrangement !== "parallel" && payload.arrangement !== "counter") {
    errors.push("arrangement must be 'parallel' or 'counter'");
  }

  let units: UnitSet = SI_UNITS;
  if (payload.units !== undefined && payload.units !== null) {
    if (!isUnitSet(payload.units)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "units must be a complete valid unit set",
        payload.units,
      );
    }
    units = payload.units;
  }

  const nums = {} as Record<NumField, number>;
  for (const field of NUM_FIELDS) nums[field] = readNum(payload, field, errors);

  const rfHot = payload.rfHot === undefined ? 0 : payload.rfHot;
  const rfCold = payload.rfCold === undefined ? 0 : payload.rfCold;
  if (typeof rfHot !== "number" || !Number.isFinite(rfHot) || rfHot < 0) {
    errors.push("rfHot must be a non-negative finite number");
  }
  if (typeof rfCold !== "number" || !Number.isFinite(rfCold) || rfCold < 0) {
    errors.push("rfCold must be a non-negative finite number");
  }

  if (errors.length) {
    throw new AppError("VALIDATION_ERROR", errors.join("; "), errors);
  }

  const inputs: CaseInputs = {
    arrangement: payload.arrangement as FlowArrangement,
    thIn: toCelsius(nums.thIn, units.temperature),
    tcIn: toCelsius(nums.tcIn, units.temperature),
    mh: massFlowToKgS(nums.mh, units.massFlow),
    mc: massFlowToKgS(nums.mc, units.massFlow),
    cph: cpToJkgK(nums.cph, units.cp),
    cpc: cpToJkgK(nums.cpc, units.cp),
    uClean: uToWm2K(nums.uClean, units.u),
    area: areaToM2(nums.area, units.area),
    rfHot: rfToM2KW(rfHot as number, units.rf),
    rfCold: rfToM2KW(rfCold as number, units.rf),
  };

  return {
    name,
    note: typeof payload.note === "string" ? payload.note : undefined,
    units,
    ...inputs,
  };
}
