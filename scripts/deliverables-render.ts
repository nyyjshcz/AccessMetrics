import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256 } from "../src/lib/canonical";
const options: Record<string, string> = {};
for (let index = 2; index < process.argv.length; index++) {
  if (!process.argv[index].startsWith("--")) continue;
  options[process.argv[index].slice(2)] = process.argv[index + 1] ?? "";
  index++;
}
if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm deliverables:render -- --input-dir <absolute-dir> --output-dir <absolute-dir> [--qa-log <absolute-json>]",
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
if (options["qa-log"] && !path.isAbsolute(options["qa-log"]))
  throw new Error("--qa-log 必须是绝对路径");
if (!fs.existsSync(options["input-dir"])) throw new Error("input-dir 不存在");
try {
  execFileSync("soffice", ["--version"], { stdio: "ignore" });
  execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
} catch {
  throw new Error("缺少固定 LibreOffice/Poppler 渲染器；不能仅改扩展名冒充渲染验证");
}
fs.mkdirSync(options["output-dir"], { recursive: true });
const collectDocx = (directory: string): string[] => {
  const result: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...collectDocx(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".docx")) result.push(full);
  }
  return result;
};
const rendered: Array<{ docx: string; pdf: string; png: string[] }> = [];
for (const input of collectDocx(options["input-dir"])) {
  const relative = path.relative(options["input-dir"], input);
  const relativeDirectory = path.dirname(relative);
  const outputDirectory = path.join(options["output-dir"], relativeDirectory);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const stem = path.basename(input).replace(/\.docx$/i, "");
  execFileSync(
    "soffice",
    ["--headless", "--convert-to", "pdf", "--outdir", outputDirectory, input],
    { stdio: "inherit" },
  );
  const pdf = path.join(outputDirectory, `${stem}.pdf`);
  if (!fs.existsSync(pdf) || fs.statSync(pdf).size === 0)
    throw new Error(`PDF 未生成或为空: ${pdf}`);
  const prefix = path.join(outputDirectory, stem);
  execFileSync("pdftoppm", ["-png", "-r", "144", pdf, prefix], { stdio: "inherit" });
  const png = fs
    .readdirSync(outputDirectory)
    .filter((name) => name.startsWith(`${stem}-`) && name.endsWith(".png"))
    .map((name) => path.join(outputDirectory, name))
    .filter((filePath) => fs.statSync(filePath).size > 0);
  if (!png.length) throw new Error(`PDF 未生成逐页 PNG: ${pdf}`);
  rendered.push({ docx: input, pdf, png });
}
const collectManifests = (directory: string): string[] => {
  const result: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...collectManifests(full));
    else if (entry.isFile() && entry.name === "report-manifest.json") result.push(full);
  }
  return result;
};
const manifests = collectManifests(options["input-dir"]);
if (manifests.length && path.resolve(options["input-dir"]) !== path.resolve(options["output-dir"]))
  throw new Error(
    "包含 report-manifest.json 的报告必须把 output-dir 指向同一报告目录，才能绑定 PDF hash",
  );
for (const artifactManifest of manifests) {
  const manifestDirectory = path.dirname(artifactManifest);
  const manifest = JSON.parse(fs.readFileSync(artifactManifest, "utf8")) as {
    files?: Array<{ path: string; sha256: string }>;
  };
  if (!Array.isArray(manifest.files)) throw new Error("report-manifest.json files 无效");
  for (const result of rendered.filter((item) => path.dirname(item.pdf) === manifestDirectory)) {
    const relative = path.basename(result.pdf).replaceAll("\\", "/");
    const entry = { path: relative, sha256: sha256(fs.readFileSync(result.pdf)) };
    const existing = manifest.files.find((file) => file.path === relative);
    if (existing && existing.sha256 !== entry.sha256)
      throw new Error(`报告 PDF 已存在但 hash 不同: ${relative}`);
    if (!existing) manifest.files.push(entry);
  }
  const temporaryManifest = `${artifactManifest}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryManifest, `${canonicalize(manifest)}\n`);
  fs.renameSync(temporaryManifest, artifactManifest);
}
const qa = {
  schemaVersion: "document-render-qa-v1",
  inputDir: options["input-dir"],
  outputDir: options["output-dir"],
  rendered: rendered.map((item) => ({
    docx: path.relative(options["input-dir"], item.docx).replaceAll("\\", "/"),
    pdf: path.relative(options["output-dir"], item.pdf).replaceAll("\\", "/"),
    pdfSha256: sha256(fs.readFileSync(item.pdf)),
    pageImages: item.png.map((file) =>
      path.relative(options["output-dir"], file).replaceAll("\\", "/"),
    ),
  })),
  structuralStatus: "passed",
  visualReviewStatus: "WAITING_HUMAN_REVIEW",
  note: "自动渲染只证明 PDF 和逐页 PNG 已生成；空页、乱码、表格溢出、阅读顺序和 PDF/UA 仍需逐页复核。",
};
const qaPath =
  options["qa-log"] && path.isAbsolute(options["qa-log"])
    ? options["qa-log"]
    : path.join(options["output-dir"], "document-render-qa.json");
fs.writeFileSync(qaPath, `${canonicalize(qa)}\n`);
console.log(
  JSON.stringify(
    {
      status: "rendered",
      inputDir: options["input-dir"],
      outputDir: options["output-dir"],
      qa: qaPath,
    },
    null,
    2,
  ),
);
