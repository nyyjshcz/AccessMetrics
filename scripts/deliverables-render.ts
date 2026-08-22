import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { canonicalize, sha256 } from "../src/lib/canonical";
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function imageDataUri(baseDirectory: string, relativePath: string): string | null {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).some((part) => part === ".."))
    return null;
  const file = path.resolve(baseDirectory, relativePath);
  if (!file.startsWith(`${path.resolve(baseDirectory)}${path.sep}`) || !fs.existsSync(file))
    return null;
  const extension = path.extname(file).toLowerCase();
  const mime =
    extension === ".png"
      ? "image/png"
      : extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : null;
  return mime ? `data:${mime};base64,${fs.readFileSync(file).toString("base64")}` : null;
}

function inlineHtml(value: string, baseDirectory: string): string {
  let html = escapeHtml(value);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, source: string) => {
    const uri = imageDataUri(baseDirectory, source);
    return uri
      ? `<img src="${uri}" alt="${escapeHtml(alt)}">`
      : `<span>[${escapeHtml(alt)}]</span>`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    const safeHref = /^https?:\/\//.test(href) || /^(charts|tables)\//.test(href) ? href : "#";
    return `<a href="${escapeHtml(safeHref)}">${label}</a>`;
  });
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}

function markdownToPrintHtml(markdown: string, baseDirectory: string): string {
  const lines = markdown.split(/\r?\n/);
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        `<h${heading[1].length}>${inlineHtml(heading[2], baseDirectory)}</h${heading[1].length}>`,
      );
      index++;
      continue;
    }
    if (
      line.startsWith("| ") &&
      index + 1 < lines.length &&
      /^\|?\s*:?-{3,}/.test(lines[index + 1])
    ) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index].startsWith("|")) {
        const current = lines[index];
        if (!/^\|?\s*:?-{3,}/.test(current))
          rows.push(
            current
              .trim()
              .replace(/^\|/, "")
              .replace(/\|$/, "")
              .split("|")
              .map((value) => value.trim().replaceAll("\\|", "|")),
          );
        index++;
      }
      const [header, ...body] = rows;
      blocks.push(
        `<table><thead><tr>${(header ?? []).map((value) => `<th scope="col">${inlineHtml(value, baseDirectory)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((value) => `<td>${inlineHtml(value, baseDirectory)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(`<li>${inlineHtml(lines[index].replace(/^[-*]\s+/, ""), baseDirectory)}</li>`);
        index++;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (line.startsWith("> "))
      blocks.push(`<blockquote>${inlineHtml(line.slice(2), baseDirectory)}</blockquote>`);
    else blocks.push(`<p>${inlineHtml(line, baseDirectory)}</p>`);
    index++;
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font-family:Arial,"Noto Sans CJK SC",sans-serif;color:#172033;line-height:1.6}h1{font-size:24px;page-break-before:avoid}h2{font-size:18px;page-break-after:avoid}h3{font-size:15px;page-break-after:avoid}table{border-collapse:collapse;width:100%;margin:12px 0;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border:1px solid #ccd6e0;padding:6px;text-align:left;vertical-align:top}th{background:#eef3f7}img{max-width:100%;height:auto}blockquote{border-left:4px solid #527da5;padding:6px 12px;background:#f1f6fa}code{font-family:Consolas,monospace;overflow-wrap:anywhere}a{color:#145a86;text-decoration:underline}</style></head><body>${blocks.join("\n")}</body></html>`;
}

async function renderMarkdownPdf(markdownPath: string, pdfPath: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      markdownToPrintHtml(fs.readFileSync(markdownPath, "utf8"), path.dirname(markdownPath)),
      { waitUntil: "load" },
    );
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        '<div style="font-size:8px;width:100%;text-align:center">第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</div>',
      margin: { top: "18mm", bottom: "18mm", left: "18mm", right: "18mm" },
    });
  } finally {
    await browser.close();
  }
}

