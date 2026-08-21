import { validateTargetUrl } from "../src/lib/url-security";
import { closeScanner, scanPage } from "../src/lib/scan-page";
import { positionalArgs } from "./cli-args";

export async function runScanPageCli(commandName: string) {
  const raw = positionalArgs()[0];
  if (!raw) throw new Error(`usage: pnpm ${commandName} https://example.com`);
  const url = await validateTargetUrl(raw);
  try {
    console.log(JSON.stringify(await scanPage(url.toString()), null, 2));
  } finally {
    await closeScanner();
  }
}
