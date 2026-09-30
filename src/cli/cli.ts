import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../db/database.js";
import { CaseService, linspace, scan } from "../services/case-service.js";
import { AppError, isAppError } from "../core/errors.js";
import { SI_UNITS } from "../core/units.js";
import { modelScope } from "../core/heatx.js";
import type { CaseDefinition, Solution } from "../core/types.js";

const dataDir = join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });
const dbPath = process.env.HEXCHECK_DB ?? join(dataDir, "hexcheck.sqlite");
const db = openDatabase(dbPath);
const service = new CaseService(db);

function usage(): void {
  console.log(`hexcheck CLI

  create --name N --arrangement parallel|counter
         --thIn C --tcIn C --mh kg/s --mc kg/s --cph J/kgK --cpc J/kgK
         --u W/m2K --area m2 [--rfHot R] [--rfCold R] [--note T]
         [--idem KEY]
  revise CASE_ID [--baseVersion V] [--changeNote T] [same input flags]
  list [--limit N] [--offset N] [--search S]
  versions CASE_ID
  solve CASE_ID [--version V]
  check CASE_ID --thOut C --tcOut C [--version V]
  scan CASE_ID --param mc|mh|area --from F --to T [--count N] [--version V]
  compare CASE_ID [--version V]
  ledger CASE_ID [--limit N] [--offset N]
  scope
`);
}

function flags(argv: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        m.set(a.slice(2), next);
        i++;
      } else {
        m.set(a.slice(2), "");
      }
    }
  }
  return m;
}

function num(f: Map<string, string>, key: string): number | undefined {
  const v = f.get(key);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new AppError("BAD_REQUEST", `--${key} must be a number`);
  return n;
}

function definitionFromFlags(f: Map<string, string>): CaseDefinition {
  const required = ["thIn", "tcIn", "mh", "mc", "cph", "cpc", "u", "area"] as const;
  for (const key of required) {
    if (!f.has(key)) throw new AppError("BAD_REQUEST", `--${key} is required`);
  }
  const arrangement = f.get("arrangement");
  if (arrangement !== "parallel" && arrangement !== "counter") {
    throw new AppError("BAD_REQUEST", "--arrangement must be parallel or counter");
  }
  return {
    name: f.get("name") ?? "case",
    note: f.get("note"),
    units: SI_UNITS,
    arrangement,
    thIn: num(f, "thIn")!,
    tcIn: num(f, "tcIn")!,
    mh: num(f, "mh")!,
    mc: num(f, "mc")!,
    cph: num(f, "cph")!,
    cpc: num(f, "cpc")!,
    uClean: num(f, "u")!,
    area: num(f, "area")!,
    rfHot: num(f, "rfHot") ?? 0,
    rfCold: num(f, "rfCold") ?? 0,
  };
}

