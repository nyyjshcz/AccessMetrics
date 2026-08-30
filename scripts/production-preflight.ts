import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const envFileIndex = args.indexOf("--env-file");
const envFile = path.resolve(
  process.cwd(),
  envFileIndex >= 0 && args[envFileIndex + 1] ? args[envFileIndex + 1] : ".env.production",
);
const skipDocker = args.includes("--skip-docker");
const errors: string[] = [];
const warnings: string[] = [];
let dockerChecked = false;

function parseEnvFile(file: string) {
  if (!fs.existsSync(file)) {
    errors.push(`missing environment file: ${file}`);
    return {} as Record<string, string>;
  }
  const values: Record<string, string> = {};
  for (const [index, rawLine] of fs.readFileSync(file, "utf8").split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      errors.push(`invalid environment line ${index + 1}`);
      continue;
    }
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    )
      value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function checkSecret(name: string, minimumLength: number) {
  const file = path.join(process.cwd(), ".secrets", name);
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    if (value.length < minimumLength)
      errors.push(`${file} must contain at least ${minimumLength} characters`);
    return value;
  } catch {
    errors.push(`missing readable secret file: ${file}`);
    return "";
  }
}

function checkDirectory(relativePath: string, expectedMode: number, groupWritable = false) {
  const directory = path.join(process.cwd(), relativePath);
  try {
    const stat = fs.statSync(directory);
    if (!stat.isDirectory()) throw new Error("not a directory");
    if (process.platform !== "win32") {
      const mode = stat.mode & 0o777;
      if (expectedMode === 0o700 && mode !== expectedMode)
        errors.push(`${relativePath} permissions must be 0700`);
      if (groupWritable && (mode & 0o070) !== 0o070)
        errors.push(
          `${relativePath} must be group-readable, writable, and traversable for shared SQLite access`,
        );
      if (groupWritable && stat.gid !== 10000)
        errors.push(`${relativePath} must use group 10000 for the production containers`);
    }
  } catch {
    errors.push(`missing directory: ${relativePath}`);
  }
}

const env = parseEnvFile(envFile);
let appUrl: URL | undefined;
try {
  appUrl = new URL(env.APP_BASE_URL ?? "");
  if (appUrl.protocol !== "https:") errors.push("APP_BASE_URL must use https");
  if (appUrl.port)
    errors.push("APP_BASE_URL must not include a port when Caddy serves standard HTTPS");
  if (appUrl.pathname !== "/" || appUrl.search || appUrl.hash || appUrl.username || appUrl.password)
    errors.push("APP_BASE_URL must be an origin without a path, query, hash, or credentials");
} catch {
  errors.push("APP_BASE_URL must be a valid HTTPS origin");
}
if (!env.CADDY_SITE) errors.push("CADDY_SITE is required");
else if (appUrl && env.CADDY_SITE !== appUrl.hostname)
  errors.push("CADDY_SITE must match the APP_BASE_URL hostname");
if (!/^.+@sha256:[a-f0-9]{64}$/i.test(env.EGRESS_PROXY_IMAGE ?? ""))
  errors.push("EGRESS_PROXY_IMAGE must be an immutable image reference with a sha256 digest");

const sessionSecret = checkSecret("session_secret", 32);
const adminKey = checkSecret("admin_access_key", 16);
const visitorKey = checkSecret("visitor_access_key", 16);
if (adminKey && visitorKey && adminKey === visitorKey)
  errors.push("administrator and visitor access keys must differ");
if (sessionSecret && (sessionSecret === adminKey || sessionSecret === visitorKey))
  warnings.push("session secret should be different from access keys");
checkDirectory("private-inputs", 0o700);
checkDirectory("data", 0o770, true);
checkDirectory("data/exports", 0o770, true);

if (!skipDocker && errors.length === 0) {
  dockerChecked = true;
  try {
    execFileSync(
      "docker",
      ["compose", "--env-file", envFile, "-f", "compose.prod.yaml", "config", "--quiet"],
      { cwd: process.cwd(), stdio: "pipe" },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`docker compose config failed: ${detail}`);
  }
}

console.log(
  JSON.stringify(
    {
      passed: errors.length === 0,
      envFile,
      errors,
      warnings,
      dockerChecked,
    },
    null,
    2,
  ),
);
if (errors.length) process.exitCode = 1;