async function main() {
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
    return;
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
  const collectMarkdown = (directory: string): string[] => {
    const result: string[] = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...collectMarkdown(full));
      else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
        result.push(full);
    }
    return result;
  };
  const collectDocx = (directory: string): string[] => {
    const result: string[] = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...collectDocx(full));
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".docx")) result.push(full);
    }
    return result;
  };
  const rendered: Array<{
    markdown: string;
    printPdf: string;
    docx: string;
    docxPdf: string;
    png: string[];
  }> = [];
  for (const input of collectMarkdown(options["input-dir"])) {
    const relative = path.relative(options["input-dir"], input);
    const relativeDirectory = path.dirname(relative);
    const outputDirectory = path.join(options["output-dir"], relativeDirectory);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const stem = path.basename(input).replace(/\.md$/i, "");
    const printPdf = path.join(outputDirectory, `${stem}.pdf`);
    await renderMarkdownPdf(input, printPdf);
    if (!fs.existsSync(printPdf) || fs.statSync(printPdf).size === 0)
      throw new Error(`打印 HTML PDF 未生成或为空: ${printPdf}`);
    rendered.push({ markdown: input, printPdf, docx: "", docxPdf: "", png: [] });
  }
  for (const input of collectDocx(options["input-dir"])) {
    const relative = path.relative(options["input-dir"], input);
    const relativeDirectory = path.dirname(relative);
    const outputDirectory = path.join(options["output-dir"], ".qa-render", relativeDirectory);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const stem = path.basename(input).replace(/\.docx$/i, "");
    execFileSync(
      "soffice",
      ["--headless", "--convert-to", "pdf", "--outdir", outputDirectory, input],
      { stdio: "inherit" },
    );
    const docxPdf = path.join(outputDirectory, `${stem}.pdf`);
    if (!fs.existsSync(docxPdf) || fs.statSync(docxPdf).size === 0)
      throw new Error(`DOCX QA PDF 未生成或为空: ${docxPdf}`);
    const prefix = path.join(outputDirectory, stem);
    execFileSync("pdftoppm", ["-png", "-r", "144", docxPdf, prefix], { stdio: "inherit" });
    const png = fs
      .readdirSync(outputDirectory)
      .filter((name) => name.startsWith(`${stem}-`) && name.endsWith(".png"))
      .map((name) => path.join(outputDirectory, name))
      .filter((filePath) => fs.statSync(filePath).size > 0);
    if (!png.length) throw new Error(`DOCX QA PDF 未生成逐页 PNG: ${docxPdf}`);
    const markdown = rendered.find(
      (item) =>
        item.markdown &&
        path.dirname(path.relative(options["input-dir"], item.markdown)) === relativeDirectory &&
        path.basename(item.markdown, ".md") === stem,
    );
    if (markdown) {
      markdown.docx = input;
      markdown.docxPdf = docxPdf;
      markdown.png = png;
    } else {
      rendered.push({ markdown: "", printPdf: "", docx: input, docxPdf, png });
    }
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
  if (
    manifests.length &&
    path.resolve(options["input-dir"]) !== path.resolve(options["output-dir"])
  )
    throw new Error(
      "包含 report-manifest.json 的报告必须把 output-dir 指向同一报告目录，才能绑定 PDF hash",
    );
  for (const artifactManifest of manifests) {
    const manifestDirectory = path.dirname(artifactManifest);
    const manifest = JSON.parse(fs.readFileSync(artifactManifest, "utf8")) as {
      files?: Array<{ path: string; sha256: string }>;
    };
    if (!Array.isArray(manifest.files)) throw new Error("report-manifest.json files 无效");
    for (const result of rendered.filter(
      (item) => item.printPdf && path.dirname(item.printPdf) === manifestDirectory,
    )) {
      const relative = path.basename(result.printPdf).replaceAll("\\", "/");
      const entry = { path: relative, sha256: sha256(fs.readFileSync(result.printPdf)) };
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
      markdown: item.markdown
        ? path.relative(options["input-dir"], item.markdown).replaceAll("\\", "/")
        : null,
      printPdf: item.printPdf
        ? path.relative(options["output-dir"], item.printPdf).replaceAll("\\", "/")
        : null,
      printPdfSha256: item.printPdf ? sha256(fs.readFileSync(item.printPdf)) : null,
      docx: item.docx ? path.relative(options["input-dir"], item.docx).replaceAll("\\", "/") : null,
      docxQaPdf: item.docxPdf
        ? path.relative(options["output-dir"], item.docxPdf).replaceAll("\\", "/")
        : null,
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
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
