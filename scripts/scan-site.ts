import { validateTargetUrl } from "../src/lib/url-security";
import { discoverSite } from "../src/lib/crawler";
import { positionalArgs } from "./cli-args";
async function main() {
  const raw = positionalArgs()[0];
  if (!raw) throw new Error("usage: pnpm scan:site https://example.com");
  const url = await validateTargetUrl(raw);
  const maxIndex = process.argv.indexOf("--max-pages");
  const maxPages = maxIndex >= 0 ? Number(process.argv[maxIndex + 1]) : undefined;
  console.log(JSON.stringify(await discoverSite(url.toString(), { maxPages }), null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
