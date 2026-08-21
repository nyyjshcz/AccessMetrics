import { validateTargetUrl } from "../src/lib/url-security";
import { scanPage, closeScanner } from "../src/lib/scan-page";
import { positionalArgs } from "./cli-args";
async function main() {
  const raw = positionalArgs()[0];
  if (!raw) throw new Error("usage: pnpm scan:page https://example.com");
  const url = await validateTargetUrl(raw);
  try {
    console.log(JSON.stringify(await scanPage(url.toString()), null, 2));
  } finally {
    await closeScanner();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
