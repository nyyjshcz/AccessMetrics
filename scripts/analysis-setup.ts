import fs from "node:fs";
import path from "node:path";

if (process.argv.includes("--help")) {
  console.log("usage: pnpm analysis:setup");
  process.exit(0);
}
const root = path.join(process.cwd(), "analysis", "outputs");
for (const file of [
  "analysis/requirements.txt",
  "analysis/requirements.lock.txt",
  "analysis/notebooks/accesscheck_analysis.ipynb",
  "analysis/execute_notebook.py",
])
  if (!fs.existsSync(path.join(process.cwd(), file)))
    throw new Error(`analysis dependency/artifact missing: ${file}`);
for (const directory of [root, path.join(root, "charts"), path.join(root, "tables")])
  fs.mkdirSync(directory, { recursive: true });
console.log(JSON.stringify({ status: "ready", outputRoot: root }));
