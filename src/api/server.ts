import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AppError } from "../core/errors.ts";
import { compareArrangements, energyLedger, scan } from "../core/analysis.ts";
import { checkMeasured, solve } from "../core/solver.ts";
import type { HxInput } from "../core/types.ts";
import { validateHxInput, validatePagination } from "../core/validate.ts";
import {
  CaseRepository,
  type Clock,
  type Db,
  defaultClock,
} from "../db/database.ts";

export interface ApiDeps {
  db: Db;
  clock?: Clock;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, details: details ?? null } };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body is not valid JSON.");
  }
}

export function createApiServer(deps: ApiDeps): Server {
  const repo = new CaseRepository(deps.db);
  const clock = deps.clock ?? defaultClock;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (method === "GET" && path === "/health") {
        send(res, 200, { status: "ok", time: clock.now() });
        return;
      }

      if (method === "GET" && path === "/cases") {
        const { limit, offset } = validatePagination(url.searchParams);
        const { items, total } = repo.list(limit, offset);
        send(res, 200, {
          items: items.map((h) => ({ ...h, input: parseVersion(repo.getVersion(h.id)?.input_json) })),
          total,
          limit,
          offset,
        });
        return;
      }

      if (method === "POST" && path === "/calculate") {
        const input = validateHxInput(await readJson(req));
        send(res, 200, { result: solve(input) });
        return;
      }

      if (method === "POST" && path === "/calculate/check") {
        const body = (await readJson(req)) as Record<string, unknown>;
        const input = validateHxInput(body.input);
        const th = body.measuredToutHot;
        const tc = body.measuredToutCold;
        if (typeof th !== "number" || typeof tc !== "number") {
          throw new AppError("VALIDATION_ERROR", "measuredToutHot/Cold must be numbers in C.");
        }
        send(res, 200, { result: checkMeasured(input, th, tc) });
        return;
      }

      if (method === "POST" && path === "/calculate/compare") {
        const input = validateHxInput(await readJson(req));
        send(res, 200, { result: compareArrangements(input) });
        return;
      }

      if (method === "POST" && path === "/calculate/scan") {
        const body = (await readJson(req)) as Record<string, unknown>;
        const input = validateHxInput(body.input);
        const param = body.param;
        if (param !== "hotM" && param !== "coldM" && param !== "area") {
          throw new AppError("VALIDATION_ERROR", "param must be hotM, coldM or area.");
        }
        if (!Array.isArray(body.values) || body.values.some((v) => typeof v !== "number")) {
          throw new AppError("VALIDATION_ERROR", "values must be a number array.");
        }
        send(res, 200, { points: scan(input, param, body.values as number[]) });
        return;
      }

      if (method === "POST" && path === "/calculate/energy-ledger") {
        const input = validateHxInput(await readJson(req));
        send(res, 200, { ledger: energyLedger(solve(input)) });
        return;
      }

      // Case persistence with idempotency and revisions.
      if (method === "POST" && path === "/cases") {
        const body = (await readJson(req)) as Record<string, unknown>;
        const name = typeof body.name === "string" && body.name.length > 0 ? body.name : "unnamed";
        const input = validateHxInput(body.input);
        solve(input); // fail fast if physically invalid
        const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
        const result = repo.withIdempotency(
          idempotencyKey,
          () => {
            const id = typeof body.id === "string" ? body.id : `case_${clock.random()}`;
            if (repo.getHeader(id)) {
              throw new AppError("CONFLICT", `Case ${id} already exists.`, { id });
            }
            const row = repo.create(id, name, input, clock);
            return { id, version: 1, input: JSON.parse(row.input_json) as HxInput };
          },
          clock
        );
        send(res, result.replayed ? 200 : 201, result.value);
        return;
      }

      const caseMatch = path.match(/^\/cases\/([^/]+)$/);
      if (caseMatch && method === "GET") {
        const id = decodeURIComponent(caseMatch[1] as string);
        const versionRaw = url.searchParams.get("version");
        const version = versionRaw === null ? undefined : Number(versionRaw);
        if (versionRaw !== null && (!Number.isInteger(version) || (version as number) < 1)) {
          throw new AppError("VALIDATION_ERROR", "version must be a positive integer.");
        }
        const header = repo.getHeader(id);
        const row = repo.getVersion(id, version);
        if (!header || !row) throw new AppError("NOT_FOUND", "Case or version not found.", { id, version });
        send(res, 200, { ...header, version: row.version, input: parseVersion(row.input_json), createdAt: row.created_at });
        return;
      }

      const versionsMatch = path.match(/^\/cases\/([^/]+)\/versions$/);
      if (versionsMatch && method === "GET") {
        const id = decodeURIComponent(versionsMatch[1] as string);
        if (!repo.getHeader(id)) throw new AppError("NOT_FOUND", "Case not found.", { id });
        const rows = repo.listVersions(id);
        send(res, 200, {
          id,
          versions: rows.map((r) => ({ version: r.version, createdAt: r.created_at, input: parseVersion(r.input_json) })),
        });
        return;
      }

      const reviseMatch = path.match(/^\/cases\/([^/]+)\/revisions$/);
      if (reviseMatch && method === "POST") {
        const id = decodeURIComponent(reviseMatch[1] as string);
        const body = (await readJson(req)) as Record<string, unknown>;
        const input = validateHxInput(body.input);
        solve(input);
        const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
        const result = repo.withIdempotency(
          idempotencyKey,
          () => {
            if (!repo.getHeader(id)) throw new AppError("NOT_FOUND", "Case not found.", { id });
            const row = repo.revise(id, input, clock);
            return { id, version: row.version, input: JSON.parse(row.input_json) as HxInput };
          },
          clock
        );
        send(res, result.replayed ? 200 : 201, result.value);
        return;
      }

      send(res, 404, errorBody("NOT_FOUND", `No route for ${method} ${path}`));
    } catch (err) {
      if (err instanceof AppError) {
        const status =
          err.code === "NOT_FOUND" ? 404 : err.code === "CONFLICT" || err.code === "VERSION_CONFLICT" ? 409 : 400;
        send(res, status, errorBody(err.code, err.message, err.details));
        return;
      }
      const message = err instanceof Error ? err.message : "Unexpected error.";
      send(res, 500, errorBody("VALIDATION_ERROR", message));
    }
  });

  return server;
}

function parseVersion(json: string | undefined): HxInput | undefined {
  return json ? (JSON.parse(json) as HxInput) : undefined;
}
