import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Provider fixtures must never contend with the user's live Ollama requests.
const fixtureDir = mkdtempSync(join(tmpdir(), "compost-test-provider-"));
process.env["ZYLO_OLLAMA_LOCK_DIR"] = join(fixtureDir, "ollama.lock");
process.on("exit", () => rmSync(fixtureDir, { recursive: true, force: true }));
