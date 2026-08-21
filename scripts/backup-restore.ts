import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { positionalArgs } from "./cli-args";
const [source, target] = positionalArgs();
if (!source || !target) throw new Error("usage: pnpm backup:restore <backup-dir> <target-dir>");
if (!path.isAbsolute(source) || !path.isAbsolute(target))
  throw new Error("backup source/target 必须是绝对路径");
if (path.resolve(source) === path.resolve(target)) throw new Error("不能原地恢复备份");
const manifestPath = path.join(source, "BACKUP-MANIFEST.json");
if (!fs.existsSync(manifestPath)) throw new Error("备份缺少 BACKUP-MANIFEST.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.schemaVersion !== "backup-manifest-v1" || manifest.database?.path !== "accesscheck.db")
  throw new Error("备份 manifest schema 无效");
const sourceDatabase = path.join(source, "accesscheck.db");
if (!fs.existsSync(sourceDatabase)) throw new Error("备份缺少 accesscheck.db");
const sourceDatabaseHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(sourceDatabase))
  .digest("hex");
if (sourceDatabaseHash !== manifest.database.sha256) throw new Error("备份数据库 hash 不一致");
const encryptedPath = path.join(source, "private-evidence.enc");
const manifestPrivateEvidence = manifest.privateEvidence;
if (
  manifestPrivateEvidence &&
  (!manifestPrivateEvidence.path || manifestPrivateEvidence.path !== "private-evidence.enc")
)
  throw new Error("备份私有证据 manifest 路径无效");
if (manifestPrivateEvidence && !fs.existsSync(encryptedPath))
  throw new Error("manifest 声明存在加密私有证据，但文件缺失");
if (!manifestPrivateEvidence && fs.existsSync(encryptedPath))
  throw new Error("备份存在未登记的加密私有证据文件");
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(sourceDatabase, path.join(target, "accesscheck.db"));
if (fs.existsSync(encryptedPath)) {
  const keySource =
    process.env.PRIVATE_BACKUP_KEY ??
    (process.env.PRIVATE_BACKUP_KEY_FILE
      ? fs.readFileSync(process.env.PRIVATE_BACKUP_KEY_FILE, "utf8").trim()
      : "");
  if (!/^[a-f0-9]{64}$/i.test(keySource))
    throw new Error("加密私有证据恢复需要 PRIVATE_BACKUP_KEY/PRIVATE_BACKUP_KEY_FILE");
  const bytes = fs.readFileSync(encryptedPath);
  if (manifestPrivateEvidence?.sha256 !== crypto.createHash("sha256").update(bytes).digest("hex"))
    throw new Error("加密私有证据 hash 不一致");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keySource, "hex"),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  const payload = JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"),
  );
  if (payload.schemaVersion !== "private-evidence-backup-v1" || !Array.isArray(payload.files))
    throw new Error("私有备份 schema 无效");
  if (
    !Number.isInteger(manifestPrivateEvidence?.fileCount) ||
    payload.files.length !== manifestPrivateEvidence.fileCount
  )
    throw new Error("私有备份文件数量与 manifest 不一致");
  for (const file of payload.files) {
    if (
      typeof file.path !== "string" ||
      path.isAbsolute(file.path) ||
      file.path.split(/[\\/]/).includes("..")
    )
      throw new Error("私有备份路径越界");
    const targetFile = path.join(target, "private-evidence", file.path);
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, Buffer.from(file.bytes, "base64"));
  }
}
console.log(
  JSON.stringify(
    { restored: true, target, encryptedPrivateEvidence: fs.existsSync(encryptedPath) },
    null,
    2,
  ),
);
