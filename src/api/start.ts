import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { Db } from "../db/database.ts";
import { createApiServer } from "./server.ts";

export interface StartOptions {
  dbPath: string;
  host?: string;
  port?: number; // 0 = OS-assigned free port
}

export interface StartedServer {
  port: number;
  close: () => Promise<void>;
}

export async function startApi(opts: StartOptions): Promise<StartedServer> {
  const absoluteDb = resolve(opts.dbPath);
  mkdirSync(dirname(absoluteDb), { recursive: true });
  const db = new Db(absoluteDb);
  db.migrate();
  const server = createApiServer({ db });

  await new Promise<void>((resolveStart) => {
    server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", () => resolveStart());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? 0);

  return {
    port,
    close: () =>
      new Promise<void>((done, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else {
            db.close();
            done();
          }
        });
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dbPath = process.env.HX_DB_PATH ?? "data/hx.db";
  void startApi({ dbPath, host: "127.0.0.1", port: Number(process.env.HX_PORT ?? 0) }).then((s) => {
    const pidFile = resolve(".server.pid");
    if (!existsSync(pidFile)) {
      writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port: s.port, dbPath, startedAt: new Date().toISOString() }));
    }
    console.log(`[hx] API listening on http://127.0.0.1:${s.port} (pid ${process.pid}, db ${dbPath})`);
    const stop = () => {
      void s.close().then(() => process.exit(0));
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