function printSolution(title: string, s: Solution): void {
  console.log(`\n== ${title} ==`);
  console.log(
    `  Ch=${s.ch.toFixed(2)} W/K  Cc=${s.cc.toFixed(2)} W/K  ` +
      `Cmin side=${s.minSide}  Cr=${s.cr.toFixed(6)}`,
  );
  console.log(
    `  U_clean=${s.inputs.uClean.toFixed(3)}  fouling=${s.foulingFactor.toExponential(3)}` +
      ` m2K/W  U_eff=${s.uEffective.toFixed(3)} W/m2K`,
  );
  console.log(`  NTU=${s.ntu.toFixed(6)}  effectiveness=${s.effectiveness.toFixed(6)}`);
  console.log(`  Qmax=${s.qMax.toFixed(2)} W   Q=${s.q.toFixed(2)} W`);
  console.log(
    `  Th: ${s.inputs.thIn.toFixed(3)} -> ${s.thOut.toFixed(3)} C | ` +
      `Tc: ${s.inputs.tcIn.toFixed(3)} -> ${s.tcOut.toFixed(3)} C`,
  );
  console.log(
    `  energy Qhot=${s.qHot.toFixed(3)} W Qcold=${s.qCold.toFixed(3)} W ` +
      `residual=${s.energyResidual.toExponential(3)} W (${(s.energyResidualRel * 100).toExponential(2)}%)`,
  );
  console.log(
    `  LMTD cross-check: dT1=${s.deltaT1.toFixed(4)} dT2=${s.deltaT2.toFixed(4)} ` +
      `LMTD=${s.lmtd.toFixed(4)} K  Q_LMTD=${s.qLmtd.toFixed(2)} W ` +
      `rel.err=${(s.lmtdResidualRel * 100).toExponential(2)}%`,
  );
  console.log(`  feasible=${s.feasible}`);
  for (const w of s.warnings) console.log(`  ! ${w}`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const f = flags(argv.slice(1));

  switch (cmd) {
    case "create": {
      const def = definitionFromFlags(f);
      const before = service.listCases(1, 0).total;
      console.log(`before: ${before} case(s) stored`);
      const created = service.createCase(def, f.get("idem"));
      console.log(
        `after:  case #${created.caseId} v${created.version} "${created.definition.name}" created at ${created.createdAt}`,
      );
      printSolution("solution v1", created.solution);
      return 0;
    }
    case "revise": {
      const caseId = Number(argv[1]);
      const before = service.getCase(caseId);
      console.log(`before: case #${caseId} latest v${before.latestVersion}`);
      const def = definitionFromFlags(f);
      const created = service.revise(caseId, {
        ...def,
        baseVersion: f.has("baseVersion") ? Number(f.get("baseVersion")) : undefined,
        changeNote: f.get("changeNote"),
      });
      console.log(`after:  new version v${created.version} created at ${created.createdAt}`);
      printSolution(`solution v${created.version}`, created.solution);
      return 0;
    }
    case "list": {
      const page = service.listCases(
        Number(f.get("limit") ?? 20),
        Number(f.get("offset") ?? 0),
        f.get("search"),
      );
      console.log(`cases total=${page.total}`);
      for (const item of page.items as Array<{ id: number; name: string; updated_at: string }>) {
        console.log(`  #${item.id} ${item.name} (updated ${item.updated_at})`);
      }
      return 0;
    }
    case "versions": {
      const page = service.listVersions(Number(argv[1]), 100, 0);
      console.log(`case #${argv[1]} versions total=${page.total}`);
      for (const v of page.items) {
        console.log(`  v${v.version} ${v.arrangement} area=${v.area} (${v.created_at}) ${v.change_note ?? ""}`);
      }
      return 0;
    }
    case "solve": {
      printSolution(
        `case #${argv[1]}`,
        service.solveVersion(Number(argv[1]), f.has("version") ? Number(f.get("version")) : undefined),
      );
      return 0;
    }
    case "check": {
      const report = service.checkMeasured(
        Number(argv[1]),
        { thOutMeasured: num(f, "thOut")!, tcOutMeasured: num(f, "tcOut")! },
        f.has("version") ? Number(f.get("version")) : undefined,
      );
      console.log("measured outlets retained as supplied (no conservation correction):");
      console.log(`  Th,out=${report.retained.thOutMeasured}  Tc,out=${report.retained.tcOutMeasured} C`);
      console.log(
        `  Qhot=${report.qHotMeasured.toFixed(2)} W Qcold=${report.qColdMeasured.toFixed(2)} W` +
          ` imbalance=${report.measuredImbalance.toFixed(2)} W (${(report.measuredImbalanceRel * 100).toFixed(2)}%)`,
      );
      console.log(
        `  deviation from model: dTh=${report.deltaThOut.toFixed(3)} dTc=${report.deltaTcOut.toFixed(3)} K`,
      );
      console.log(`  outletCrossing=${report.outletCrossing} localHeatViolation=${report.localHeatViolation}`);
      if (report.violationReason) console.log(`  ! ${report.violationReason}`);
      for (const w of report.warnings) console.log(`  ! ${w}`);
      return 0;
    }
    case "scan": {
      const param = (f.get("param") ?? "mc") as "mc" | "mh" | "area";
      const view = service.getCase(Number(argv[1]), f.has("version") ? Number(f.get("version")) : undefined);
      const from = num(f, "from");
      const to = num(f, "to");
      const values =
        from !== undefined && to !== undefined
          ? linspace(from, to, Number(f.get("count") ?? 11))
          : linspace(
              param === "area" ? 0 : 0.001,
              view.inputs[param] * 2,
              Number(f.get("count") ?? 11),
            );
      console.log(`scanning ${param}:`);
      for (const point of scan(view.inputs, param, values)) {
        console.log(
          `  ${param}=${point.value.toFixed(4)} -> Q=${point.solution.q.toFixed(2)} W, ` +
            `eps=${point.solution.effectiveness.toFixed(5)}, NTU=${point.solution.ntu.toFixed(4)}`,
        );
      }
      return 0;
    }
    case "compare": {
      const r = service.compareArrangements(
        Number(argv[1]),
        f.has("version") ? Number(f.get("version")) : undefined,
      );
      printSolution("parallel flow", r.parallel);
      printSolution("counter flow", r.counter);
      console.log(`\ncounterflow Q gain = ${r.qGainCounterW.toFixed(2)} W (winner: ${r.winner})`);
      return 0;
    }
    case "ledger": {
      const page = service.ledger(
        Number(argv[1]),
        Number(f.get("limit") ?? 50),
        Number(f.get("offset") ?? 0),
      );
      console.log(`energy ledger case #${argv[1]} entries=${page.total}`);
      for (const row of page.items as Array<Record<string, number | string>>) {
        console.log(
          `  v${row.version} Qhot=${Number(row.q_hot).toFixed(2)} Qcold=${Number(row.q_cold).toFixed(2)} ` +
            `Qlmtd=${Number(row.q_lmtd).toFixed(2)} residual=${Number(row.residual).toExponential(2)} @ ${row.recorded_at}`,
        );
      }
      return 0;
    }
    case "scope":
      console.log(modelScope().join("\n"));
      return 0;
    default:
      usage();
      return cmd ? 1 : 0;
  }
}

main()
  .then((code) => {
    db.close();
    process.exit(code);
  })
  .catch((err: unknown) => {
    if (isAppError(err)) {
      console.error(`error [${err.code}]: ${err.message}`);
      if (err.details) console.error(JSON.stringify(err.details));
    } else {
      console.error(err);
    }
    db.close();
    process.exit(1);
  });
