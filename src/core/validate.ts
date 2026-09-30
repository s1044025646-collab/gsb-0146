import { AppError } from "./errors.ts";
import {
  AREA_UNITS,
  CP_UNITS,
  FLOW_UNITS,
  FOULING_UNITS,
  TEMP_UNITS,
  U_UNITS,
  type AreaUnit,
  type FlowUnit,
  type FoulingUnit,
  type SpecificHeatUnit,
  type TemperatureUnit,
  type UUnit,
} from "./units.ts";
import type { HxInput, SideInput } from "./types.ts";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new AppError("VALIDATION_ERROR", `${path} must be a finite number.`, { path, received: v });
  }
  return v;
}

function oneOf<T extends string>(
  v: unknown,
  allowed: readonly T[],
  path: string
): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new AppError("VALIDATION_ERROR", `${path} must be one of: ${allowed.join(", ")}.`, {
      path,
      received: v,
    });
  }
  return v as T;
}

export function validateSide(raw: unknown, label: "hot" | "cold"): SideInput {
  if (!isRecord(raw)) {
    throw new AppError("VALIDATION_ERROR", `${label} side must be an object.`);
  }
  return {
    tin: num(raw.tin, `${label}.tin`),
    tinUnit: oneOf(raw.tinUnit as TemperatureUnit, TEMP_UNITS, `${label}.tinUnit`),
    m: num(raw.m, `${label}.m`),
    mUnit: oneOf(raw.mUnit as FlowUnit, FLOW_UNITS, `${label}.mUnit`),
    cp: num(raw.cp, `${label}.cp`),
    cpUnit: oneOf(raw.cpUnit as SpecificHeatUnit, CP_UNITS, `${label}.cpUnit`),
  };
}

/** Parse and structurally validate a raw payload into HxInput (physics checks happen in solver). */
export function validateHxInput(raw: unknown): HxInput {
  if (!isRecord(raw)) {
    throw new AppError("VALIDATION_ERROR", "Request body must be an object.");
  }
  const arrange = oneOf(raw.arrange, ["counter", "parallel"] as const, "arrange");
  return {
    hot: validateSide(raw.hot, "hot"),
    cold: validateSide(raw.cold, "cold"),
    u: num(raw.u, "u"),
    uUnit: oneOf(raw.uUnit as UUnit, U_UNITS, "uUnit"),
    area: num(raw.area, "area"),
    areaUnit: oneOf(raw.areaUnit as AreaUnit, AREA_UNITS, "areaUnit"),
    rfHot: raw.rfHot === undefined ? 0 : num(raw.rfHot, "rfHot"),
    rfCold: raw.rfCold === undefined ? 0 : num(raw.rfCold, "rfCold"),
    foulingUnit: oneOf(
      raw.foulingUnit ?? "(m2.K)/W",
      FOULING_UNITS,
      "foulingUnit"
    ),
    arrange,
    phaseChange: raw.phaseChange === true,
  };
}

export interface Pagination {
  limit: number;
  offset: number;
}

export function validatePagination(searchParams: URLSearchParams): Pagination {
  const limitRaw = searchParams.get("limit") ?? "50";
  const offsetRaw = searchParams.get("offset") ?? "0";
  const limit = Number(limitRaw);
  const offset = Number(offsetRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new AppError("INVALID_PAGINATION", "limit must be an integer in [1, 200].");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new AppError("INVALID_PAGINATION", "offset must be a non-negative integer.");
  }
  return { limit, offset };
}
