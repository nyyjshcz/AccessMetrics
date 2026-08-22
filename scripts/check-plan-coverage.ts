import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const planPath = path.join(root, "AccessCheck_Lishui_编码实施计划.md");
const coveragePath = path.join(root, "docs/plan-coverage.md");
const statusPath = path.join(root, "IMPLEMENTATION_STATUS.md");
const validationPath = path.join(root, "docs/validation-log.md");

const result = {
  passed: true,
  expectedSteps: 19,
  planSteps: [] as number[],
  missingRows: [] as number[],
  invalidRows: [] as number[],
  missingAnchors: [] as string[],
};

if (!fs.existsSync(planPath)) result.missingAnchors.push("AccessCheck_Lishui_编码实施计划.md");
if (!fs.existsSync(coveragePath)) result.missingAnchors.push("docs/plan-coverage.md");
if (!fs.existsSync(statusPath)) result.missingAnchors.push("IMPLEMENTATION_STATUS.md");
if (!fs.existsSync(validationPath)) result.missingAnchors.push("docs/validation-log.md");

if (result.missingAnchors.length === 0) {
  const plan = fs.readFileSync(planPath, "utf8");
  const coverage = fs.readFileSync(coveragePath, "utf8");
  const status = fs.readFileSync(statusPath, "utf8");
  const validation = fs.readFileSync(validationPath, "utf8");
  result.planSteps = [...plan.matchAll(/^### 步骤\s+(\d+)：/gm)].map((match) => Number(match[1]));
  const expected = Array.from({ length: result.expectedSteps }, (_, index) => index + 1);
  result.missingRows = expected.filter(
    (step) => !new RegExp(`^\\|\\s*${step}\\s*\\|`, "m").test(coverage),
  );
  result.invalidRows = expected.filter((step) => {
    const row = coverage.match(new RegExp(`^\\|\\s*${step}\\s*\\|.*$`, "m"))?.[0] ?? "";
    return (
      !row ||
      !/`(?:AUTOMATED_COMPLETE(?:_WAITING_EXTERNAL_INPUT|_WAITING_EXTERNAL_RUNTIME)?|WAITING_EXTERNAL_INPUT)`/.test(
        row,
      ) ||
      row.split("|").length < 6
    );
  });
  for (const anchor of [
    "R1–R5",
    "WAITING_EXTERNAL_INPUT",
    "pnpm test:all",
    "pnpm project:resume",
    "伪造",
  ]) {
    if (!coverage.includes(anchor) && !status.includes(anchor) && !validation.includes(anchor)) {
      result.missingAnchors.push(anchor);
    }
  }
  if (
    result.planSteps.length !== result.expectedSteps ||
    expected.some((step) => !result.planSteps.includes(step))
  ) {
    result.missingAnchors.push("plan execution headings 1-19");
  }
}

result.passed =
  result.missingAnchors.length === 0 &&
  result.missingRows.length === 0 &&
  result.invalidRows.length === 0;
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
