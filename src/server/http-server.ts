import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { CaseService, linspace, scan } from "../services/case-service.js";
import type { Clock } from "../db/database.js";
import { isAppError } from "../core/errors.js";
import { modelScope } from "../core/heatx.js";
import { SI_UNITS } from "../core/units.js";

export interface StartedServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return Object.assign(new Error("invalid JSON body"));
  }
}

function paging(url: URL): { limit: number; offset: number; extra: Record<string, string> } {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
    return { limit: 50, offset: 0, extra: {} };
  }
  const extra: Record<string, string> = {};
  for (const key of ["search", "param", "from", "to", "count", "version"]) {
    const v = url.searchParams.get(key);
    if (v !== null) extra[key] = v;
  }
  return { limit, offset, extra };
}

export function createApp(db: DatabaseSync, clock?: Clock): Server {
  const service = new CaseService(db, clock);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const method = req.method ?? "GET";

      if (method === "GET" && path === "/health") {
        sendJson(res, 200, { ok: true, scope: modelScope() });
        return;
      }
      if (method === "GET" && path === "/units") {
        sendJson(res, 200, { default: SI_UNITS });
        return;
      }

      const body =
        method === "POST" || method === "PUT" || method === "PATCH"
          ? await readJson(req)
          : undefined;
      if (body instanceof Error) {
        sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Request body is not valid JSON" } });
        return;
      }

      const idemKey = req.headers["idempotency-key"];
      const idempotencyKey = Array.isArray(idemKey) ? idemKey[0] : idemKey;

      const casesMatch = /^\/cases\/(\d+)$/.exec(path);
      const subMatch = /^\/cases\/(\d+)\/(versions|solution|check|compare|ledger)$/.exec(path);

      if (method === "GET" && path === "/cases") {
        const { limit, offset, extra } = paging(url);
        sendJson(res, 200, service.listCases(limit, offset, extra.search));
        return;
      }

      if (method === "POST" && path === "/cases") {
        const created = service.createCase(body as object, idempotencyKey);
        sendJson(res, 201, created);
        return;
      }

      if (casesMatch && method === "GET") {
        const { extra } = paging(url);
        const version = extra.version !== undefined ? Number(extra.version) : undefined;
        sendJson(res, 200, service.getCase(Number(casesMatch[1]), version));
        return;
      }

      if (subMatch) {
        const caseId = Number(subMatch[1]);
        const resource = subMatch[2];
        const { limit, offset, extra } = paging(url);

        if (resource === "versions" && method === "GET") {
          sendJson(res, 200, service.listVersions(caseId, limit, offset));
          return;
        }
        if (resource === "solution" && method === "GET") {
          const version = extra.version !== undefined ? Number(extra.version) : undefined;
          sendJson(res, 200, service.solveVersion(caseId, version));
          return;
        }
        if (resource === "compare" && method === "GET") {
          const version = extra.version !== undefined ? Number(extra.version) : undefined;
          sendJson(res, 200, service.compareArrangements(caseId, version));
          return;
        }
        if (resource === "ledger" && method === "GET") {
          sendJson(res, 200, service.ledger(caseId, limit, offset));
          return;
        }
        if (resource === "check" && method === "POST") {
          const b = body as {
            thOutMeasured?: number;
            tcOutMeasured?: number;
            version?: number;
          };
          if (typeof b.thOutMeasured !== "number" || typeof b.tcOutMeasured !== "number") {
            sendJson(res, 400, {
              error: {
                code: "VALIDATION_ERROR",
                message: "thOutMeasured and tcOutMeasured (deg C) are required",
              },
            });
            return;
          }
          sendJson(
            res,
            200,
            service.checkMeasured(
              caseId,
              { thOutMeasured: b.thOutMeasured, tcOutMeasured: b.tcOutMeasured },
              typeof b.version === "number" ? b.version : undefined,
            ),
          );
          return;
        }
      }

      const revMatch = /^\/cases\/(\d+)\/revisions$/.exec(path);
      if (revMatch && method === "POST") {
        sendJson(res, 201, service.revise(Number(revMatch[1]), body as object));
        return;
      }

      const scanMatch = /^\/cases\/(\d+)\/scan$/.exec(path);
      if (scanMatch && method === "GET") {
        const caseId = Number(scanMatch[1]);
        const { extra } = paging(url);
        const param = (extra.param ?? "mc") as "mc" | "mh" | "area";
        const view = service.getCase(
          caseId,
          extra.version !== undefined ? Number(extra.version) : undefined,
        );
        const defaultFrom = param === "area" ? 0 : 0.001;
        const values = linspace(
          Number(extra.from ?? defaultFrom),
          Number(extra.to ?? view.inputs[param] * 2),
          Number(extra.count ?? 11),
        );
        sendJson(res, 200, { param, points: scan(view.inputs, param, values) });
        return;
      }

      sendJson(res, 404, { error: { code: "NOT_FOUND", message: `No route for ${method} ${path}` } });
    } catch (err) {
      if (isAppError(err)) {
        sendJson(res, err.httpStatus, {
          error: { code: err.code, message: err.message, details: err.details },
        });
        return;
      }
      sendJson(res, 500, {
        error: { code: "INTERNAL", message: err instanceof Error ? err.message : "unknown error" },
      });
    }
  });

  return server;
}

/** Bind only to loopback; port 0 lets the OS assign a free port automatically. */
export function startServer(
  db: DatabaseSync,
  opts: { host?: string; port?: number; clock?: Clock } = {},
): Promise<StartedServer> {
  const host = opts.host ?? "127.0.0.1";
  const server = createApp(db, opts.clock);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      const addr = server.address() as AddressInfo;
      server.removeListener("error", reject);
      resolve({
        server,
        port: addr.port,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((e) => (e ? rej(e) : res())),
          ),
      });
    });
  });
}
