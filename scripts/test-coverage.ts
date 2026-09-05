import { readFileSync, rmSync } from "fs";
import { join, resolve } from "path";

// Gate the weighted, project-wide LCOV line coverage, using the same emitted
// artifact locally and in CI. Do not average file percentages or omit low files.
const root = resolve(import.meta.dir, "..");
const report = join(root, "coverage", "lcov.info");
rmSync(report, { force: true });
const child = Bun.spawn(["bun", "test", "--coverage"], {
  cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
const code = await child.exited;
if (code !== 0) process.exit(code);
const records = readFileSync(report, "utf8").split("end_of_record");
let total = 0;
let covered = 0;
const files = new Set<string>();
for (const record of records) {
  const file = /^SF:(.+)$/m.exec(record)?.[1];
  if (!file) continue;
  if (files.has(file)) throw new Error(`Duplicate coverage record: ${file}`);
  files.add(file);
  const found = /^LF:(\d+)$/m.exec(record)?.[1];
  const hit = /^LH:(\d+)$/m.exec(record)?.[1];
  if (!found || !hit) throw new Error(`Missing line counters: ${file}`);
  total += Number(found);
  covered += Number(hit);
}
if (!total) throw new Error("No coverage data produced");
console.log(`LCOV line coverage: ${covered}/${total} = ${(100 * covered / total).toFixed(2)}% (required >=90%)`);
if (covered / total < 0.90) process.exit(1);
