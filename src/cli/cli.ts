#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { energyLedger, compareArrangements, scan } from "../core/analysis.ts";
import { AppError } from "../core/errors.ts";
import { allFixtures } from "../core/fixtures.ts";
import { checkMeasured, solve } from "../core/solver.ts";
import type { HxInput } from "../core/types.ts";
import { validateHxInput } from "../core/validate.ts";
import { CaseRepository, Db, defaultClock } from "../db/database.ts";

interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] as string;
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq >= 0) flags.set(token.slice(2, eq), token.slice(eq + 1));
      else flags.set(token.slice(2), rest[++i] ?? "true");
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
}

function loadInput(args: Args): HxInput {
  const fixture = args.flags.get("fixture");
  const file = args.flags.get("file");
  if (fixture) {
    const fx = allFixtures[fixture];
    if (!fx) throw new AppError("NOT_FOUND", `Unknown fixture: ${fixture}`);
    return structuredClone(fx);
  }
  if (file) {
    const raw = JSON.parse(readFileSync(resolve(file), "utf8")) as unknown;
    return validateHxInput(raw);
  }
  throw new AppError("VALIDATION_ERROR", "Provide --fixture=<name> or --file=<path>.");
}

function openDb(): { db: Db; repo: CaseRepository } {
  const dbPath = resolve(process.env.HX_DB_PATH ?? "data/hx.db");
  const db = new Db(dbPath);
  db.migrate();
  return { db, repo: new CaseRepository(db) };
}

function row(label: string, value: string): string {
  return `  ${label.padEnd(34)} ${value}`;
}

function printSolve(r: ReturnType<typeof solve>): void {
  console.log(row("arrangement", r.arrange));
  console.log(row("C_hot / C_cold (W/K)", `${r.cHot.toFixed(3)} / ${r.cCold.toFixed(3)}`));
  console.log(row("Cmin side", `${r.cMinSide} (Cr=${r.cr.toFixed(6)})`));
  console.log(row("U clean / effective (W/m2K)", `${r.uClean.toFixed(4)} / ${r.uEffective.toFixed(4)}`));
  console.log(row("NTU", r.ntu.toFixed(6)));
  console.log(row("effectiveness", r.effectiveness.toFixed(6)));
  console.log(row("T in  hot/cold (C)", `${r.tinHot.toFixed(3)} / ${r.tinCold.toFixed(3)}`));
  console.log(row("T out hot/cold (C)", `${r.toutHot.toFixed(3)} / ${r.toutCold.toFixed(3)}`));
  console.log(row("outlet cross (allowed counter)", String(r.outletTemperatureCross)));
  console.log(row("q NTU (W)", r.q.toFixed(3)));
  console.log(row("q hot / q cold (W)", `${r.qHot.toFixed(3)} / ${r.qCold.toFixed(3)}`));
  console.log(row("balance residual (W)", r.balanceResidual.toExponential(3)));
  console.log(row("end dT1/dT2 (K)", `${r.deltaT1.toFixed(3)} / ${r.deltaT2.toFixed(3)}`));
  console.log(row("LMTD (K)", r.lmtd.toFixed(4)));
  console.log(row("q LMTD cross-check (W)", r.qLmtd.toFixed(3)));
  console.log(row("LMTD relative residual", r.lmtdResidual.toExponential(3)));
}

const HELP = `heat-exchanger CLI (steady state, adiabatic, constant cp, counter/parallel)

Usage:
  hx solve  --fixture=<name> | --file=<p.json>
  hx check  --fixture=<name> --tout-hot=<C> --tout-cold=<C>
  hx scan   --fixture=<name> --param=hotM|coldM|area --values=1,2,3
  hx compare --fixture=<name>
  hx ledger --fixture=<name>
  hx fixtures
  hx case create  --fixture=<name> --name=<n> [--id=<id>] [--idempotency-key=<k>]
  hx case revise  <caseId> --file=<p.json> [--idempotency-key=<k>]
  hx case get     <caseId> [--version=<v>]
  hx case versions <caseId>
  hx case list    [--limit=<n>] [--offset=<n>]
  hx help

Data is stored under the project at data/hx.db (override HX_DB_PATH).
`;

