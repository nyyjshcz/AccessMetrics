import fs from "node:fs";
import path from "node:path";

const exercise = process.argv[2];
const checks = {
  "dependency-preflight": () => {
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const lockfile = fs.readFileSync("pnpm-lock.yaml", "utf8");
    if (packageJson.packageManager !== "pnpm@11.19.0") throw new Error("package manager drift");
    if (!lockfile.includes("lockfileVersion:")) throw new Error("lockfile missing");
  },
  "fixture-scan": () => {
    const fixture = path.join("tests", "fixtures", "known-issues", "valid.html");
    if (!fs.existsSync(fixture)) throw new Error("known issue fixture missing");
    if (!fs.readFileSync(fixture, "utf8").includes("<html"))
      throw new Error("fixture content changed");
  },
  "worker-recovery": () => {
    const worker = fs.readFileSync(path.join("src", "worker", "index.ts"), "utf8");
    if (!worker.includes("lease") || !worker.includes("heartbeat"))
      throw new Error("worker lease recovery contract missing");
  },
  "export-manifest": () => {
    const manifest = fs.readFileSync(path.join("src", "lib", "export.ts"), "utf8");
    if (!manifest.includes("manifestHash") || !manifest.includes("sha256"))
      throw new Error("manifest hash contract missing");
  },
  "backup-restore": () => {
    const backup = fs.readFileSync(path.join("scripts", "backup-restore.ts"), "utf8");
    if (
      !backup.includes("BACKUP-MANIFEST") ||
      !backup.includes("aes-256-gcm") ||
      !backup.includes("sha256")
    )
      throw new Error("backup integrity contract missing");
  },
  "publication-fail-closed": () => {
    const route = fs.readFileSync(
      path.join("src", "app", "api", "exports", "studies", "[exportId].zip", "route.ts"),
      "utf8",
    );
    if (!route.includes("publication_status") || !route.includes("publication_gate_bundle_hash"))
      throw new Error("publication fail-closed contract missing");
  },
};

if (!exercise || !Object.hasOwn(checks, exercise)) {
  console.error("unknown fixed R5 exercise");
  process.exit(2);
}
checks[exercise]();
process.stdout.write(
  JSON.stringify({ schemaVersion: "r5-fixed-exercise-result-v1", exercise, passed: true }) + "\n",
);
