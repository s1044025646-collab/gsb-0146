import type {
  AreaUnit,
  FlowUnit,
  FoulingUnit,
  SpecificHeatUnit,
  TemperatureUnit,
  UUnit,
} from "./units.ts";

export type Arrange = "counter" | "parallel";

export interface SideInput {
  tin: number;
  tinUnit: TemperatureUnit;
  m: number;
  mUnit: FlowUnit;
  cp: number;
  cpUnit: SpecificHeatUnit;
}

export interface HxInput {
  /** Set true to declare latent/phase-change duty; always rejected. */
  phaseChange?: boolean;
  hot: SideInput;
  cold: SideInput;
  u: number;
  uUnit: UUnit;
  area: number;
  areaUnit: AreaUnit;
  rfHot: number;
  rfCold: number;
  foulingUnit: FoulingUnit;
  arrange: Arrange;
}

export interface SolveResult {
  arrange: Arrange;
  uEffective: number;
  uClean: number;
  cHot: number;
  cCold: number;
  cMin: number;
  cMax: number;
  cMinSide: "hot" | "cold";
  cr: number;
  ntu: number;
  effectiveness: number;
  qMax: number;
  q: number;
  qHot: number;
  qCold: number;
  balanceResidual: number;
  tinHot: number;
  tinCold: number;
  toutHot: number;
  toutCold: number;
  deltaT1: number;
  deltaT2: number;
  lmtd: number;
  qLmtd: number;
  lmtdResidual: number;
  outletTemperatureCross: boolean;
}

export interface CheckResult {
  measuredToutHot: number;
  measuredToutCold: number;
  qHotMeasured: number;
  qColdMeasured: number;
  imbalance: number;
  predictedToutHot: number;
  predictedToutCold: number;
  hotOutletErrorK: number;
  coldOutletErrorK: number;
  balanced: boolean;
}
