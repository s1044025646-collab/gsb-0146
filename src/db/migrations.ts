export const SCHEMA_VERSION = 1;

/**
 * Idempotent migrations: every statement uses IF NOT EXISTS / OR IGNORE so the
 * script can be run repeatedly on an existing database.
 */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schema_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS cases (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     note TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS case_versions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     version INTEGER NOT NULL,
     arrangement TEXT NOT NULL,
     th_in REAL NOT NULL,
     tc_in REAL NOT NULL,
     mh REAL NOT NULL,
     mc REAL NOT NULL,
     cph REAL NOT NULL,
     cpc REAL NOT NULL,
     u_clean REAL NOT NULL,
     area REAL NOT NULL,
     rf_hot REAL NOT NULL DEFAULT 0,
     rf_cold REAL NOT NULL DEFAULT 0,
     units_json TEXT NOT NULL,
     change_note TEXT,
     created_at TEXT NOT NULL,
     UNIQUE (case_id, version)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_case_versions_case ON case_versions(case_id, version)`,

  `CREATE TABLE IF NOT EXISTS energy_ledger (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     version INTEGER NOT NULL,
     q_hot REAL NOT NULL,
     q_cold REAL NOT NULL,
     q_lmtd REAL NOT NULL,
     residual REAL NOT NULL,
     residual_rel REAL NOT NULL,
     lmtd_residual_rel REAL NOT NULL,
     recorded_at TEXT NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_ledger_case ON energy_ledger(case_id, id)`,

  `CREATE TABLE IF NOT EXISTS idempotency_keys (
     key TEXT PRIMARY KEY,
     request_hash TEXT NOT NULL,
     response_json TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
];
