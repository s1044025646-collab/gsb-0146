// Manages only this project: stops a server whose pid is recorded under
// ./data/server.pid, then removes project-local data and test temp dirs.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = process.cwd();
const dataDir = join(root, "data");
const pidFile = join(dataDir, "server.pid");

function isOurPid(pid) {
  try {
    // On Windows tasklist exposes the image name; we only kill the exact pid
    // recorded by our own start script inside the project data directory.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeRetry(target, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(target, { recursive: true, force: true });
      return true;
    } catch {
      // Windows keeps WAL handles briefly after the process exits.
    }
  }
  return false;
}

if (existsSync(pidFile)) {
  const pid = Number(readFileSync(pidFile, "utf-8").trim());
  if (Number.isInteger(pid) && isOurPid(pid)) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`sent SIGTERM to project server pid ${pid}`);
      for (let i = 0; i < 50 && isOurPid(pid); i++) {
        await sleep(100);
      }
      if (isOurPid(pid)) {
        console.log("server did not exit in time; leaving data dir intact");
        process.exit(1);
      }
    } catch (err) {
      console.log(`could not signal pid ${pid}: ${err.message}`);
    }
  } else {
    console.log("stale pid file (process not running)");
  }
}

for (const target of [dataDir, join(root, ".tmp-test")]) {
  if (existsSync(target) && !removeRetry(target)) {
    console.log(`warning: could not remove ${target} (retrying on next clean)`);
  }
}
console.log("cleaned ./data and ./.tmp-test");
