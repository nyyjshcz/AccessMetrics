import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Validate the files and local prerequisites used by the NAS deployment.
 * This intentionally never prints the contents of an environment or secret file.
 */
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const envFileIndex = args.indexOf("--env-file");
const envFile = path.resolve(
  process.cwd(),
  envFileIndex >= 0 && args[envFileIndex + 1] ? args[envFileIndex + 1] : ".env.nas",
);
const skipDocker = args.includes("--skip-docker");
const requireDb = args.includes("--require-db");
const errors: string[] = [];
const warnings: string[] = [];

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
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function checkSecret(secretsDir: string, name: string, minimumLength: number) {
  const file = path.resolve(secretsDir, name);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) {
      errors.push(`secret file is not a regular file: ${path.relative(process.cwd(), file)}`);
      return "";
    }
    const value = fs.readFileSync(file, "utf8").trim();
    if (value.length < minimumLength) {
      errors.push(
        `${path.relative(process.cwd(), file)} must contain at least ${minimumLength} characters`,
      );
    }
    if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600)
      errors.push(`${path.relative(process.cwd(), file)} permissions must be 0600`);
    return value;
  } catch {
    errors.push(`missing readable secret file: ${path.relative(process.cwd(), file)}`);
    return "";
  }
}

function checkDirectory(relativePath: string, expectedMode: number, label: string) {
  const directory = path.resolve(process.cwd(), relativePath);
  try {
    const stat = fs.statSync(directory);
    if (!stat.isDirectory()) throw new Error("not a directory");
    if (process.platform === "win32") {
      warnings.push(`${label} permissions could not be verified on Windows`);
      return;
    }
    const mode = stat.mode & 0o777;
    if (expectedMode === 0o700 && mode !== expectedMode)
      errors.push(`${label} permissions must be 0700`);
    if (expectedMode === 0o2770) {
      if ((stat.mode & 0o2000) === 0) errors.push(`${label} must have the setgid bit enabled`);
      if ((mode & 0o070) !== 0o070)
        errors.push(`${label} must be group-readable, writable, and traversable`);
      if (stat.gid !== 10000) errors.push(`${label} must use group 10000`);
    }
  } catch {
    errors.push(`missing directory: ${relativePath}`);
  }
}

const env = parseEnvFile(envFile);
if (env.APP_ENV && env.APP_ENV !== "production")
  errors.push("APP_ENV must be production for the NAS deployment");

let appUrl: URL | undefined;
try {
  appUrl = new URL(env.APP_BASE_URL ?? "");
  if (appUrl.protocol !== "https:") errors.push("APP_BASE_URL must use https");
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.ts\.net$/i.test(
      appUrl.hostname,
    )
  )
    errors.push("APP_BASE_URL hostname must be a Tailscale *.ts.net hostname");
  if (appUrl.port)
    errors.push("APP_BASE_URL must not include a port when Tailscale Funnel serves HTTPS");
  if (appUrl.pathname !== "/" || appUrl.search || appUrl.hash || appUrl.username || appUrl.password)
    errors.push("APP_BASE_URL must be an origin without a path, query, hash, or credentials");
} catch {
  errors.push("APP_BASE_URL must be a valid HTTPS *.ts.net origin");
}

checkDirectory(".secrets", 0o700, ".secrets");
const sessionSecret = checkSecret(".secrets", "session_secret", 32);
const adminKey = checkSecret(".secrets", "admin_access_key", 16);
const visitorKey = checkSecret(".secrets", "visitor_access_key", 16);
if (adminKey && visitorKey && adminKey === visitorKey)
  errors.push("administrator and visitor access keys must differ");
if (sessionSecret && (sessionSecret === adminKey || sessionSecret === visitorKey))
  warnings.push("session secret should be different from access keys");

checkDirectory("private-inputs", 0o700, "private-inputs");
checkDirectory("data", 0o2770, "data");
checkDirectory(path.join("data", "exports"), 0o2770, "data/exports");

if (requireDb) {
  const databasePath = path.resolve(process.cwd(), "data", "accesscheck.db");
  try {
    const stat = fs.statSync(databasePath);
    if (!stat.isFile()) throw new Error("database is not a regular file");
    if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o660)
      errors.push("data/accesscheck.db permissions must be 0660");
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${databasePath}${suffix}`;
      if (fs.existsSync(sidecar) && !fs.statSync(sidecar).isFile())
        errors.push(`data/accesscheck.db${suffix} must be a regular file`);
    }
    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      const integrity = db.pragma("integrity_check", { simple: true });
      if (integrity !== "ok") errors.push("SQLite integrity_check failed");
      const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeys.length > 0) errors.push("SQLite foreign_key_check failed");
      const journalMode = db.pragma("journal_mode", { simple: true });
      if (journalMode !== "wal") warnings.push("SQLite journal_mode is not WAL");
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("database is not a regular file"))
      errors.push("data/accesscheck.db must be a regular file");
    else errors.push("missing or unreadable database: data/accesscheck.db");
  }
}

let dockerChecked = false;
if (!skipDocker && errors.length === 0) {
  dockerChecked = true;
  if (!fs.existsSync(path.resolve(process.cwd(), "compose.nas.yaml"))) {
    errors.push("missing compose.nas.yaml");
  } else {
    try {
      execFileSync(
        "docker",
        ["compose", "--env-file", envFile, "-f", "compose.nas.yaml", "config", "--quiet"],
        { cwd: process.cwd(), stdio: "pipe" },
      );
    } catch {
      errors.push("docker compose config failed for compose.nas.yaml");
    }
  }
}

console.log(
  JSON.stringify(
    { passed: errors.length === 0, envFile, errors, warnings, dockerChecked },
    null,
    2,
  ),
);
if (errors.length) process.exitCode = 1;
