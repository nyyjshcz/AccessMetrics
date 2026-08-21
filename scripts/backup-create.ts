import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../src/lib/config";
import { getDb, migrate } from "../src/lib/db";
async function main() {
  const outputArg = process.argv.find((value) => value === "--output");
  const output =
    (outputArg ? process.argv[process.argv.indexOf(outputArg) + 1] : undefined) ??
    process.argv.find((value, index) => index > 1 && !value.startsWith("--")) ??
    path.join(process.cwd(), "artifacts", "backup", new Date().toISOString().replaceAll(":", "-"));
  if (!path.isAbsolute(output)) throw new Error("backup output 必须是绝对路径");
  migrate();
  fs.mkdirSync(output, { recursive: true });
  await getDb().backup(path.join(output, "accesscheck.db"));
  const privateFiles: Array<{ path: string; bytes: string }> = [];
  if (fs.existsSync(config.privateEvidenceRoot)) {
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error("private evidence 不允许符号链接");
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile())
          privateFiles.push({
            path: path.relative(config.privateEvidenceRoot, full).replaceAll(path.sep, "/"),
            bytes: fs.readFileSync(full).toString("base64"),
          });
      }
    };
    walk(config.privateEvidenceRoot);
  }
  let encryptedPrivateEvidenceHash: string | null = null;
  if (privateFiles.length) {
    const keySource =
      process.env.PRIVATE_BACKUP_KEY ??
      (process.env.PRIVATE_BACKUP_KEY_FILE
        ? fs.readFileSync(process.env.PRIVATE_BACKUP_KEY_FILE, "utf8").trim()
        : "");
    if (!/^[a-f0-9]{64}$/i.test(keySource))
      throw new Error(
        "存在私有证据时必须提供 PRIVATE_BACKUP_KEY/PRIVATE_BACKUP_KEY_FILE（32-byte hex）",
      );
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(keySource, "hex"), iv);
    const payload = Buffer.from(
      JSON.stringify({ schemaVersion: "private-evidence-backup-v1", files: privateFiles }),
    );
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    const encryptedPath = path.join(output, "private-evidence.enc");
    fs.writeFileSync(encryptedPath, Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
    encryptedPrivateEvidenceHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(encryptedPath))
      .digest("hex");
  }
  const databaseBytes = fs.readFileSync(path.join(output, "accesscheck.db"));
  fs.writeFileSync(
    path.join(output, "BACKUP-MANIFEST.json"),
    `${JSON.stringify({ schemaVersion: "backup-manifest-v1", database: { path: "accesscheck.db", sha256: crypto.createHash("sha256").update(databaseBytes).digest("hex") }, privateEvidence: privateFiles.length ? { path: "private-evidence.enc", sha256: encryptedPrivateEvidenceHash, fileCount: privateFiles.length } : null, createdAt: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        output,
        database: path.join(output, "accesscheck.db"),
        encryptedPrivateEvidence: privateFiles.length > 0,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
