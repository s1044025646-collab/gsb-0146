import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  Repository,
  rowToInputs,
  rowUnits,
  type Page,
  type VersionRow,
} from "../db/repository.js";
import type { Clock } from "../db/database.js";
import { SYSTEM_CLOCK } from "../db/database.js";
import { AppError } from "../core/errors.js";
import { normalizePayload, type RawCasePayload } from "../core/normalize.js";
import { checkMeasurement, solve } from "../core/heatx.js";
import type {
  CaseDefinition,
  CaseInputs,
  FlowArrangement,
  MeasurementReport,
  MeasuredOutlets,
  Solution,
} from "../core/types.js";

export interface CreatedVersion {
  caseId: number;
  version: number;
  definition: CaseDefinition;
  solution: Solution;
  createdAt: string;
}

export interface CaseView {
  caseId: number;
  name: string;
  note?: string;
  latestVersion: number;
  inputs: CaseInputs;
  units: import("../core/units.js").UnitSet;
  changeNote?: string;
  solution: Solution;
}

export interface RevisionPayload extends RawCasePayload {
  baseVersion?: unknown;
  changeNote?: unknown;
}

function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export class CaseService {
  private readonly repo: Repository;

  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: Clock = SYSTEM_CLOCK,
  ) {
    this.repo = new Repository(db);
  }

  private iso(): string {
    return this.clock.now().toISOString();
  }

  private requireCase(id: number) {
    const c = this.repo.getCase(id);
    if (!c) throw new AppError("NOT_FOUND", `Case ${id} not found`);
    return c;
  }

  private requireVersionRow(caseId: number, version?: number): VersionRow {
    this.requireCase(caseId);
    const row =
      version === undefined
        ? this.repo.latestVersion(caseId)
        : this.repo.getVersion(caseId, version);
    if (!row) {
      throw new AppError(
        "NOT_FOUND",
        version === undefined
          ? `Case ${caseId} has no versions yet`
          : `Version ${version} of case ${caseId} not found`,
      );
    }
    return row;
  }

  private buildView(row: VersionRow): CaseView {
    const c = this.requireCase(row.case_id);
    return {
      caseId: row.case_id,
      name: c.name,
      note: c.note ?? undefined,
      latestVersion: row.version,
      inputs: rowToInputs(row),
      units: rowUnits(row),
      changeNote: row.change_note ?? undefined,
      solution: solve(rowToInputs(row)),
    };
  }

  /** Create case + version 1 atomically; repeated identical submit is idempotent. */
  createCase(payload: RawCasePayload, idempotencyKey?: string): CreatedVersion {
    const def = normalizePayload(payload);
    const hash = requestHash({ kind: "create", payload });

    if (idempotencyKey) {
      const hit = this.repo.getIdempotency(idempotencyKey);
      if (hit) {
        if (hit.request_hash !== hash) {
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key reused with a different request body",
          );
        }
        return JSON.parse(hit.response_json) as CreatedVersion;
      }
    }

    let created: CreatedVersion;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const iso = this.iso();
      const caseId = this.repo.createCase(def.name, def.note, iso);
      this.repo.insertVersion(caseId, 1, def, "initial revision", iso);
      const solution = solve(def);
      this.repo.insertLedger(caseId, 1, solution, iso);
      created = { caseId, version: 1, definition: def, solution, createdAt: iso };
      if (idempotencyKey) this.repo.putIdempotency(idempotencyKey, hash, JSON.stringify(created), iso);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return created;
  }

  /**
   * Revise a case: inputs are immutable, every change produces a new version.
   * Optimistic concurrency via baseVersion (must equal the current latest).
   */
  revise(caseId: number, payload: RevisionPayload): CreatedVersion {
    this.requireCase(caseId);
    const def = normalizePayload(payload);
    let created: CreatedVersion;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.repo.latestVersion(caseId);
      const nextVersion = current ? current.version + 1 : 1;
      if (payload.baseVersion !== undefined) {
        const base = Number(payload.baseVersion);
        if (!Number.isInteger(base)) {
          throw new AppError("VALIDATION_ERROR", "baseVersion must be an integer");
        }
        if (current && base !== current.version) {
          throw new AppError(
            "VERSION_CONFLICT",
            `baseVersion ${base} is not current latest ${current.version}`,
            { currentLatest: current.version },
          );
        }
      }
      const iso = this.iso();
      const changeNote =
        typeof payload.changeNote === "string" ? payload.changeNote : undefined;
      this.repo.insertVersion(caseId, nextVersion, def, changeNote, iso);
      const solution = solve(def);
      this.repo.insertLedger(caseId, nextVersion, solution, iso);
      created = {
        caseId,
        version: nextVersion,
        definition: def,
        solution,
        createdAt: iso,
      };
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return created;
  }

  getCase(caseId: number, version?: number): CaseView {
    return this.buildView(this.requireVersionRow(caseId, version));
  }

  listCases(limit: number, offset: number, search?: string): Page<unknown> {
    return this.repo.listCases(limit, offset, search);
  }

  listVersions(caseId: number, limit: number, offset: number): Page<VersionRow> {
    this.requireCase(caseId);
    return this.repo.listVersions(caseId, limit, offset);
  }

  solveVersion(caseId: number, version?: number): Solution {
    const row = this.requireVersionRow(caseId, version);
    return solve(rowToInputs(row));
  }

  checkMeasured(
    caseId: number,
    measured: MeasuredOutlets,
    version?: number,
  ): MeasurementReport {
    const row = this.requireVersionRow(caseId, version);
    return checkMeasurement(rowToInputs(row), measured);
  }

  ledger(caseId: number, limit: number, offset: number): Page<unknown> {
    this.requireCase(caseId);
    return this.repo.listLedger(caseId, limit, offset);
  }

  /** Recompute both arrangements with identical thermohydraulic inputs. */
  compareArrangements(caseId: number, version?: number): {
    parallel: Solution;
    counter: Solution;
    winner: FlowArrangement;
    qGainCounterW: number;
  } {
    const row = this.requireVersionRow(caseId, version);
    const base = rowToInputs(row);
    const parallel = solve({ ...base, arrangement: "parallel" });
    const counter = solve({ ...base, arrangement: "counter" });
    return {
      parallel,
      counter,
      winner: counter.q >= parallel.q ? "counter" : "parallel",
      qGainCounterW: counter.q - parallel.q,
    };
  }
}

export interface ScanPoint {
  value: number;
  solution: Solution;
}

/** Sweep one variable, holding every other input fixed. */
export function scan(
  inputs: CaseInputs,
  param: "mc" | "mh" | "area",
  values: readonly number[],
): ScanPoint[] {
  if (!["mc", "mh", "area"].includes(param)) {
    throw new AppError("VALIDATION_ERROR", "scan param must be mc, mh or area");
  }
  return values.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new AppError("VALIDATION_ERROR", `scan value ${value} must be non-negative finite`);
    }
    const next = { ...inputs, [param]: value } as CaseInputs;
    return { value, solution: solve(next) };
  });
}

export function linspace(from: number, to: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 2) {
    throw new AppError("VALIDATION_ERROR", "count must be an integer >= 2");
  }
  if (!(to > from)) throw new AppError("VALIDATION_ERROR", "scan range must have to > from");
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, i) => from + i * step);
}
