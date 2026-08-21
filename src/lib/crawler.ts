import { chromium, type Browser } from "playwright";
import { canonicalizeUrl } from "./url-security";
import { validateTargetUrl, type NetworkPolicy } from "./url-security";
import { config } from "./config";

export interface CrawlOptions {
  maxPages?: number;
  sameOriginOnly?: boolean;
  delayMs?: number;
  maxDepth?: number;
  respectRobots?: boolean;
  networkPolicy?: NetworkPolicy;
}
export async function discoverSite(
  startUrl: string,
  options: CrawlOptions = {},
): Promise<string[]> {
  const maxPages = Math.min(options.maxPages ?? config.SCAN_MAX_PAGES, config.SCAN_MAX_PAGES);
  const target = await validateTargetUrl(startUrl, options.networkPolicy);
  const origin = target.origin;
  const queue: Array<{ url: string; depth: number }> = [
    { url: canonicalizeUrl(startUrl), depth: 0 },
  ];
  const seen = new Set<string>();
  const robots =
    options.respectRobots === false ? [] : await readRobots(origin, options.networkPolicy);
  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (/^(about:|data:|blob:)/i.test(requestUrl)) return route.continue();
      let parsed: URL;
      try {
        parsed = new URL(requestUrl);
      } catch {
        return route.abort("blockedbyclient");
      }
      if (!/^https?:$/i.test(parsed.protocol)) return route.abort("blockedbyclient");
      try {
        await validateTargetUrl(requestUrl, options.networkPolicy);
        return route.continue();
      } catch {
        return route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    while (queue.length > 0 && seen.size < maxPages) {
      const currentEntry = queue.shift()!;
      const current = currentEntry.url;
      if (seen.has(current)) continue;
      const parsed = new URL(current);
      if ((options.sameOriginOnly ?? true) && parsed.origin !== origin) continue;
      if (isDisallowed(parsed.pathname, robots)) continue;
      if (options.maxDepth !== undefined && currentEntry.depth > options.maxDepth) continue;
      if (/[.](?:pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3|docx?)$/i.test(parsed.pathname)) continue;
      seen.add(current);
      try {
        await validateTargetUrl(current, options.networkPolicy);
        await page.goto(current, {
          waitUntil: "domcontentloaded",
          timeout: config.SCAN_TIMEOUT_MS,
        });
        const links = await page
          .locator("a[href]")
          .evaluateAll((anchors) => anchors.map((a) => (a as HTMLAnchorElement).href));
        for (const link of links) {
          try {
            const normalized = canonicalizeUrl(link);
            await validateTargetUrl(normalized, options.networkPolicy);
            if (
              new URL(normalized).origin === origin &&
              !seen.has(normalized) &&
              queue.length + seen.size < maxPages
            )
              if (!isDisallowed(new URL(normalized).pathname, robots))
                queue.push({ url: normalized, depth: currentEntry.depth + 1 });
          } catch {
            /* ignore malformed links */
          }
        }
      } catch {
        /* failed pages stay in the job as failed attempts */
      }
      if ((options.delayMs ?? config.SCAN_DELAY_MS) > 0)
        await new Promise((resolve) =>
          setTimeout(resolve, options.delayMs ?? config.SCAN_DELAY_MS),
        );
    }
    await context.close();
    return [...seen];
  } finally {
    await browser.close();
  }
}

async function readRobots(origin: string, networkPolicy?: NetworkPolicy): Promise<string[]> {
  try {
    let target = `${origin}/robots.txt`;
    let response: Response | undefined;
    for (let redirect = 0; redirect < 4; redirect++) {
      await validateTargetUrl(target, networkPolicy);
      response = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(3000),
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) return [];
      target = new URL(location, target).toString();
    }
    if (!response || !response.ok) return [];
    const rules: string[] = [];
    let active = false;
    for (const line of (await response.text()).split(/\r?\n/)) {
      const [key, value] = line.split(":", 2).map((part) => part.trim());
      if (key?.toLowerCase() === "user-agent") active = value === "*";
      else if (active && key?.toLowerCase() === "disallow" && value) rules.push(value);
    }
    return rules;
  } catch {
    return [];
  }
}
function isDisallowed(pathname: string, rules: string[]) {
  return rules.some((rule) => rule === "/" || (rule && pathname.startsWith(rule)));
}
