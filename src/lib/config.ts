import path from "node:path";
import fs from "node:fs";
import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("./data/accesscheck.db"),
  SESSION_SECRET: z.string().min(16).default("development-session-secret-change-me"),
  CSRF_SECRET: z.string().min(16).default("development-csrf-secret-change-me"),
  PRIVATE_EVIDENCE_ROOT: z.string().default("./private-inputs"),
  PUBLIC_EXPORT_ROOT: z.string().default("./data/exports"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  SCAN_MAX_PAGES: z.coerce.number().int().min(1).max(15).default(15),
  SCAN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  SCAN_DELAY_MS: z.coerce.number().int().min(0).max(60000).default(500),
  SCAN_RETRY_COUNT: z.coerce.number().int().min(0).max(3).default(1),
  MAX_CRAWL_DEPTH: z.coerce.number().int().min(0).max(10).default(2),
  MAX_SITE_DURATION_MS: z.coerce.number().int().min(1000).max(1800000).default(600000),
  DNS_RESOLVER_MODE: z.enum(["system", "doh"]).default("system"),
  DNS_OVER_HTTPS_URL: z.string().url().optional(),
  SCAN_ADMIN_TOKEN: z.string().optional(),
  COMPUTER_REVIEWER_TOKEN: z.string().optional(),
  MATH_REVIEWER_TOKEN: z.string().optional(),
  COMPUTER_REVIEW_TOKEN: z.string().optional(),
  MATH_REVIEW_TOKEN: z.string().optional(),
  ADMIN_REAUTH_TOKEN: z.string().optional(),
  EGRESS_PROXY_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional(),
  ),
});

export const config = (() => {
  const fileBacked = { ...process.env } as Record<string, string | undefined>;
  for (const key of [
    "SESSION_SECRET",
    "CSRF_SECRET",
    "SCAN_ADMIN_TOKEN",
    "COMPUTER_REVIEW_TOKEN",
    "MATH_REVIEW_TOKEN",
    "ADMIN_REAUTH_TOKEN",
  ]) {
    const file = fileBacked[`${key}_FILE`];
    if (file && !fileBacked[key]) fileBacked[key] = fs.readFileSync(file, "utf8").trim();
  }
  const parsed = envSchema.parse(fileBacked);
  const root = process.cwd();
  return {
    ...parsed,
    databasePath: path.resolve(root, parsed.DATABASE_URL),
    privateEvidenceRoot: path.resolve(root, parsed.PRIVATE_EVIDENCE_ROOT),
    publicExportRoot: path.resolve(root, parsed.PUBLIC_EXPORT_ROOT),
  };
})();

export function assertPrivateEvidenceRoot() {
  if (config.APP_ENV !== "production") return;
  if (!fs.existsSync(config.privateEvidenceRoot))
    throw new Error("PRIVATE_EVIDENCE_ROOT is missing");
  const stat = fs.statSync(config.privateEvidenceRoot);
  if (!stat.isDirectory()) throw new Error("PRIVATE_EVIDENCE_ROOT is not a directory");
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    throw new Error("PRIVATE_EVIDENCE_ROOT permissions must be 0700");
  try {
    fs.accessSync(config.privateEvidenceRoot, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    throw new Error("PRIVATE_EVIDENCE_ROOT must be readable and writable");
  }
}

export function assertProductionSecrets() {
  if (config.APP_ENV !== "production") return;
  const missing: string[] = [];
  if (!config.SCAN_ADMIN_TOKEN) missing.push("SCAN_ADMIN_TOKEN");
  const computerToken = config.COMPUTER_REVIEW_TOKEN ?? config.COMPUTER_REVIEWER_TOKEN;
  const mathToken = config.MATH_REVIEW_TOKEN ?? config.MATH_REVIEWER_TOKEN;
  if (!computerToken) missing.push("COMPUTER_REVIEW_TOKEN");
  if (!mathToken) missing.push("MATH_REVIEW_TOKEN");
  if (computerToken && mathToken && computerToken === mathToken)
    missing.push("COMPUTER_REVIEW_TOKEN and MATH_REVIEW_TOKEN must differ");
  if (!config.ADMIN_REAUTH_TOKEN) missing.push("ADMIN_REAUTH_TOKEN");
  if (config.SESSION_SECRET === "development-session-secret-change-me")
    missing.push("SESSION_SECRET");
  if (config.CSRF_SECRET === "development-csrf-secret-change-me") missing.push("CSRF_SECRET");
  if (missing.length) throw new Error(`production secrets missing: ${missing.join(",")}`);
}

export function assertProductionProxy() {
  if (config.APP_ENV === "production" && !config.EGRESS_PROXY_URL)
    throw new Error("production EGRESS_PROXY_URL is missing");
}

export function assertDnsResolver() {
  if (config.DNS_RESOLVER_MODE !== "doh") return;
  if (config.APP_ENV === "production")
    throw new Error("DNS_RESOLVER_MODE=doh is not allowed in production");
  if (!config.DNS_OVER_HTTPS_URL) throw new Error("DNS_OVER_HTTPS_URL is required for DoH");
  if (new URL(config.DNS_OVER_HTTPS_URL).protocol !== "https:")
    throw new Error("DNS_OVER_HTTPS_URL must use HTTPS");
}

export type AppConfig = typeof config;
