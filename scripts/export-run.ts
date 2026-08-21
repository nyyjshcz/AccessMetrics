import { migrate } from "../src/lib/db";
import { exportRun } from "../src/lib/export";
import { positionalArgs } from "./cli-args";
const runId = positionalArgs()[0];
if (!runId) throw new Error("usage: pnpm export:run <runId>");
migrate();
console.log(JSON.stringify(exportRun(runId), null, 2));
