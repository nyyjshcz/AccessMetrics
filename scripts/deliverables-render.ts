import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const options: Record<string, string> = {};
for (let index = 2; index < process.argv.length; index++) {
  if (!process.argv[index].startsWith("--")) continue;
  options[process.argv[index].slice(2)] = process.argv[index + 1] ?? "";
  index++;
}
if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm deliverables:render -- --input-dir <absolute-dir> --output-dir <absolute-dir>",
  );
  process.exit(0);
}
if (
  !options["input-dir"] ||
  !options["output-dir"] ||
  !path.isAbsolute(options["input-dir"]) ||
  !path.isAbsolute(options["output-dir"])
)
  throw new Error("需要绝对 input-dir 和 output-dir");
if (!fs.existsSync(options["input-dir"])) throw new Error("input-dir 不存在");
try {
  execFileSync("soffice", ["--version"], { stdio: "ignore" });
  execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
} catch {
  throw new Error("缺少固定 LibreOffice/Poppler 渲染器；不能仅改扩展名冒充渲染验证");
}
fs.mkdirSync(options["output-dir"], { recursive: true });
for (const file of fs.readdirSync(options["input-dir"]).filter((name) => name.endsWith(".docx"))) {
  const input = path.join(options["input-dir"], file);
  execFileSync(
    "soffice",
    ["--headless", "--convert-to", "pdf", "--outdir", options["output-dir"], input],
    { stdio: "inherit" },
  );
  const pdf = path.join(options["output-dir"], file.replace(/\.docx$/i, ".pdf"));
  execFileSync(
    "pdftoppm",
    ["-png", "-r", "144", pdf, path.join(options["output-dir"], file.replace(/\.docx$/i, ""))],
    { stdio: "inherit" },
  );
}
console.log(
  JSON.stringify(
    { status: "rendered", inputDir: options["input-dir"], outputDir: options["output-dir"] },
    null,
    2,
  ),
);
