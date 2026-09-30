import type { DatabaseSync } from "node:sqlite";
import type { CaseDefinition, CaseInputs } from "../core/types.js";
import type { UnitSet } from "../core/units.js";

export interface CaseRow {
  id: number;
  name: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: number;
  case_id: number;
  version: number;
  arrangement: "parallel" | "counter";
  th_in: number;
  tc_in: number;
  mh: number;
  mc: number;
  cph: number;
  cpc: number;
  u_clean: number;
  area: number;
  rf_hot: number;
  rf_cold: number;
  units_json: string;
  change_note: string | null;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function rowToInputs(row: VersionRow): CaseInputs {
  return {
    arrangement: row.arrangement,
    thIn: row.th_in,
    tcIn: row.tc_in,
    mh: row.mh,
    mc: row.mc,
    cph: row.cph,
    cpc: row.cpc,
    uClean: row.u_clean,
    area: row.area,
    rfHot: row.rf_hot,
    rfCold: row.rf_cold,
  };
}

export function rowUnits(row: VersionRow): UnitSet {
  return JSON.parse(row.units_json) as UnitSet;
}

export class Repository {
  constructor(private readonly db: DatabaseSync) {}

 createCase(name: string, note: string | undefined, iso: string): number {
    const r = this.db
      .prepare(
        `INSERT INTO cases(name, note, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(name, note ?? null, iso, iso);
    return Number(r.lastInsertRowid);
  }

  getCase(id: number): CaseRow | undefined {
    return this.db.prepare(`SELECT * FROM cases WHERE id = ?`).get(id) as
      | CaseRow
      | undefined;
  }

  listCases(limit: number, offset: number, search?: string): Page<CaseRow> {
    const where = search ? `WHERE name LIKE ?` : "";
    const params = search ? [`%${search}%`] : [];
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM cases ${where}`)
        .get(...params) as { n: number }
    ).n;
    const items = this.db
      .prepare(
        `SELECT * FROM cases ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as unknown as CaseRow[];
    return { items, total, limit, offset };
  }

  renameCase(id: number, name: string, note: string | undefined, iso: string): void {
    this.db
      .prepare(`UPDATE cases SET name = ?, note = ?, updated_at = ? WHERE id = ?`)
      .run(name, note ?? null, iso, id);
  }

  latestVersion(caseId: number): VersionRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM case_versions WHERE case_id = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(caseId) as VersionRow | undefined;
  }

  getVersion(caseId: number, version: number): VersionRow | undefined {
    return this.db
      .prepare(`SELECT * FROM case_versions WHERE case_id = ? AND version = ?`)
      .get(caseId, version) as VersionRow | undefined;
  }

  listVersions(caseId: number, limit: number, offset: number): Page<VersionRow> {
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM case_versions WHERE case_id = ?`)
        .get(caseId) as { n: number }
    ).n;
    const items = this.db
      .prepare(
        `SELECT * FROM case_versions WHERE case_id = ?
         ORDER BY version DESC LIMIT ? OFFSET ?`,
      )
      .all(caseId, limit, offset) as unknown as VersionRow[];
    return { items, total, limit, offset };
  }

  insertVersion(
    caseId: number,
    version: number,
    def: CaseDefinition,
    changeNote: string | undefined,
    iso: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO case_versions(
           case_id, version, arrangement, th_in, tc_in, mh, mc, cph, cpc,
           u_clean, area, rf_hot, rf_cold, units_json, change_note, created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        caseId,
        version,
        def.arrangement,
        def.thIn,
        def.tcIn,
        def.mh,
        def.mc,
        def.cph,
        def.cpc,
        def.uClean,
        def.area,
        def.rfHot,
        def.rfCold,
        JSON.stringify(def.units),
        changeNote ?? null,
        iso,
      );
    this.db.prepare(`UPDATE cases SET updated_at = ? WHERE id = ?`).run(iso, caseId);
  }

  insertLedger(
    caseId: number,
    version: number,
    s: {
      qHot: number;
      qCold: number;
      qLmtd: number;
      energyResidual: number;
      energyResidualRel: number;
      lmtdResidualRel: number;
    },
    iso: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO energy_ledger(
           case_id, version, q_hot, q_cold, q_lmtd, residual,
           residual_rel, lmtd_residual_rel, recorded_at
         ) VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        caseId,
        version,
        s.qHot,
        s.qCold,
        s.qLmtd,
        s.energyResidual,
        s.energyResidualRel,
        s.lmtdResidualRel,
        iso,
      );
  }

  listLedger(caseId: number, limit: number, offset: number): Page<unknown> {
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM energy_ledger WHERE case_id = ?`)
        .get(caseId) as { n: number }
    ).n;
    const items = this.db
      .prepare(
        `SELECT * FROM energy_ledger WHERE case_id = ?
         ORDER BY id ASC LIMIT ? OFFSET ?`,
      )
      .all(caseId, limit, offset);
    return { items, total, limit, offset };
  }

  putIdempotency(key: string, hash: string, responseJson: string, iso: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO idempotency_keys(key, request_hash, response_json, created_at)
         VALUES (?,?,?,?)`,
      )
      .run(key, hash, responseJson, iso);
  }

  getIdempotency(key: string): { request_hash: string; response_json: string } | undefined {
    return this.db
      .prepare(`SELECT request_hash, response_json FROM idempotency_keys WHERE key = ?`)
      .get(key) as { request_hash: string; response_json: string } | undefined;
  }
}
