import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256 } from "../src/lib/canonical";
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((arg, index, array) =>
      arg.startsWith("--") ? [[arg.slice(2), array[index + 1] ?? ""]] : [],
    ),
);
if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm deliverables:candidate -- --source-export <absolute-dir> --review-freeze <absolute-file-or-dir> --candidate-files <absolute-dir> --output-root <absolute-dir>",
  );
  process.exit(0);
}
for (const key of ["source-export", "review-freeze", "candidate-files", "output-root"])
  if (!args[key]) throw new Error(`缺少 --${key}`);
for (const key of ["source-export", "review-freeze", "candidate-files", "output-root"])
  if (!path.isAbsolute(args[key])) throw new Error(`--${key} 必须是绝对路径`);
if (!path.isAbsolute(args["output-root"])) throw new Error("--output-root 必须是绝对路径");
if (!fs.existsSync(args["source-export"])) throw new Error("source export 不存在");
if (!fs.existsSync(args["review-freeze"])) throw new Error("review-freeze 不存在");
if (!fs.existsSync(args["candidate-files"]) || !fs.statSync(args["candidate-files"]).isDirectory())
  throw new Error("candidate-files 必须是包含候选报告产物的目录");
const sourceManifest = path.join(args["source-export"], "manifest.json");
if (!fs.existsSync(sourceManifest)) throw new Error("source export 缺少 manifest.json");
const sourceManifestHash = sha256(fs.readFileSync(sourceManifest));
function contentListing(root: string) {
  const files: Array<{ path: string; size: number; sha256: string }> = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`符号链接不允许进入 candidate: ${full}`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(full);
        files.push({
          path: path.relative(root, full).replaceAll(path.sep, "/"),
          size: bytes.length,
          sha256: sha256(bytes),
        });
      }
    }
  };
  if (fs.statSync(root).isDirectory()) walk(root);
  else {
    const bytes = fs.readFileSync(root);
    files.push({ path: path.basename(root), size: bytes.length, sha256: sha256(bytes) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
const reviewFreezeFiles = contentListing(args["review-freeze"]);
const reviewFreezeBytes = Buffer.from(canonicalize(reviewFreezeFiles));
const reviewFreezeHash = sha256(reviewFreezeBytes);
const bundleId = sha256(`${sourceManifestHash}|${reviewFreezeHash}|candidate-bundle-v1`).slice(
  0,
  32,
);
const dir = path.join(args["output-root"], bundleId);
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(sourceManifest, path.join(dir, "source-manifest.json"));
fs.writeFileSync(path.join(dir, "review-freeze.sha256"), `${reviewFreezeHash}\n`);
fs.writeFileSync(
  path.join(dir, "review-freeze-manifest.json"),
  `${canonicalize(reviewFreezeFiles)}\n`,
);
const bundle = {
  schemaVersion: "candidate-bundle-v1",
  candidateBundleId: bundleId,
  sourceManifestHash,
  files: [
    {
      path: "source-manifest.json",
      sha256: sha256(fs.readFileSync(path.join(dir, "source-manifest.json"))),
    },
    {
      path: "review-freeze.sha256",
      sha256: sha256(fs.readFileSync(path.join(dir, "review-freeze.sha256"))),
    },
    {
      path: "review-freeze-manifest.json",
      sha256: sha256(fs.readFileSync(path.join(dir, "review-freeze-manifest.json"))),
    },
  ].concat(
    contentListing(args["candidate-files"]).map((file) => ({
      path: `candidate/${file.path}`,
      sha256: file.sha256,
    })),
  ),
  status: "review_candidate",
};
const bundleBytes = Buffer.from(`${canonicalize(bundle)}\n`);
const bundlePath = path.join(dir, "candidate-bundle.json");
if (fs.existsSync(bundlePath) && !fs.readFileSync(bundlePath).equals(bundleBytes))
  throw new Error("candidate bundle 已存在但字节不同，拒绝覆盖");
fs.writeFileSync(bundlePath, bundleBytes);
for (const file of contentListing(args["candidate-files"])) {
  const destination = path.join(dir, "candidate", file.path);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(args["candidate-files"], file.path), destination);
}
fs.writeFileSync(
  path.join(dir, "STATUS.txt"),
  "REVIEW CANDIDATE — NOT FINAL\n真实 R4 之前不得生成 study_final。\n",
);
console.log(
  JSON.stringify({ candidateBundleId: bundleId, path: dir, status: "candidate_only" }, null, 2),
);
