import { solve } from "./solver.ts";
import type { HxInput, SolveResult } from "./types.ts";

export interface ScanPoint {
  value: number;
  q: number;
  effectiveness: number;
  toutHot: number;
  toutCold: number;
  uEffective: number;
  ntu: number;
}

/**
 * Sweep a parameter over an explicit list of values, returning solve points.
 * Throws on the first invalid point so the caller can surface the bad value.
 */
export function scan(
  base: HxInput,
  param: "hotM" | "coldM" | "area",
  values: readonly number[]
): ScanPoint[] {
  return values.map((value) => {
    const next: HxInput = structuredClone(base);
    if (param === "hotM") next.hot.m = value;
    else if (param === "coldM") next.cold.m = value;
    else next.area = value;
    const r: SolveResult = solve(next);
    return {
      value,
      q: r.q,
      effectiveness: r.effectiveness,
      toutHot: r.toutHot,
      toutCold: r.toutCold,
      uEffective: r.uEffective,
      ntu: r.ntu,
    };
  });
}

export interface CompareResult {
  counter: SolveResult;
  parallel: SolveResult;
  qGainCounterOverParallel: number;
  preferred: "counter" | "parallel" | "equal";
}

/** Solve the same physical exchanger in both arrangements. */
export function compareArrangements(base: HxInput): CompareResult {
  const counter = solve({ ...structuredClone(base), arrange: "counter" });
  const parallel = solve({ ...structuredClone(base), arrange: "parallel" });
  const gain = counter.q - parallel.q;
  return {
    counter,
    parallel,
    qGainCounterOverParallel: gain,
    preferred: gain > 1e-9 ? "counter" : gain < -1e-9 ? "parallel" : "equal",
  };
}

export interface EnergyLedgerEntry {
  label: string;
  value: number;
  unit: string;
}

export interface EnergyLedger {
  entries: EnergyLedgerEntry[];
  energyIn: number;
  energyOut: number;
  residual: number;
  scope: string;
}

/** Export an energy-balance ledger (steady state, no heat loss, constant cp). */
export function energyLedger(r: SolveResult): EnergyLedger {
  const entries: EnergyLedgerEntry[] = [
    { label: "Heat rejected by hot side", value: r.qHot, unit: "W" },
    { label: "Heat absorbed by cold side", value: r.qCold, unit: "W" },
    { label: "Effectiveness-NTU duty", value: r.q, unit: "W" },
    { label: "LMTD cross-check duty", value: r.qLmtd, unit: "W" },
  ];
  return {
    entries,
    energyIn: r.qHot,
    energyOut: r.qCold,
    residual: r.balanceResidual,
    scope:
      "Steady state; adiabatic to surroundings; constant specific heats; no phase change; single-pass counter/parallel flow.",
  };
}
