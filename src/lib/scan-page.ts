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
export const AI_EVIDENCE_VERSION = "ai-evidence-v2";
const MAX_AI_EVIDENCE_CHARACTERS = 60_000;
const MAX_TARGET_OUTER_HTML_CHARACTERS = 6_000;

type AiEvidenceEnvelope = {
  version: string;
  complete: boolean;
  facts: Record<string, unknown>;
  warnings: string[];
  capturedAt: string;
  truncated?: boolean;
};

function unicodeLength(value: string) {
  return Array.from(value).length;
}

function truncateUnicode(value: string, maximum: number) {
  const characters = Array.from(value);
  return characters.length <= maximum ? value : `${characters.slice(0, maximum).join("")}…`;
}

function encodeEvidence(envelope: AiEvidenceEnvelope) {
  let json = canonicalize(envelope);
  if (unicodeLength(json) <= MAX_AI_EVIDENCE_CHARACTERS) return json;
  const facts = envelope.facts as Record<string, any>;
  const target = facts.target as Record<string, unknown> | undefined;
  const page = facts.page as Record<string, unknown> | undefined;
  const fallback: AiEvidenceEnvelope = {
    version: envelope.version,
    complete: envelope.complete,
    capturedAt: envelope.capturedAt,
    truncated: true,
    warnings: [...new Set([...envelope.warnings, "evidence_truncated_to_target_context"])],
    facts: {
      target: target
        ? {
            ...target,
            outerHtml:
              typeof target.outerHtml === "string"
                ? truncateUnicode(target.outerHtml, 3_000)
                : null,
          }
        : null,
      page: page
        ? {
            url: page.url ?? null,
            title: page.title ?? null,
            lang: page.lang ?? null,
          }
        : null,
      ancestors: Array.isArray(facts.ancestors) ? facts.ancestors.slice(0, 3) : [],
      siblings: Array.isArray(facts.siblings) ? facts.siblings.slice(0, 4) : [],
    },
  };
  json = canonicalize(fallback);
  if (unicodeLength(json) <= MAX_AI_EVIDENCE_CHARACTERS) return json;
  json = canonicalize({
    version: envelope.version,
    complete: envelope.complete,
    capturedAt: envelope.capturedAt,
    truncated: true,
    warnings: [...new Set([...envelope.warnings, "evidence_minimized"])],
    facts: {
      target: target
        ? {
            tagName: target.tagName ?? null,
            role: target.role ?? null,
            outerHtml:
              typeof target.outerHtml === "string"
                ? truncateUnicode(target.outerHtml, 1_000)
                : null,
          }
        : null,
      page: page ? { url: page.url ?? null, title: page.title ?? null } : null,
    },
  });
  if (unicodeLength(json) <= MAX_AI_EVIDENCE_CHARACTERS) return json;
  // Page-controlled strings (for example a very large URL/title) must not
  // defeat the persisted evidence size limit.
  return canonicalize({
    version: envelope.version,
    complete: envelope.complete,
    capturedAt: envelope.capturedAt,
    truncated: true,
    warnings: [...new Set([...envelope.warnings, "evidence_minimized"])],
    facts: {},
  });
}

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
      const evidenceCollector = (selectors: string[]) => {
        const warnings: string[] = [];
        let element: Element | null = null;
        for (const selector of selectors) {
          try {
            const candidate = document.querySelector(selector);
            if (candidate) {
              element = candidate;
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
        const compact = (value: unknown, limit: number) =>
          typeof value === "string"
            ? Array.from(value.replace(/\s+/g, " ").trim()).slice(0, limit).join("")
            : null;
        const shortText = (node: Element | null, limit = 500) =>
          node ? compact((node as HTMLElement).innerText || node.textContent || "", limit) : null;
        const visibility = (node: Element | null) => {
          if (!node) return null;
          const nodeStyle = record(() => getComputedStyle(node), null) as CSSStyleDeclaration | null;
          const nodeRect = record(() => node.getBoundingClientRect(), null) as DOMRect | null;
          return nodeRect
            ? Boolean(
                nodeRect.width > 0 &&
                  nodeRect.height > 0 &&
                  nodeStyle?.display !== "none" &&
                  nodeStyle?.visibility !== "hidden" &&
                  nodeStyle?.opacity !== "0",
              )
            : null;
        };
        const summary = (node: Element | null, textLimit = 500) =>
          node
            ? {
                tagName: node.tagName.toLowerCase(),
                id: node.id || null,
                role: node.getAttribute("role"),
                ariaLabel: node.getAttribute("aria-label"),
                name: node.getAttribute("name"),
                text: shortText(node, textLimit),
                visible: visibility(node),
              }
            : null;
        const idsToText = (value: string | null) =>
          value
            ? value
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 12)
                .map((identifier) => ({ id: identifier, text: shortText(document.getElementById(identifier), 500) }))
            : [];
        const labels = (node: Element) => {
          const output: Array<{ text: string | null; for: string | null }> = [];
          const input = node as HTMLInputElement;
          if (input.labels)
            for (const label of Array.from(input.labels).slice(0, 8))
              output.push({ text: shortText(label, 500), for: label.htmlFor || null });
          if (node.id)
            for (const label of Array.from(document.querySelectorAll(`label[for="${CSS.escape(node.id)}"]`)).slice(0, 8))
              output.push({ text: shortText(label, 500), for: node.id });
          return output;
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
        const outerHtml = record(() => element!.outerHTML, null);
        const attributes = Array.from(element.attributes)
          .slice(0, 30)
          .map((attribute) => ({
            name: attribute.name,
            value:
              attribute.name.toLowerCase() === "value" || attribute.name.toLowerCase() === "data-value"
                ? "[redacted]"
                : compact(attribute.value, 200),
          }));
        const ancestors: unknown[] = [];
        let ancestor = element.parentElement;
        for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement)
          ancestors.push(summary(ancestor, 500));
        const siblings = Array.from(element.parentElement?.children ?? [])
          .filter((candidate) => candidate !== element)
          .slice(0, 10)
          .map((candidate) => summary(candidate, 350));
        const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
          .slice(0, 15)
          .map((heading) => ({ level: heading.tagName.toLowerCase(), text: shortText(heading, 300) }));
        const landmarks = Array.from(
          document.querySelectorAll(
            "main,header,footer,nav,aside,form,[role='main'],[role='banner'],[role='contentinfo'],[role='navigation'],[role='complementary'],[role='search'],[role='form']",
          ),
        )
          .slice(0, 15)
          .map((landmark) => summary(landmark, 250));
        const semanticDom = Array.from(
          document.querySelectorAll(
            "main,header,footer,nav,aside,section,article,form,h1,h2,h3,h4,h5,h6,button,a,input,select,textarea,[role]",
          ),
        )
          .slice(0, 180)
          .map((node) => summary(node, 120));
        const facts: Record<string, unknown> = {
          target: {
            tagName,
            id: element.id || null,
            attributes,
            role: element.getAttribute("role"),
            ariaLabel: element.getAttribute("aria-label"),
            ariaLabelledby: element.getAttribute("aria-labelledby"),
            ariaDescribedby: element.getAttribute("aria-describedby"),
            labelledBy: idsToText(element.getAttribute("aria-labelledby")),
            describedBy: idsToText(element.getAttribute("aria-describedby")),
            labels: labels(element),
            title: element.getAttribute("title"),
            alt: element.getAttribute("alt"),
            accessibleText: typeof accessibleText === "string" ? compact(accessibleText, 2_000) : null,
            outerHtml: typeof outerHtml === "string" ? Array.from(outerHtml).slice(0, 6_000).join("") : null,
            focusable: tabIndex !== null ? Number(tabIndex) >= 0 : null,
            focused: document.activeElement === element,
            tabIndex,
            visible: visibility(element),
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
                  outline: style.outline,
                }
              : null,
            contrast: {
              foreground: foregroundColor,
              background: backgroundColor,
              ratio: contrastRatio,
            },
          },
          ancestors,
          siblings,
          page: {
            url: location.href,
            title: document.title || null,
            lang: document.documentElement.lang || null,
            headings,
            landmarks,
            visibleText: compact(document.body?.innerText ?? "", 10_000),
            semanticDom,
          },
        };
        if (!rect) warnings.push("bounding_box_unavailable");
        if (!style) warnings.push("computed_style_unavailable");
        return { complete: true, facts, warnings };
      };
      // Playwright serializes page functions by calling toString(). The
      // tsx/esbuild output can contain __name(...) calls for local helpers;
      // provide that dependency explicitly in the page expression instead of
      // relying on a module-scoped binding that is absent in the frame.
      const serializedCollector = `((__name) => (${evidenceCollector.toString()}))((target) => target)`;
      captured = await frame.evaluate(`${serializedCollector}(${JSON.stringify(targets)})`);
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
    facts: captured.facts,
    warnings: [...new Set(captured.warnings)],
    capturedAt: new Date().toISOString(),
  };
  const targetFacts = envelope.facts.target as Record<string, unknown> | undefined;
  if (typeof targetFacts?.outerHtml === "string")
    targetFacts.outerHtml = truncateUnicode(
      sanitizeNodeHtml(targetFacts.outerHtml, MAX_TARGET_OUTER_HTML_CHARACTERS),
      MAX_TARGET_OUTER_HTML_CHARACTERS,
    );
  const json = encodeEvidence(envelope);
  return { json, hash: sha256(json), version: AI_EVIDENCE_VERSION };
}

async function collectAiEvidence(
  frame: Frame | undefined,
  target: unknown,
): Promise<{ json: string; hash: string; version: string }> {
  try {
    return await collectAiEvidenceUnsafe(frame, target);
  } catch (error) {
    const json = encodeEvidence({
      version: AI_EVIDENCE_VERSION,
      complete: false,
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
