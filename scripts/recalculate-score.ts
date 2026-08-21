import { migrate } from "../src/lib/db";
import { buildRunScore, persistRunScores } from "../src/lib/run-score";
import { positionalArgs } from "./cli-args";
const runId = positionalArgs()[0];
if (!runId) throw new Error("usage: pnpm score:recalculate <runId>");
migrate();
const before = buildRunScore(runId);
const after = persistRunScores(runId);
console.log(
  JSON.stringify({ runId, before, after, modelVersion: "accesscheck-score-v1" }, null, 2),
);
