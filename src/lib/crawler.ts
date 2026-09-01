import { chromium, type Browser } from "playwright";
import { canonicalizeUrl } from "./url-security";
import { validateTargetUrl, type NetworkPolicy } from "./url-security";
import { config } from "./config";
import { chromiumLaunchOptions } from "./browser";
import type { APIRequestContext } from "playwright";

export interface CrawlOptions {
  maxPages?: number;
  sameOriginOnly?: boolean;
  delayMs?: number;
  maxDepth?: number;
  maxDurationMs?: number;
  respectRobots?: boolean;
  networkPolicy?: NetworkPolicy;
}
export interface CrawlSummary {
  requestedPageLimit: number;
  scanTargetCount: number;
  skippedNotFoundCount: number;
  stopReason: "page_limit" | "queue_exhausted" | "duration_limit";
}
export interface DetailedDiscoveryResult { urls: string[]; summary: CrawlSummary }
export async function discoverSite(
  startUrl: string,
  options: CrawlOptions = {},
): Promise<string[]> {
  return (await discoverSiteDetailed(startUrl, options)).urls;
}
export async function discoverSiteDetailed(
  startUrl: string,
  options: CrawlOptions = {},
): Promise<DetailedDiscoveryResult> {
  const maxPages = Math.min(options.maxPages ?? config.SCAN_MAX_PAGES, config.SCAN_MAX_PAGES);
  const maxDepth = options.maxDepth ?? config.MAX_CRAWL_DEPTH;
  const maxDurationMs = options.maxDurationMs ?? config.MAX_SITE_DURATION_MS;
  const target = await validateTargetUrl(startUrl, options.networkPolicy);
  const origin = target.origin;
  const firstUrl = canonicalizeUrl(startUrl);
  const queue: Array<{ url: string; depth: number }> = [{ url: firstUrl, depth: 0 }];
  // Track requested URLs separately from the scan targets. A site can expose
  // two links that both redirect to the same final URL; only that final URL
  // should be returned for scanning.
  const visited = new Set<string>();
  const queued = new Set<string>([firstUrl]);
  const discovered = new Set<string>();
  let skippedNotFoundCount = 0;
  const candidateReserve = Math.min(100, Math.max(maxPages * 5, maxPages));
  const browser: Browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const robots =
      options.respectRobots === false
        ? []
        : await readRobots(origin, options.networkPolicy, context.request);
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
    const crawlStarted = Date.now();
    while (
      queue.length > 0 &&
      discovered.size < maxPages &&
      Date.now() - crawlStarted < maxDurationMs
    ) {
      const currentEntry = queue.shift()!;
      const current = currentEntry.url;
      queued.delete(current);
      if (visited.has(current)) continue;
      const parsed = new URL(current);
      if ((options.sameOriginOnly ?? true) && parsed.origin !== origin) continue;
      if (isDisallowed(parsed.pathname, robots)) continue;
      if (currentEntry.depth > maxDepth) continue;
      if (/[.](?:pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3|docx?)$/i.test(parsed.pathname)) continue;
      visited.add(current);
      try {
        await validateTargetUrl(current, options.networkPolicy);
        const response = await page.goto(current, {
          waitUntil: "domcontentloaded",
          timeout: config.SCAN_TIMEOUT_MS,
        });
        const finalUrl = await validateTargetUrl(page.url(), options.networkPolicy);
        const normalizedFinalUrl = canonicalizeUrl(finalUrl.toString());
        const final = new URL(normalizedFinalUrl);
        if (final.origin !== origin) throw new Error("redirect crossed site origin");
        if (isDisallowed(final.pathname, robots)) continue;
        // If a direct link to the final page is already waiting, it no longer
        // needs a separate crawl or a second scan result.
        visited.add(normalizedFinalUrl);
        const status = response?.status() ?? 0;
        if (status === 404 || status === 410) {
          skippedNotFoundCount += 1;
          continue;
        }
        if (discovered.has(normalizedFinalUrl)) continue;
        discovered.add(normalizedFinalUrl);
        if (status >= 400) continue;
        await page
          .locator("a[href]")
          .first()
          .waitFor({
            state: "attached",
            timeout: Math.min(config.SCAN_TIMEOUT_MS, 2000),
          })
          .catch(() => undefined);
        const links = await page
          .locator("a[href]")
          .evaluateAll((anchors) => anchors.map((a) => (a as HTMLAnchorElement).href));
        for (const link of links) {
          try {
            const normalized = canonicalizeUrl(link);
            await validateTargetUrl(normalized, options.networkPolicy);
            if (
              new URL(normalized).origin === origin &&
              !visited.has(normalized) &&
              !queued.has(normalized) &&
              // A few candidate URLs may collapse to one final redirect URL.
              // Keep enough discovery candidates to still reach the requested
              // scan cap when another candidate is a duplicate redirect.
              queue.length < candidateReserve
            )
              if (!isDisallowed(new URL(normalized).pathname, robots)) {
                queue.push({ url: normalized, depth: currentEntry.depth + 1 });
                queued.add(normalized);
              }
          } catch {
            /* ignore malformed links */
          }
        }
      } catch {
        // Navigation errors remain targets so the worker records a failure.
        if (!discovered.has(current)) discovered.add(current);
      }
      if ((options.delayMs ?? config.SCAN_DELAY_MS) > 0)
        await new Promise((resolve) =>
          setTimeout(resolve, options.delayMs ?? config.SCAN_DELAY_MS),
        );
    }
    await context.close();
    const elapsed = Date.now() - crawlStarted;
    const stopReason: CrawlSummary["stopReason"] =
      discovered.size >= maxPages
        ? "page_limit"
        : elapsed >= maxDurationMs
          ? "duration_limit"
          : "queue_exhausted";
    return {
      urls: [...discovered].slice(0, maxPages),
      summary: {
        requestedPageLimit: maxPages,
        scanTargetCount: Math.min(discovered.size, maxPages),
        skippedNotFoundCount,
        stopReason,
      },
    };
  } finally {
    await browser.close();
  }
}

async function readRobots(
  origin: string,
  networkPolicy: NetworkPolicy | undefined,
  request: APIRequestContext,
): Promise<string[]> {
  try {
    let target = `${origin}/robots.txt`;
    let response: import("playwright").APIResponse | undefined;
    for (let redirect = 0; redirect < 4; redirect++) {
      await validateTargetUrl(target, networkPolicy);
      response = await request.get(target, { maxRedirects: 0, timeout: 3000 });
      if (response.status() < 300 || response.status() >= 400) break;
      const location = response.headers()["location"];
      if (!location) return [];
      target = new URL(location, target).toString();
      if (new URL(target).origin !== origin) return [];
    }
    if (!response || !response.ok()) return [];
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
