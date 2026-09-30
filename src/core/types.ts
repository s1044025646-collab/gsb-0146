import type { UnitSet } from "./units.js";

export type FlowArrangement = "parallel" | "counter";

/** Inputs in SI units. Temperatures in deg C (differences are scale-invariant). */
export interface CaseInputs {
  arrangement: FlowArrangement;
  thIn: number; // hot-side inlet temperature, deg C
  tcIn: number; // cold-side inlet temperature, deg C
  mh: number; // hot-side mass flow, kg/s
  mc: number; // cold-side mass flow, kg/s
  cph: number; // hot-side cp, J/kg.K
  cpc: number; // cold-side cp, J/kg.K
  uClean: number; // clean overall heat-transfer coefficient, W/m2.K
  area: number; // heat-transfer area, m2
  rfHot: number; // hot-side fouling resistance, m2.K/W
  rfCold: number; // cold-side fouling resistance, m2.K/W
}

export interface CaseDefinition extends CaseInputs {
  id?: number;
  name: string;
  note?: string;
  units: UnitSet;
}

export interface Solution {
  inputs: CaseInputs;
  ch: number; // hot capacity rate W/K
  cc: number; // cold capacity rate W/K
  cmin: number;
  cmax: number;
  cr: number; // Cmin/Cmax
  minSide: "hot" | "cold";
  uEffective: number; // fouling-adjusted U, W/m2.K
  foulingFactor: number; // rfHot + rfCold, m2.K/W
  ntu: number;
  effectiveness: number;
  qMax: number; // W
  q: number; // W (energy transferred, hot -> cold)
  thOut: number;
  tcOut: number;
  qHot: number; // W, heat given up by hot side (positive)
  qCold: number; // W, heat gained by cold side (positive)
  energyResidual: number; // qHot - qCold, W
  energyResidualRel: number; // |residual| / q, unitless
  deltaT1: number; // hot-in end terminal difference
  deltaT2: number; // hot-out end terminal difference
  lmtd: number; // counterflow-oriented LMTD from terminal differences
  qLmtd: number; // U_eff * A * F(=1) * LMTD
  lmtdResidualRel: number; // |q - qLmtd| / q
  feasible: boolean;
  warnings: string[];
}

export interface MeasuredOutlets {
  thOutMeasured: number;
  tcOutMeasured: number;
}

export interface MeasurementReport {
  qHotMeasured: number;
  qColdMeasured: number;
  measuredImbalance: number;
  measuredImbalanceRel: number;
  /** original measured values are retained; no conservation correction applied */
  retained: MeasuredOutlets;
  model: Solution;
  deltaThOut: number;
  deltaTcOut: number;
  localHeatViolation: boolean;
  violationReason?: string;
  outletCrossing: boolean;
  warnings: string[];
}
