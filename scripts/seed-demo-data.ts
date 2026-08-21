/**
 * The formal pipeline must never be populated with fabricated study data.
 * Fixture data lives under tests/fixtures and is started by automated tests.
 */
if (process.argv.includes("--help")) {
  console.log("usage: demo data is intentionally not seeded; use pnpm test:integration");
  process.exit(0);
}
console.error("拒绝向正式数据库写入 demo/伪造研究数据；请使用 tests/fixtures 运行自动化测试。");
process.exitCode = 2;
