import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { positionalArgs } from "./cli-args";

if (process.argv.includes("--help")) {
  console.log("usage: pnpm analysis:run -- <verified-export-directory>");
  process.exit(0);
}
const directory = positionalArgs()[0];
if (!directory || !path.isAbsolute(directory))
  throw new Error("analysis input must be an absolute export directory");
if (
  !fs.existsSync(path.join(directory, "manifest.json")) ||
  !fs.existsSync(path.join(directory, "manifest.sha256"))
)
  throw new Error("verified export must contain manifest.json and manifest.sha256");
const python = process.env.PYTHON ?? "python";
const output = path.join(process.cwd(), "analysis", "outputs");
fs.mkdirSync(output, { recursive: true });
const analysisRoot = path.join(process.cwd(), "analysis");
const analysisEnv = { ...process.env, ANALYSIS_OUTPUT_DIR: output, PYTHONIOENCODING: "utf-8" };
const result = spawnSync(python, [path.join(analysisRoot, "analyze.py"), directory], {
  encoding: "utf8",
  env: analysisEnv,
});
if (result.status !== 0) {
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}
const reportData = path.join(output, "report-data.json");
fs.writeFileSync(reportData, `${result.stdout.trim()}\n`);

const sourceNotebook = path.join(analysisRoot, "notebooks", "accesscheck_analysis.ipynb");
const executedNotebook = path.join(output, "accesscheck_analysis.executed.ipynb");
const notebookEnv = {
  ...analysisEnv,
  ACCESSCHECK_EXPORT_DIR: directory,
  ANALYSIS_OUTPUT_DIR: output,
};
const jupyter = spawnSync(
  process.env.JUPYTER ?? (process.platform === "win32" ? "jupyter.exe" : "jupyter"),
  [
    "nbconvert",
    "--to",
    "notebook",
    "--execute",
    "--ExecutePreprocessor.timeout=300",
    "--output",
    path.basename(executedNotebook, ".ipynb"),
    "--output-dir",
    output,
    sourceNotebook,
  ],
  { encoding: "utf8", env: notebookEnv },
);
if (jupyter.status !== 0) {
  const commandMissing =
    (jupyter.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" ||
    jupyter.status === 127;
  if (!commandMissing) {
    process.stderr.write(jupyter.stderr ?? "");
    process.exit(jupyter.status ?? 1);
  }
  const fallback = spawnSync(
    python,
    [path.join(analysisRoot, "execute_notebook.py"), sourceNotebook, executedNotebook],
    { encoding: "utf8", env: notebookEnv },
  );
  if (fallback.status !== 0) {
    process.stderr.write(fallback.stderr ?? "");
    process.exit(fallback.status ?? 1);
  }
}
if (!fs.existsSync(executedNotebook)) throw new Error("executed notebook was not produced");
const executed = JSON.parse(fs.readFileSync(executedNotebook, "utf8")) as {
  cells?: Array<{ cell_type?: string; execution_count?: number | null }>;
};
for (const cell of executed.cells ?? []) {
  if (cell.cell_type === "code" && typeof cell.execution_count !== "number")
    throw new Error("executed notebook contains an unexecuted code cell");
}
console.log(
  JSON.stringify({
    status: "completed",
    input: directory,
    output: reportData,
    notebook: executedNotebook,
  }),
);
