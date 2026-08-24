import { chromium, type Browser, type Frame } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import axe from "axe-core";
import type { ScanPageResult, AxeRuleResult } from "./domain";
import { classifyImpact } from "./wcag";
import { sanitizeNodeHtml } from "./sanitize";
import { AppError } from "./errors";
import { validateTargetUrl, type NetworkPolicy } from "./url-security";
import { chromiumLaunchOptions } from "./browser";
import { canonicalize, sha256 } from "./canonical";

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
export const AI_EVIDENCE_VERSION = "ai-evidence-v1";

type AiEvidenceEnvelope = {
  version: string;
  complete: boolean;
  target: string[];
  facts: Record<string, unknown>;
  warnings: string[];
  capturedAt: string;
};

async function collectAiEvidenceUnsafe(
  frame: Frame | undefined,
  target: unknown,
): Promise<{ json: string; hash: string; version: string }> {
  const targets = Array.isArray(target) ? target.map(String) : [String(target)];
  let captured: { complete: boolean; facts: Record<string, unknown>; warnings: string[] };
  if (!frame) {
    captured = {
      complete: false,
      facts: {},
      warnings: ["frame_unavailable"],
    };
  } else {
    try {
      captured = await frame.evaluate((selectors) => {
        const warnings: string[] = [];
        let element: Element | null = null;
        let matchedSelector: string | null = null;
        for (const selector of selectors) {
          try {
            const candidate = document.querySelector(selector);
            if (candidate) {
              element = candidate;
              matchedSelector = selector;
              break;
            }
          } catch {
            warnings.push(`selector_invalid:${selector.slice(0, 200)}`);
          }
        }
        if (!element) {
          warnings.push("target_not_found");
          return { complete: false, facts: {}, warnings };
        }
        const record = (fn: () => unknown, fallback: unknown = null) => {
          try {
            return fn();
          } catch {
            return fallback;
          }
        };
        const style = record(() => getComputedStyle(element!)) as CSSStyleDeclaration | null;
        const rect = record(() => element!.getBoundingClientRect(), null) as DOMRect | null;
        const foreground = style?.color ?? null;
        const background = style?.backgroundColor ?? null;
        const parseColor = (value: string | null) => {
          if (!value) return null;
          const match = value.match(
            /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i,
          );
          if (!match) return null;
          return {
            r: Number(match[1]),
            g: Number(match[2]),
            b: Number(match[3]),
            a: match[4] === undefined ? 1 : Number(match[4]),
          };
        };
        const luminance = (value: { r: number; g: number; b: number; a: number }) => {
          const channel = (component: number) => {
            const normalized = component / 255;
            return normalized <= 0.03928
              ? normalized / 12.92
              : Math.pow((normalized + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * channel(value.r) + 0.7152 * channel(value.g) + 0.0722 * channel(value.b);
        };
        const foregroundColor = parseColor(foreground);
        const backgroundColor = parseColor(background);
        const contrastRatio =
          foregroundColor && backgroundColor
            ? (Math.max(luminance(foregroundColor), luminance(backgroundColor)) + 0.05) /
              (Math.min(luminance(foregroundColor), luminance(backgroundColor)) + 0.05)
            : null;
        const tagName = element.tagName.toLowerCase();
        const tabIndex = record(() => (element as HTMLElement).tabIndex, null);
        const accessibleText = record(
          () =>
            (element as HTMLElement).innerText ||
            element!.textContent?.replace(/\s+/g, " ").trim() ||
            null,
          null,
        );
        const relatedText = record(
          () =>
            element!.parentElement?.innerText?.replace(/\s+/g, " ").trim().slice(0, 2000) ?? null,
          null,
        );
        const outerHtml = record(() => element!.outerHTML.slice(0, 4000), null);
        const facts: Record<string, unknown> = {
          matchedSelector,
          tagName,
          role: element.getAttribute("role"),
          ariaLabel: element.getAttribute("aria-label"),
          ariaLabelledby: element.getAttribute("aria-labelledby"),
          ariaDescribedby: element.getAttribute("aria-describedby"),
          title: element.getAttribute("title"),
          alt: element.getAttribute("alt"),
          accessibleText: typeof accessibleText === "string" ? accessibleText.slice(0, 1000) : null,
          relatedText,
          outerHtml,
          focusable: tabIndex !== null ? Number(tabIndex) >= 0 : null,
          focused: document.activeElement === element,
          tabIndex,
          visible: rect
            ? Boolean(
                rect.width > 0 &&
                rect.height > 0 &&
                style?.display !== "none" &&
                style?.visibility !== "hidden",
              )
            : null,
          boundingBox: rect
            ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            : null,
          css: style
            ? {
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                position: style.position,
                color: foreground,
                backgroundColor: background,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                fontWeight: style.fontWeight,
                textDecoration: style.textDecoration,
              }
            : null,
          contrast: {
            foreground: foregroundColor,
            background: backgroundColor,
            ratio: contrastRatio,
          },
        };
        if (!rect) warnings.push("bounding_box_unavailable");
        if (!style) warnings.push("computed_style_unavailable");
        return { complete: true, facts, warnings };
      }, targets);
    } catch (error) {
      captured = {
        complete: false,
        facts: {},
        warnings: [`frame_evaluate_failed:${String(error).slice(0, 300)}`],
      };
    }
  }
  const envelope: AiEvidenceEnvelope = {
    version: AI_EVIDENCE_VERSION,
    complete: captured.complete,
    target: targets,
    facts: captured.facts,
    warnings: [...new Set(captured.warnings)],
    capturedAt: new Date().toISOString(),
  };
  if (typeof envelope.facts.outerHtml === "string")
    envelope.facts.outerHtml = sanitizeNodeHtml(envelope.facts.outerHtml).slice(0, 4000);
  const json = canonicalize(envelope);
  return { json, hash: sha256(json), version: AI_EVIDENCE_VERSION };
}

async function collectAiEvidence(
  frame: Frame | undefined,
  target: unknown,
): Promise<{ json: string; hash: string; version: string }> {
  try {
    return await collectAiEvidenceUnsafe(frame, target);
  } catch (error) {
    const targets = Array.isArray(target) ? target.map(String) : [String(target)];
    const json = canonicalize({
      version: AI_EVIDENCE_VERSION,
      complete: false,
      target: targets,
      facts: {},
      warnings: [`collector_failed:${String(error).slice(0, 300)}`],
      capturedAt: new Date().toISOString(),
    });
    return { json, hash: sha256(json), version: AI_EVIDENCE_VERSION };
  }
}
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
    const frames = page.frames().slice(1);
    const origin = new URL(page.url()).origin;
    const convert = async (
      items: any[],
      resultType: "pass" | "violation" | "incomplete" | "inapplicable",
      framePath = "top",
      frame?: Frame,
    ): Promise<AxeRuleResult[]> =>
      Promise.all(
        items.map(async (item) => ({
          id: item.id,
          impact: classifyImpact(item.impact),
          tags: item.tags ?? [],
          description: item.description,
          help: item.help,
          helpUrl: item.helpUrl,
          nodes: await Promise.all(
            (item.nodes ?? []).map(async (node: any) => ({
              framePath,
              frameUrl: frame?.url() || undefined,
              frameOriginRelation: frame
                ? (() => {
                    try {
                      return new URL(frame.url()).origin === origin
                        ? "same_origin"
                        : "cross_origin";
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
              ...(resultType === "incomplete"
                ? { aiEvidence: await collectAiEvidence(frame ?? page.mainFrame(), node.target) }
                : {}),
            })),
          ),
        })),
      );
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
        frameResults.passes.push(
          ...(await convert(frameRaw.passes ?? [], "pass", framePath, frame)),
        );
        frameResults.violations.push(
          ...(await convert(frameRaw.violations ?? [], "violation", framePath, frame)),
        );
        frameResults.incomplete.push(
          ...(await convert(frameRaw.incomplete ?? [], "incomplete", framePath, frame)),
        );
        frameResults.inapplicable.push(
          ...(await convert(frameRaw.inapplicable ?? [], "inapplicable", framePath, frame)),
        );
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
        passes: [...(await convert(raw.passes, "pass")), ...frameResults.passes],
        violations: [...(await convert(raw.violations, "violation")), ...frameResults.violations],
        incomplete: [...(await convert(raw.incomplete, "incomplete")), ...frameResults.incomplete],
        inapplicable: [
          ...(await convert(raw.inapplicable, "inapplicable")),
          ...frameResults.inapplicable,
        ],
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
