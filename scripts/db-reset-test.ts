import fs from "node:fs";
import path from "node:path";
const testPath = path.join(process.cwd(), "data", "test-accesscheck.db");
for (const suffix of ["", "-wal", "-shm"]) {
  const target = testPath + suffix;
  if (fs.existsSync(target)) fs.rmSync(target);
}
console.log(`reset ${testPath}`);
