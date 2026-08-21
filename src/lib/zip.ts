import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
export function zipDirectory(root: string): Uint8Array {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory())
    throw new Error("zip source directory missing");
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`zip source cannot contain symlink: ${entry.name}`);
      const rel = path.relative(resolvedRoot, full).replaceAll(path.sep, "/");
      if (!rel || rel.startsWith("../") || path.isAbsolute(rel))
        throw new Error(`unsafe zip path: ${rel}`);
      if (entry.isDirectory()) walk(full);
      else files[rel] = new Uint8Array(fs.readFileSync(full));
    }
  };
  walk(resolvedRoot);
  return zipSync(files, { level: 6 });
}
