import { migrate } from "../src/lib/db";
import { createStudyExport } from "../src/lib/study-export";

const args: Record<string, string> = {};
for (let index = 2; index < process.argv.length; index++) {
  if (process.argv[index] === "--") continue;
  if (!process.argv[index].startsWith("--")) continue;
  args[process.argv[index].slice(2)] = process.argv[index + 1] ?? "";
  index++;
}
if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm export:study -- --freeze <id> --kind study_source|study_final [--source-export <id>]",
  );
  process.exit(0);
}
if (!args.freeze || !["study_source", "study_final"].includes(args.kind))
  throw new Error("必须提供 --freeze 和 --kind study_source|study_final");
if (args.kind === "study_final" && !args["source-export"])
  throw new Error("study_final 必须显式提供已验证 --source-export");
migrate();
console.log(
  JSON.stringify(
    createStudyExport({
      studyFreezeId: args.freeze,
      kind: args.kind as "study_source" | "study_final",
      expectedSourceExportId: args["source-export"],
    }),
    null,
    2,
  ),
);
