# Heat Exchanger Performance Check & Scenario Comparison — Backend

A local Windows backend for **steady-state, single-pass, counterflow and
parallel-flow** heat exchangers with **constant specific heats**, **no heat
loss to the surroundings**, and **sensible heat only** (no phase change).

It solves thermal duty and both outlet temperatures with the
**effectiveness–NTU** method and cross-checks the result with an
**LMTD** computed from the end temperature differences. It exposes an
**HTTP API** and a **CLI**, ships fictional water/water-like worked
examples, and includes automated tests. There is **no web UI**, no
phase-change simulation, and no control of real equipment.

## Model scope and rules

- Capacity rates `Ch = mh·cph`, `Cc = mc·cpc`; `Cmin`, `Cmax`, ratio
  `Cr = Cmin/Cmax`, and the Cmin side are reported.
- Fouling enters as added resistance:
  `1/Ueff = 1/Uclean + Rf,hot + Rf,cold`.
- NTU `= Ueff·A/Cmin`. Effectiveness uses the standard counter/parallel
  forms with **stable limits** for `Cr → 1`, equal end differences
  (arithmetic-mean LMTD), and `NTU → 0` (`ε ≈ NTU`).
- Counterflow **outlet temperature crossing** (`Tc,out > Th,out`) is allowed
  when both local end differences stay positive; a non-positive end
  difference is rejected as a true local heat-flow-direction violation.
- Rejected inputs have explicit error codes: `ZERO_FLOW`,
  `NON_POSITIVE_CP`, `INVALID_DRIVING_TEMPERATURE` (hot inlet ≤ cold inlet),
  `NON_POSITIVE_U`, `NON_POSITIVE_AREA`, `NEGATIVE_FOULING`,
  `PHASE_CHANGE_UNSUPPORTED`, `LOCAL_HEAT_FLOW_VIOLATION`.
- Measured outlets are **retained as entered**: energy imbalance is
  reported, never silently "corrected" to enforce conservation.
- Input revisions create a **new immutable version**; old versions remain
  retrievable. Reports include both-side duties, the balance residual and
  the model applicability scope.

## Requirements

- Node.js 25 (uses the built-in `node:sqlite`; no native build step)
- npm (installs `typescript` and `tsx` only as dev dependencies)

## Install

```powershell
npm install
```

## Tests

```powershell
npm test                 # all suites (node:test)
npm run typecheck        # tsc --noEmit
```

Coverage includes the hand-calculated anchor (`Ch=Cc=4000 W/K`, `NTU=1`,
counterflow → `ε=0.5`, `q=160 kW`, outlets `80/80 °C`), equal capacity,
very large and near-zero NTU, fouling increase, counterflow outlet cross,
invalid driving temperatures, mixed units, energy conservation,
effectiveness bounds, area monotonicity, temperature-scale translation
invariance, version reproduction, idempotency, transaction rollback, and
restart persistence.

## Repeatable end-to-end demo

```powershell
npm run demo
```

Runs an isolated database at `data/demo.db`, exports an energy ledger to
`data/demo-ledger.json`, and makes a live request to an API instance on a
localhost auto-assigned port.

## CLI

```powershell
npm run cli -- solve   --fixture=equalCapacityCounter
npm run cli -- compare --fixture=equalCapacityCounter
npm run cli -- scan    --fixture=equalCapacityCounter --param=area --values=1,2,4,8
npm run cli -- check   --fixture=equalCapacityCounter --tout-hot=79 --tout-cold=82
npm run cli -- ledger  --fixture=equalCapacityCounter
npm run cli -- fixtures
npm run cli -- case create  --id=c1 --name="run A" --fixture=equalCapacityCounter [--idempotency-key=k]
npm run cli -- case revise  c1 --fixture=fouledCounter
npm run cli -- case get     c1 --version=1
npm run cli -- case versions c1
npm run cli -- case list    --limit=50 --offset=0
```

Inputs can also be supplied as JSON with `--file=path.json` (same schema as
the API body). CLI state-changing commands print BEFORE/AFTER state.

## HTTP API

Start (binds **127.0.0.1** only; port `0` = OS-assigned free port):

```powershell
npm start                       # foreground, port chosen automatically
$env:HX_PORT="0"; npm start
scripts/start.ps1               # background; records ./.server.pid
scripts/stop.ps1                # stops exactly that project process
```

Routes:

- `GET  /health`
- `POST /calculate`
- `POST /calculate/check`        `{ input, measuredToutHot, measuredToutCold }`
- `POST /calculate/compare`
- `POST /calculate/scan`         `{ input, param: hotM|coldM|area, values: number[] }`
- `POST /calculate/energy-ledger`
- `POST /cases`                  `{ id?, name, input, idempotencyKey? }` (201 / 200 replay)
- `GET  /cases?limit=&offset=`   paginated list
- `GET  /cases/:id?version=`
- `GET  /cases/:id/versions`
- `POST /cases/:id/revisions`    `{ input, idempotencyKey? }`

Errors return HTTP 4xx with `{ "error": { "code", "message", "details" } }`;
pagination violations return `INVALID_PAGINATION`.

## Data and process isolation

- All data and temp files stay under the project: `data/` and `.server.pid`.
- `scripts/start.ps1`/`stop.ps1` manage only the process recorded in
  `.server.pid`. Set `HX_DB_PATH` to relocate the SQLite file.
- Migrations are idempotent and repeatable; tests inject a fixed clock for
  timestamps and use idempotency keys for replay-safe submissions.
