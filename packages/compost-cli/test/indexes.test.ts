import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { runCli } from "./run-cli";

test("indexes CLI reports corruption and rebuilds without changing actions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compost-index-cli-"));
  try {
    const first = await runCli(["indexes"], dir);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout).ok).toBe(true);
    const db = new Database(join(dir, "ledger.db"));
    db.run(
      "INSERT INTO action_log(action_id,source_system,source_id,who,what_text) VALUES('a','manual','a','user','索引修复')",
    );
    db.run("DELETE FROM action_log_cjk");
    db.close();
    const broken = await runCli(["indexes"], dir);
    expect(broken.code).toBe(1);
    const rebuilt = await runCli(["indexes", "--rebuild"], dir);
    expect(rebuilt.code).toBe(0);
    expect(JSON.parse(rebuilt.stdout).ok).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
