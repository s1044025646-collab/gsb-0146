import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cliTs = join(root, "src", "cli", "cli.ts");
const dbPath = join(tmpdir(), `hx-cli-${process.pid}-${Date.now()}.db`);

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--experimental-sqlite", "--import", "tsx", cliTs, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HX_DB_PATH: dbPath },
  });
  return { status: result.status ?? 0, stdout: result.stdout, stderr: result.stderr };
}

describe("CLI end to end", () => {
  before(() => mkdirSync(tmpdir(), { recursive: true }));
  after(() => rmSync(dbPath, { force: true }));

  it("solves the hand anchor", () => {
    const r = run(["solve", "--fixture=equalCapacityCounter"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /160000\.000/);
    assert.match(r.stdout, /BEFORE/);
  });

  it("exits non-zero with an error code on invalid input", () => {
    const r = run(["solve", "--fixture=missing"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /\[NOT_FOUND\]/);
  });

  it("creates and revises a case with versions, and lists with paging", () => {
    const create = run(["case", "create", "--id=cli1", "--name=CLI", "--fixture=equalCapacityCounter"]);
    assert.equal(create.status, 0, create.stderr);
    assert.match(create.stdout, /version 1/);

    const idempotent = run(["case", "create", "--id=cli1", "--name=CLI", "--fixture=equalCapacityCounter"]);
    assert.notEqual(idempotent.status, 0); // conflict without idempotency key

    const revise = run(["case", "revise", "cli1", "--fixture=fouledCounter"]);
    assert.equal(revise.status, 0, revise.stderr);
    assert.match(revise.stdout, /version 2/);

    const versions = run(["case", "versions", "cli1"]);
    assert.match(versions.stdout, /v1/);
    assert.match(versions.stdout, /v2/);

    const list = run(["case", "list", "--limit=1"]);
    assert.match(list.stdout, /total=1/);
  });

  it("compare and scan and ledger run", () => {
    assert.equal(run(["compare", "--fixture=equalCapacityCounter"]).status, 0);
    assert.equal(run(["scan", "--fixture=equalCapacityCounter", "--param=area", "--values=1,2,4"]).status, 0);
    assert.equal(run(["ledger", "--fixture=equalCapacityCounter"]).status, 0);
  });
});

// execFileSync kept available for future extension without adding deps.
void execFileSync;
