import { chromium, type Browser, type Frame } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import axe from "axe-core";
import type { ScanPageResult, AxeRuleResult } from "./domain";
import { classifyImpact } from "./wcag";
import { sanitizeNodeHtml } from "./sanitize";
import { AppError } from "./errors";
import { validateTargetUrl, type NetworkPolicy } from "./url-security";
import { chromiumLaunchOptions } from "./browser";

let browser: Browser | undefined;
export const AXE_SCAN_OPTIONS = {
  reporter: "v2" as const,
  resultTypes: ["violations", "passes", "incomplete", "inapplicable"] as Array<
    "violations" | "passes" | "incomplete" | "inapplicable"
  >,
  selectors: true,
  ancestry: false,
  xpath: false,
  iframes: false,
};
async function getBrowser() {
  browser ??= await chromium.launch(chromiumLaunchOptions());
  return browser;
}
export async function scanPage(
  url: string,
  timeoutMs = 30000,
  networkPolicy?: NetworkPolicy,
): Promise<ScanPageResult> {
  const started = Date.now();
  await validateTargetUrl(url, networkPolicy);
  const instance = await getBrowser();
  const context = await instance.newContext({ ignoreHTTPSErrors: false, serviceWorkers: "block" });
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
      await validateTargetUrl(requestUrl, networkPolicy);
      return route.continue();
    } catch {
      return route.abort("blockedbyclient");
    }
  });
  const page = await context.newPage();
  const withTimeout = async <T>(promise: Promise<T>, message: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), Math.max(1000, timeoutMs));
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    let response: import("playwright").Response | null;
    try {
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    } catch (error) {
      // Playwright emits a navigation error rather than an HTTP response when
      // the target is a download. Preserve the plan's structured NON_HTML
      // contract instead of leaking an implementation-specific browser error.
      if (/download is starting/i.test(String(error)))
        throw new AppError("NON_HTML", "目标响应触发下载，未运行 axe", 422, {
          contentType: "download",
          status: 0,
        });
      throw error;
    }
    const httpStatus = response?.status() ?? 0;
    if (httpStatus === 401)
      throw new AppError("HTTP_UNAUTHORIZED", "目标页面要求身份验证，已跳过", 422);
    if (httpStatus === 403) throw new AppError("HTTP_FORBIDDEN", "目标页面拒绝访问，已跳过", 422);
    if (httpStatus >= 400)
      throw new AppError("HTTP_ERROR", `目标页面返回 HTTP ${httpStatus}`, 422, {
        status: httpStatus,
      });
    const contentType = response?.headers()["content-type"]?.toLowerCase() ?? "";
    if (contentType && !/(text\/html|application\/xhtml\+xml)/i.test(contentType))
      throw new AppError("NON_HTML", "目标响应不是 HTML/XHTML，未运行 axe", 422, {
        contentType,
        status: response?.status() ?? 0,
      });
    await validateTargetUrl(page.url(), networkPolicy);
    const coverageIssues: string[] = [];
    let raw: any = { passes: [], violations: [], incomplete: [], inapplicable: [] };
    try {
      raw = await withTimeout(
        new AxeBuilder({ page }).options(AXE_SCAN_OPTIONS).analyze(),
        "top-level axe execution timed out",
      );
    } catch (error) {
      coverageIssues.push(`top_level:${String(error)}`);
    }
    const convert = (items: any[], framePath = "top", frame?: Frame): AxeRuleResult[] =>
      items.map((item) => ({
        id: item.id,
        impact: classifyImpact(item.impact),
        tags: item.tags ?? [],
        description: item.description,
        help: item.help,
        helpUrl: item.helpUrl,
        nodes: (item.nodes ?? []).map((node: any) => ({
          framePath,
          frameUrl: frame?.url() || undefined,
          frameOriginRelation: frame
            ? (() => {
                try {
                  return new URL(frame.url()).origin === origin ? "same_origin" : "cross_origin";
                } catch {
                  return "cross_origin";
                }
              })()
            : "top",
          impact: classifyImpact(node.impact),
          html: sanitizeNodeHtml(node.html ?? ""),
          target: [
            framePath,
            ...(Array.isArray(node.target) ? node.target.map(String) : [String(node.target)]),
          ],
          failureSummary: node.failureSummary,
          any: node.any ?? [],
          all: node.all ?? [],
          none: node.none ?? [],
        })),
      }));
    const frames = page.frames().slice(1);
    const origin = new URL(page.url()).origin;
    const sameOriginFrames = frames.filter((frame) => {
      try {
        return new URL(frame.url()).origin === origin;
      } catch {
        return false;
      }
    });
    const crossOriginFrames = frames.length - sameOriginFrames.length;
    const frameResults = {
      passes: [] as AxeRuleResult[],
      violations: [] as AxeRuleResult[],
      incomplete: [] as AxeRuleResult[],
      inapplicable: [] as AxeRuleResult[],
    };
    let frameTestedTotal = 0;
    let frameErrorCount = 0;
    for (const frame of frames) {
      const framePath = getFramePath(frame);
      try {
        const frameRaw = await withTimeout(
          frame.evaluate(
            async ({ source, options }) => {
              if (!(window as any).axe) (0, eval)(source);
              return await (window as any).axe.run(document, options);
            },
            { source: axe.source, options: AXE_SCAN_OPTIONS },
          ),
          "frame axe execution timed out",
        );
        frameResults.passes.push(...convert(frameRaw.passes ?? [], framePath, frame));
        frameResults.violations.push(...convert(frameRaw.violations ?? [], framePath, frame));
        frameResults.incomplete.push(...convert(frameRaw.incomplete ?? [], framePath, frame));
        frameResults.inapplicable.push(...convert(frameRaw.inapplicable ?? [], framePath, frame));
        frameTestedTotal += 1;
      } catch (error) {
        frameErrorCount += 1;
        coverageIssues.push(`${framePath}:${String(error)}`);
      }
    }
    return {
      url,
      finalUrl: page.url(),
      status: httpStatus,
      contentType,
      title: await page.title().catch(() => ""),
      discoveredAt: new Date(started).toISOString(),
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      timestamp: raw.timestamp ?? new Date().toISOString(),
      testEngine: raw.testEngine ?? { name: "axe-core", version: axe.version },
      testEnvironment:
        raw.testEnvironment ??
        (await page.evaluate(() => ({
          userAgent: navigator.userAgent,
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
        }))),
      axeToolOptions: AXE_SCAN_OPTIONS,
      axe: {
        passes: [...convert(raw.passes), ...frameResults.passes],
        violations: [...convert(raw.violations), ...frameResults.violations],
        incomplete: [...convert(raw.incomplete), ...frameResults.incomplete],
        inapplicable: [...convert(raw.inapplicable), ...frameResults.inapplicable],
      },
      frameCoverage: {
        frameTotal: frames.length,
        sameOriginFrameTotal: sameOriginFrames.length,
        crossOriginFrameTotal: crossOriginFrames,
        frameTestedTotal,
        frameSkippedTotal: frames.length - frameTestedTotal,
        frameErrorCount,
        status:
          coverageIssues.length > 0
            ? "coverage_limited"
            : frames.length === 0
              ? "no_child_frames"
              : frameTestedTotal === frames.length
                ? "full"
                : "coverage_limited",
        issues: coverageIssues,
      },
    };
  } finally {
    await context.close();
  }
}

function getFramePath(frame: import("playwright").Frame): string {
  const parts: string[] = [];
  let current: import("playwright").Frame | null = frame;
  while (current?.parentFrame()) {
    const parent: import("playwright").Frame = current.parentFrame()!;
    parts.unshift(String(parent.childFrames().indexOf(current)));
    current = parent;
  }
  return `frame:${parts.join("/")}`;
}
export async function closeScanner() {
  await browser?.close();
  browser = undefined;
}
