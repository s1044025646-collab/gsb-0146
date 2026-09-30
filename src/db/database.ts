import { DatabaseSync } from "node:sqlite";

export interface Clock {
  now: () => string;
  random: () => string;
}

export const defaultClock: Clock = {
  now: () => new Date().toISOString(),
  random: () => {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  },
};

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`,
  `
  CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    current_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );`,
  `
  CREATE TABLE IF NOT EXISTS case_versions (
    case_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    input_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (case_id, version),
    FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE
  );`,
  `
  CREATE TABLE IF NOT EXISTS idempotency (
    key TEXT PRIMARY KEY,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`,
];

export class Db {
  readonly sqlite: DatabaseSync;

  constructor(pathOrDb: string | DatabaseSync = ":memory:") {
    this.sqlite =
      typeof pathOrDb === "string" ? new DatabaseSync(pathOrDb) : pathOrDb;
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
  }

  migrate(clock: Clock = defaultClock): void {
    this.sqlite.prepare("BEGIN").run();
    try {
      // The migrations ledger must exist before it can be queried.
      this.sqlite.exec(MIGRATIONS[0] as string);
      const appliedRow = this.sqlite
        .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
        .get() as { v: number } | undefined;
      const applied = appliedRow?.v ?? 0;
      const insert = this.sqlite.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
      );
      MIGRATIONS.forEach((sql, idx) => {
        const version = idx + 1;
        if (version > applied) {
          if (version > 1) this.sqlite.exec(sql);
          insert.run(version, clock.now());
        }
      });
      this.sqlite.prepare("COMMIT").run();
    } catch (err) {
      this.sqlite.prepare("ROLLBACK").run();
      throw err;
    }
  }

  close(): void {
    this.sqlite.close();
  }
}

export interface CaseHeader {
  id: string;
  name: string;
  current_version: number;
  created_at: string;
}

export interface CaseVersionRow {
  case_id: string;
  version: number;
  input_json: string;
  created_at: string;
}

export class CaseRepository {
  constructor(private readonly db: Db) {}

  private createCaseStmt() {
    return this.db.sqlite.prepare(
      "INSERT INTO cases (id, name, current_version, created_at) VALUES (?, ?, 1, ?)"
    );
  }
  private insertVersionStmt() {
    return this.db.sqlite.prepare(
      "INSERT INTO case_versions (case_id, version, input_json, created_at) VALUES (?, ?, ?, ?)"
    );
  }
  private bumpCaseStmt() {
    return this.db.sqlite.prepare(
      "UPDATE cases SET current_version = ? WHERE id = ?"
    );
  }

  create(
    id: string,
    name: string,
    input: unknown,
    clock: Clock = defaultClock
  ): CaseVersionRow {
    this.createCaseStmt().run(id, name, clock.now());
    this.insertVersionStmt().run(id, 1, JSON.stringify(input), clock.now());
    return {
      case_id: id,
      version: 1,
      input_json: JSON.stringify(input),
      created_at: clock.now(),
    };
  }

  revise(
    caseId: string,
    input: unknown,
    clock: Clock = defaultClock
  ): CaseVersionRow {
    const sqlite = this.db.sqlite;
    sqlite.prepare("BEGIN IMMEDIATE").run();
    try {
      const header = sqlite
        .prepare("SELECT current_version FROM cases WHERE id = ?")
        .get(caseId) as { current_version: number } | undefined;
      if (!header) {
        sqlite.prepare("ROLLBACK").run();
        throw new Error(`CASE_NOT_FOUND:${caseId}`);
      }
      const nextVersion = header.current_version + 1;
      this.insertVersionStmt().run(
        caseId,
        nextVersion,
        JSON.stringify(input),
        clock.now()
      );
      this.bumpCaseStmt().run(nextVersion, caseId);
      sqlite.prepare("COMMIT").run();
      return {
        case_id: caseId,
        version: nextVersion,
        input_json: JSON.stringify(input),
        created_at: clock.now(),
      };
    } catch (err) {
      try {
        sqlite.prepare("ROLLBACK").run();
      } catch {
        /* already rolled back */
      }
      throw err;
    }
  }

  getHeader(id: string): CaseHeader | undefined {
    return this.db.sqlite
      .prepare("SELECT id, name, current_version, created_at FROM cases WHERE id = ?")
      .get(id) as CaseHeader | undefined;
  }

  getVersion(caseId: string, version?: number): CaseVersionRow | undefined {
    const target =
      version ??
      (
        this.db.sqlite
          .prepare("SELECT current_version FROM cases WHERE id = ?")
          .get(caseId) as { current_version: number } | undefined
      )?.current_version;
    if (target === undefined) return undefined;
    return this.db.sqlite
      .prepare(
        "SELECT case_id, version, input_json, created_at FROM case_versions WHERE case_id = ? AND version = ?"
      )
      .get(caseId, target) as CaseVersionRow | undefined;
  }

  listVersions(caseId: string): CaseVersionRow[] {
    return this.db.sqlite
      .prepare(
        "SELECT case_id, version, input_json, created_at FROM case_versions WHERE case_id = ? ORDER BY version ASC"
      )
      .all(caseId) as unknown as CaseVersionRow[];
  }

  list(limit: number, offset: number): { items: CaseHeader[]; total: number } {
    const total = (
      this.db.sqlite.prepare("SELECT COUNT(*) AS n FROM cases").get() as { n: number }
    ).n;
    const items = this.db.sqlite
      .prepare(
        "SELECT id, name, current_version, created_at FROM cases ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?"
      )
      .all(limit, offset) as unknown as CaseHeader[];
    return { items, total };
  }

  withIdempotency<T>(
    key: string | undefined,
    produce: () => T,
    clock: Clock = defaultClock
  ): { value: T; replayed: boolean } {
    if (!key) return { value: produce(), replayed: false };
    const existing = this.db.sqlite
      .prepare("SELECT response_json FROM idempotency WHERE key = ?")
      .get(key) as { response_json: string } | undefined;
    if (existing) {
      return { value: JSON.parse(existing.response_json) as T, replayed: true };
    }
    const value = produce();
    this.db.sqlite
      .prepare(
        "INSERT INTO idempotency (key, response_json, created_at) VALUES (?, ?, ?)"
      )
      .run(key, JSON.stringify(value), clock.now());
    return { value, replayed: false };
  }
}
