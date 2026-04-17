#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { registerDaemon } from "./commands/daemon";
import { registerAdd } from "./commands/add";
import { registerQuery } from "./commands/query";
import { registerDoctor } from "./commands/doctor";
import { registerHook } from "./commands/hook";
import { registerReflect } from "./commands/reflect";
import { registerDrain } from "./commands/drain";
import { registerBackup, registerRestore } from "./commands/backup";
import { registerAudit } from "./commands/audit";
import { registerTriage } from "./commands/triage";
import { registerEngramPull } from "./commands/engram-pull";

const program = new Command()
  .name("compost")
  .description("Compost — personal knowledge base CLI")
  .version("0.1.0");

registerDaemon(program);
registerAdd(program);
registerQuery(program);
registerDoctor(program);
registerHook(program);
registerReflect(program);
registerDrain(program);
registerBackup(program);
registerRestore(program);
registerAudit(program);
registerTriage(program);
registerEngramPull(program);

program.parse(process.argv);
