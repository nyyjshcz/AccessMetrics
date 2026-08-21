import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const expectedNode = "24.19.0";
const expectedPython = "3.12.13";
const expectedPnpm = "11.19.0";
const actualNode = process.versions.node;
const results = [];

function assert(condition, message) {
  results.push({ ok: Boolean(condition), message });
}

assert(actualNode === expectedNode, `Node.js ${expectedNode} required; found ${actualNode}`);
assert(
  pkg.packageManager === `pnpm@${expectedPnpm}`,
  "packageManager must pin the available stable pnpm runtime",
);
const pnpmCommand = process.env.PNPM_BIN ?? "pnpm";
const pnpmProbe =
  process.platform === "win32"
    ? spawnSync(
        process.env.ComSpec ?? "cmd.exe",
        [
          "/d",
          "/s",
          "/c",
          `${pnpmCommand.includes(" ") ? `"${pnpmCommand.replaceAll('"', '""')}"` : pnpmCommand} --version`,
        ],
        { encoding: "utf8" },
      )
    : spawnSync(pnpmCommand, ["--version"], { encoding: "utf8" });
const pnpmOutput = `${pnpmProbe.stdout ?? ""}\n${pnpmProbe.stderr ?? ""}`;
const actualPnpm = pnpmOutput.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? "unavailable";
assert(
  actualPnpm === expectedPnpm,
  `pnpm ${expectedPnpm} required; found ${actualPnpm} (command: ${pnpmCommand})`,
);
assert(pkg.dependencies.playwright === "1.62.0", "Playwright must be exact 1.62.0");
assert(
  pkg.dependencies["@axe-core/playwright"] === "4.13.0",
  "axe Playwright adapter must be exact 4.13.0",
);
assert(pkg.dependencies["axe-core"] === "4.13.0", "axe-core must be exact 4.13.0");
assert(pkg.dependencies.next === "16.3.0", "Next.js must be exact 16.3.0");
assert(pkg.dependencies["@next/env"] === "16.3.0", "@next/env must follow Next.js 16.3.0");
assert(pkg.dependencies["drizzle-orm"] === "0.45.2", "Drizzle ORM must be exact 0.45.2");
assert(pkg.dependencies["react-is"] === "19.2.8", "react-is must match React 19.2.8");

const prerelease = /(?:alpha|beta|canary|rc|next|experimental|dev|nightly)/i;
const packages = { ...pkg.dependencies, ...pkg.devDependencies };
const networkFailures = [];
for (const [name, version] of Object.entries(packages)) {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const metadata = await response.json();
    assert(metadata.version === version, `${name}@${version} metadata resolved`);
    assert(!prerelease.test(metadata.version), `${name}@${version} is not a prerelease`);
  } catch (error) {
    networkFailures.push(
      `${name}@${version}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const pythonCommand =
  process.env.PYTHON_BIN ?? (process.platform === "win32" ? "python" : "python3");
const pythonProbe = spawnSync(pythonCommand, ["--version"], { encoding: "utf8" });
const pythonOutput = `${pythonProbe.stdout ?? ""}\n${pythonProbe.stderr ?? ""}`;
const pythonVersion = pythonOutput.match(/Python\s+(\d+\.\d+\.\d+)/)?.[1] ?? "unavailable";
assert(
  pythonVersion === expectedPython,
  `Python ${expectedPython} required; found ${pythonVersion} (command: ${pythonCommand})`,
);

for (const item of results) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.message}`);
if (networkFailures.length > 0) {
  console.error("FAIL npm registry metadata could not be verified:");
  for (const item of networkFailures) console.error(`  ${item}`);
}
if (results.some((item) => !item.ok) || networkFailures.length > 0) {
  process.exitCode = 1;
} else {
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "dependency-preflight.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        node: actualNode,
        pnpm: actualPnpm,
        python: pythonVersion,
        packageManager: pkg.packageManager,
        packages,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Dependency baseline passed.");
}
