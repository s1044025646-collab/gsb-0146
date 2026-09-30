import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Temp directories always stay inside the project. */
export function projectTemp(prefix: string): string {
  const root = join(process.cwd(), ".tmp-test");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, prefix));
}

/** Windows can briefly hold WAL handles; retry removal a few times. */
export function removeRetry(path: string, attempts = 5): void {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      const wait = (ms: number) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {}
      };
      wait(100 * (i + 1));
    }
  }
}
