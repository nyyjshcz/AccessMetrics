import fs from "node:fs";

if (process.argv.includes("--help")) {
  console.log("usage: pnpm ops:check");
  process.exit(0);
}
const required = [
  "Dockerfile",
  "docker-compose.yml",
  "compose.yaml",
  "compose.prod.yaml",
  "Caddyfile",
  "tools/playwright/seccomp_profile.json",
  "tools/egress-proxy/acl.yaml",
  "tools/egress-proxy/proxy.mjs",
  "scripts/check-egress-proxy.mjs",
  "scripts/write-build-provenance.mjs",
  "tools/document-renderer/Dockerfile",
];
const missing = required.filter((file) => !fs.existsSync(file));
const dockerfile = fs.existsSync("Dockerfile") ? fs.readFileSync("Dockerfile", "utf8") : "";
const caddyfile = fs.existsSync("Caddyfile") ? fs.readFileSync("Caddyfile", "utf8") : "";
const productionCompose = fs.existsSync("compose.prod.yaml")
  ? fs.readFileSync("compose.prod.yaml", "utf8")
  : "";
const warnings = [
  !dockerfile.includes("node:24.19.0") ? "Dockerfile Node baseline differs" : null,
  !dockerfile.includes("ACCESSCHECK_FINAL_CANDIDATE")
    ? "Dockerfile must support release provenance build args"
    : null,
  !dockerfile.includes("org.opencontainers.image.revision")
    ? "Dockerfile must set OCI revision label from release candidate"
    : null,
  !fs.existsSync("tools/egress-proxy/Dockerfile") ? "egress proxy image not supplied" : null,
  !productionCompose.includes("EGRESS_PROXY_IMAGE:?")
    ? "production compose must use a pinned egress proxy image"
    : null,
  !productionCompose.includes("CSRF_SECRET_FILE")
    ? "production compose does not mount CSRF secret"
    : null,
  !caddyfile.includes("CADDY_SITE") ? "Caddyfile must use an externally supplied site" : null,
  !caddyfile.includes("Strict-Transport-Security")
    ? "Caddyfile must include conditional HSTS"
    : null,
].filter(Boolean);
const errors: string[] = [];
const startupFile = fs.existsSync("src/lib/startup.ts")
  ? fs.readFileSync("src/lib/startup.ts", "utf8")
  : "";
const instrumentationFile = fs.existsSync("src/instrumentation.ts")
  ? fs.readFileSync("src/instrumentation.ts", "utf8")
  : "";
const workerBlock =
  productionCompose.match(
    /worker:[\s\S]*?(?=\n\s{2}\w[\w-]*:|\nnetworks:|\nsecrets:|\nvolumes:|$)/,
  )?.[0] ?? "";
const scanNetwork =
  productionCompose.match(/scan-isolated:\s*\n([\s\S]*?)(?=\n\s{2}\w[\w-]*:|$)/)?.[1] ?? "";
if (!workerBlock.includes("networks: [scan-isolated]"))
  errors.push("production worker must be isolated on scan-isolated");
if (!scanNetwork.includes("internal: true")) errors.push("scan-isolated must be internal:true");
if (workerBlock.includes("external-egress"))
  errors.push("production worker must not join external-egress");
if (!workerBlock.includes("EGRESS_PROXY_URL: http://egress-proxy:8080"))
  errors.push("production worker must use explicit EGRESS_PROXY_URL");
if (/worker:[\s\S]*?private-evidence/i.test(productionCompose))
  errors.push("production worker must not mount private evidence");
if (
  !productionCompose.includes("no-new-privileges:true") ||
  !productionCompose.includes("cap_drop: [ALL]")
)
  errors.push("production worker/web must drop capabilities and enable no-new-privileges");
if (
  !caddyfile.includes("header_up -X-AccessCheck-Trusted-Proxy") ||
  !caddyfile.includes("header_up X-AccessCheck-Trusted-Proxy caddy")
)
  errors.push("Caddy must strip and rewrite the trusted proxy marker");
if (
  !startupFile.includes("assertWebStartup") ||
  !startupFile.includes("assertPrivateEvidenceRoot") ||
  !startupFile.includes("assertProductionSecrets") ||
  !instrumentationFile.includes("assertWebStartup")
)
  errors.push(
    "production Web must fail closed before serving without a readable/writable private root",
  );
const localWorkerPrivateMount =
  /worker:[\s\S]*?PRIVATE_EVIDENCE_ROOT|worker:[\s\S]*?private-evidence/i.test(
    fs.existsSync("compose.yaml") ? fs.readFileSync("compose.yaml", "utf8") : "",
  );
if (localWorkerPrivateMount) warnings.push("local compose worker must not mount private evidence");
const productionWorkerPrivateMount = /worker:[\s\S]*?private-evidence/i.test(productionCompose);
if (productionWorkerPrivateMount)
  warnings.push("production worker must not mount private evidence");
for (const [name, compose] of [
  ["local", fs.existsSync("compose.yaml") ? fs.readFileSync("compose.yaml", "utf8") : ""],
  [
    "docker",
    fs.existsSync("docker-compose.yml") ? fs.readFileSync("docker-compose.yml", "utf8") : "",
  ],
] as const) {
  if (/web:[\s\S]*?command:\s*\[[^\]]*next\s+start/i.test(compose))
    warnings.push(`${name} compose must start the standalone server directly`);
  const worker =
    compose.match(/worker:[\s\S]*?(?=\n\s{2}\w[\w-]*:|\nnetworks:|\nvolumes:|$)/)?.[0] ?? "";
  const web = compose.match(/web:[\s\S]*?(?=\n\s{2}\w[\w-]*:|\nnetworks:|\nvolumes:|$)/)?.[0] ?? "";
  if (!web.includes("APP_ENV: development"))
    errors.push(`${name} compose web must use development APP_ENV`);
  if (!compose.includes("egress-proxy:")) errors.push(`${name} compose must include egress-proxy`);
  if (!worker.includes("networks: [scan-isolated]"))
    errors.push(`${name} compose worker must use scan-isolated`);
  if (!worker.includes("EGRESS_PROXY_URL: http://egress-proxy:8080"))
    errors.push(`${name} compose worker must use explicit egress proxy`);
  if (worker.includes("external-egress"))
    errors.push(`${name} compose worker must not join external-egress`);
}
console.log(
  JSON.stringify(
    { passed: missing.length === 0 && errors.length === 0, missing, errors, warnings },
    null,
    2,
  ),
);
if (missing.length || errors.length) process.exitCode = 1;