function main(argv: string[]): void {
  const args = parseArgs(argv);

  switch (args.command) {
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;

    case "fixtures":
      console.log(Object.keys(allFixtures).join("\n"));
      return;

    case "solve": {
      const input = loadInput(args);
      console.log("BEFORE: running effectiveness-NTU solve");
      printSolve(solve(input));
      return;
    }

    case "check": {
      const input = loadInput(args);
      const th = Number(args.flags.get("tout-hot"));
      const tc = Number(args.flags.get("tout-cold"));
      if (!Number.isFinite(th) || !Number.isFinite(tc)) {
        throw new AppError("VALIDATION_ERROR", "--tout-hot/--tout-cold are required numbers.");
      }
      console.log("BEFORE: comparing measured outlets to model (measured values retained)");
      const result = checkMeasured(input, th, tc);
      console.log(row("measured Tout hot/cold (C)", `${result.measuredToutHot} / ${result.measuredToutCold}`));
      console.log(row("predicted Tout hot/cold (C)", `${result.predictedToutHot.toFixed(3)} / ${result.predictedToutCold.toFixed(3)}`));
      console.log(row("q hot measured / q cold measured", `${result.qHotMeasured.toFixed(3)} / ${result.qColdMeasured.toFixed(3)}`));
      console.log(row("imbalance (W, NOT corrected)", result.imbalance.toFixed(3)));
      console.log(row("balanced within tolerance", String(result.balanced)));
      return;
    }

    case "scan": {
      const input = loadInput(args);
      const param = args.flags.get("param") ?? "";
      if (param !== "hotM" && param !== "coldM" && param !== "area") {
        throw new AppError("VALIDATION_ERROR", "--param must be hotM, coldM or area.");
      }
      const values = (args.flags.get("values") ?? "").split(",").map(Number);
      if (values.some((v) => !Number.isFinite(v))) {
        throw new AppError("VALIDATION_ERROR", "--values must be comma-separated numbers.");
      }
      console.log(`BEFORE: scanning ${param} over ${values.length} points`);
      for (const point of scan(input, param, values)) {
        console.log(
          row(
            `${param}=${point.value}`,
            `q=${point.q.toFixed(2)}W eps=${point.effectiveness.toFixed(5)} NTU=${point.ntu.toFixed(4)} Tho=${point.toutHot.toFixed(2)} Tco=${point.toutCold.toFixed(2)}`
          )
        );
      }
      return;
    }

    case "compare": {
      const input = loadInput(args);
      console.log("BEFORE: solving counterflow");
      const c = compareArrangements(input);
      console.log("COUNTERFLOW:");
      printSolve(c.counter);
      console.log("PARALLEL:");
      printSolve(c.parallel);
      console.log(row("q counter - q parallel (W)", c.qGainCounterOverParallel.toFixed(3)));
      console.log(row("preferred", c.preferred));
      return;
    }

    case "ledger": {
      const input = loadInput(args);
      const ledger = energyLedger(solve(input));
      console.log("Energy ledger");
      for (const e of ledger.entries) console.log(row(e.label, `${e.value.toFixed(3)} ${e.unit}`));
      console.log(row("residual (W)", ledger.residual.toExponential(3)));
      console.log(`Scope: ${ledger.scope}`);
      return;
    }

    case "case": {
      const sub = args.positional[0];
      const { db, repo } = openDb();
      try {
        if (sub === "create") {
          const input = loadInput(args);
          solve(input);
          const name = args.flags.get("name") ?? "unnamed";
          const id = args.flags.get("id") ?? `case_${defaultClock.random().slice(0, 12)}`;
          console.log(`BEFORE: no case ${id}`);
          if (repo.getHeader(id)) throw new AppError("CONFLICT", `Case ${id} already exists.`);
          const key = args.flags.get("idempotency-key");
          const result = repo.withIdempotency(key, () => {
            repo.create(id, name, input);
            return { id };
          });
          const header = repo.getHeader(result.value.id);
          console.log(`AFTER: case ${result.value.id} "${name}" at version ${header?.current_version}${result.replayed ? " (replayed idempotently)" : ""}`);
          return;
        }
        if (sub === "revise") {
          const id = args.positional[1];
          if (!id) throw new AppError("VALIDATION_ERROR", "caseId required.");
          const file = args.flags.get("file");
          const before = repo.getHeader(id);
          if (!before) throw new AppError("NOT_FOUND", `Case ${id} not found.`);
          console.log(`BEFORE: case ${id} at version ${before.current_version}`);
          const input = file
            ? validateHxInput(JSON.parse(readFileSync(resolve(file), "utf8")))
            : loadInput(args);
          solve(input);
          const key = args.flags.get("idempotency-key");
          const result = repo.withIdempotency(key, () => repo.revise(id, input));
          console.log(`AFTER: case ${id} at version ${result.value.version} (previous inputs retained)${result.replayed ? " (replayed)" : ""}`);
          return;
        }
        if (sub === "get") {
          const id = args.positional[1];
          if (!id) throw new AppError("VALIDATION_ERROR", "caseId required.");
          const version = args.flags.has("version") ? Number(args.flags.get("version")) : undefined;
          const header = repo.getHeader(id);
          const rowData = repo.getVersion(id, version);
          if (!header || !rowData) throw new AppError("NOT_FOUND", "Case or version not found.");
          console.log(`Case ${id} "${header.name}" version ${rowData.version}/${header.current_version}`);
          console.log(rowData.input_json);
          return;
        }
        if (sub === "versions") {
          const id = args.positional[1];
          if (!id) throw new AppError("VALIDATION_ERROR", "caseId required.");
          if (!repo.getHeader(id)) throw new AppError("NOT_FOUND", `Case ${id} not found.`);
          for (const v of repo.listVersions(id)) {
            console.log(`v${v.version} @ ${v.created_at}`);
          }
          return;
        }
        if (sub === "list") {
          const limit = Number(args.flags.get("limit") ?? 50);
          const offset = Number(args.flags.get("offset") ?? 0);
          const { items, total } = repo.list(limit, offset);
          console.log(`total=${total} limit=${limit} offset=${offset}`);
          for (const h of items) console.log(`${h.id}\t${h.name}\tv${h.current_version}\t${h.created_at}`);
          return;
        }
        throw new AppError("VALIDATION_ERROR", `Unknown case subcommand: ${String(sub)}`);
      } finally {
        db.close();
      }
    }

    default:
      throw new AppError("NOT_FOUND", `Unknown command: ${args.command}. Try 'hx help'.`);
  }
}

try {
  main(process.argv.slice(2));
} catch (err) {
  if (err instanceof AppError) {
    console.error(`ERROR [${err.code}] ${err.message}`);
    if (err.details !== undefined) console.error(JSON.stringify(err.details));
    process.exitCode = 1;
  } else {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}


