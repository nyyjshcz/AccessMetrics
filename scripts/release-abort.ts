import { getDb, migrate } from "../src/lib/db";
import { args } from "./release-utils";
const options = args();
if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm release:abort -- --publication-db <path> --export-id <id> --expected-publication-revision <n> [--reason <text>]",
  );
  process.exit(0);
}
if (
  !options["publication-db"] ||
  !options["export-id"] ||
  !options["expected-publication-revision"]
)
  throw new Error("需要 --publication-db、--export-id 和 --expected-publication-revision");
const revision = Number(options["expected-publication-revision"]);
if (!Number.isInteger(revision) || revision < 0)
  throw new Error("expected-publication-revision 必须是非负整数");
process.env.DATABASE_URL = options["publication-db"];
migrate();
const result = getDb()
  .prepare(
    "UPDATE study_exports SET publication_status='unpublished',publication_revision=publication_revision+1,publication_error=? WHERE id=? AND publication_status='release_validating' AND publication_revision=?",
  )
  .run(String(options.reason ?? "release aborted").slice(0, 500), options["export-id"], revision);
if (result.changes !== 1) throw new Error("release abort CAS 冲突：状态或 revision 已变化");
console.log(
  JSON.stringify({
    changed: result.changes,
    exportId: options["export-id"],
    publicationRevision: revision + 1,
  }),
);
