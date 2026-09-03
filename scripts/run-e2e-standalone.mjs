import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
// Keep the standalone web process on the same isolated test database and
// credentials as the worker spawned by the E2E spec. Next loads .env.local
// itself, so relying on the parent environment otherwise points the web app
// at data/accesscheck.db while the worker uses data/e2e-accesscheck-local.db.
process.env.APP_ENV ??= "test";
// The generated standalone server changes cwd to .next/standalone before
// importing the app. Resolve the path here so it matches the worker's cwd.
process.env.DATABASE_URL = path.join(root, "data/e2e-accesscheck-local.db");
process.env.SESSION_SECRET ??= "e2e-session-secret-01234567890123456789";
process.env.ADMIN_ACCESS_KEY ??= "e2e-admin-access-key-01234567890123456789";
process.env.VISITOR_ACCESS_KEY ??= "e2e-visitor-access-key-01234567890123456789";
process.env.PRIVATE_EVIDENCE_ROOT = path.join(root, "data/e2e-private");
process.env.PUBLIC_EXPORT_ROOT = path.join(root, "data/e2e-exports");
const standalone = path.join(root, ".next", "standalone");
const staticSource = path.join(root, ".next", "static");
const staticTarget = path.join(standalone, ".next", "static");
const server = path.join(standalone, "server.js");

if (!existsSync(server) || !existsSync(staticSource)) {
  throw new Error("Run the production build before starting the E2E server.");
}

mkdirSync(path.dirname(staticTarget), { recursive: true });
cpSync(staticSource, staticTarget, { recursive: true, force: true });

await import(pathToFileURL(server).href);
