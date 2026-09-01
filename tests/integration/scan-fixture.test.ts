import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { discoverSite, discoverSiteDetailed } from "@/lib/crawler";
import { scanPage, closeScanner } from "@/lib/scan-page";

describe("known issue fixture scanner", () => {
  it("discovers deterministic same-origin pages and preserves key axe rule IDs", async () => {
    const root = path.join(process.cwd(), "tests", "fixtures", "known-issues");
    const serve = (request: http.IncomingMessage, response: http.ServerResponse, port?: number) => {
      if (request.url === "/robots.txt") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/plain");
        response.end("User-agent: *\nDisallow: /about.html\n");
        return;
      }
      if (request.url === "/redirect-root.html") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/html");
        response.end(
          '<!doctype html><a href="/redirect-a.html">A</a><a href="/redirect-target.html">Target</a><a href="/redirect-other.html">Other</a>',
        );
        return;
      }
      if (request.url === "/redirect-a.html") {
        response.statusCode = 302;
        response.setHeader("location", "/redirect-target.html");
        response.end();
        return;
      }
      if (request.url === "/redirect-target.html" || request.url === "/redirect-other.html") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/html");
        response.end("<!doctype html><title>redirect fixture</title>");
        return;
      }
      if (request.url === "/evidence.html") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/html");
        response.end(
          `<!doctype html><html lang="zh"><head><title>Evidence</title></head><body><p data-long="${"x".repeat(7000)}" style="color:#777;background-image:url(/missing.png)">背景图片文字</p></body></html>`,
        );
        return;
      }
      if (request.url === "/spa.html") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/html");
        response.end(
          `<!doctype html><html><head><title>SPA</title></head><body><script>setTimeout(() => { const link = document.createElement("a"); link.href = "/valid.html"; link.textContent = "Valid"; document.body.append(link); }, 50);</script></body></html>`,
        );
        return;
      }
      if (request.url === "/delayed.html") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/html");
        response.end('<!doctype html><html><body><script>setTimeout(() => { const b = document.createElement("button"); document.body.append(b); }, 100);</script></body></html>');
        return;
      }
      if (request.url === "/replacement-root.html") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/html");
        response.end('<!doctype html><a href="/missing-replacement.html">missing</a><a href="/gone-replacement.html">gone</a><a href="/replacement.html">replacement</a>');
        return;
      }
      if (request.url === "/gone-replacement.html") {
        response.statusCode = 410;
        response.setHeader("content-type", "text/html");
        response.end("gone");
        return;
      }
      if (request.url === "/replacement.html") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/html");
        response.end("<!doctype html><title>replacement</title>");
        return;
      }
      if (request.url === "/status-401") {
        response.statusCode = 401;
        response.end("auth required");
        return;
      }
      if (request.url === "/status-403") {
        response.statusCode = 403;
        response.end("forbidden");
        return;
      }
      if (request.url === "/status-503") {
        response.statusCode = 503;
        response.setHeader("content-type", "text/html");
        response.end("temporarily unavailable");
        return;
      }
      if (request.url === "/navigation-failure") {
        response.destroy();
        return;
      }
      const file = path.join(
        root,
        request.url?.split("?")[0] === "/" ? "index.html" : request.url!.slice(1),
      );
      if (!file.startsWith(root) || !fs.existsSync(file)) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.setHeader(
        "content-type",
        file.endsWith(".html") ? "text/html" : "application/octet-stream",
      );
      let bytes = fs.readFileSync(file);
      if (port && file.endsWith("cross-origin-frame.html"))
        bytes = Buffer.from(bytes.toString("utf8").replace("127.0.0.1:8766", `127.0.0.1:${port}`));
      response.end(bytes);
    };
    let crossPort = 0;
    const server = http.createServer((request, response) => serve(request, response, crossPort));
    const crossOriginServer = http.createServer((request, response) => serve(request, response));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    await new Promise<void>((resolve) => crossOriginServer.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const crossAddress = crossOriginServer.address();
    crossPort = typeof crossAddress === "object" && crossAddress ? crossAddress.port : 0;
    const target = `http://127.0.0.1:${port}/`;
    const testPolicy = { lookupAll: async () => ["127.0.0.1"], allowPrivateAddresses: true };
    try {
      const first = await discoverSite(target, {
        maxPages: 3,
        delayMs: 0,
        networkPolicy: testPolicy,
      });
      const second = await discoverSite(target, {
        maxPages: 3,
        delayMs: 0,
        networkPolicy: testPolicy,
      });
      const third = await discoverSite(target, {
        maxPages: 3,
        delayMs: 0,
        networkPolicy: testPolicy,
      });
      expect(first).toEqual(second);
      expect(second).toEqual(third);
      expect(first).not.toContain(`${target}about.html`);
      await expect(
        discoverSite(`${target}redirect-root.html`, {
          maxPages: 3,
          delayMs: 0,
          networkPolicy: testPolicy,
        }),
      ).resolves.toEqual([
        `${target}redirect-root.html`,
        `${target}redirect-target.html`,
        `${target}redirect-other.html`,
      ]);
      await expect(
        discoverSite(`${target}spa.html`, {
          maxPages: 2,
          delayMs: 0,
          networkPolicy: testPolicy,
        }),
      ).resolves.toEqual([`${target}spa.html`, `${target}valid.html`]);
      const result = await scanPage(target, 30000, testPolicy);
      const ruleIds = result.axe.violations.map((item) => item.id);
      expect(ruleIds).toEqual(expect.arrayContaining(["image-alt", "button-name", "link-name"]));
      expect(result.axe.passes.length).toBeGreaterThan(0);
      const delayed = await scanPage(`${target}delayed.html`, 5000, testPolicy);
      expect(delayed.axe.violations.some((rule) => rule.id === "button-name")).toBe(true);
      const detailed = await discoverSiteDetailed(`${target}replacement-root.html`, {
        maxPages: 2,
        delayMs: 0,
        networkPolicy: testPolicy,
      });
      expect(detailed.urls).toEqual([
        `${target}replacement-root.html`,
        `${target}replacement.html`,
      ]);
      expect(detailed.summary).toMatchObject({
        requestedPageLimit: 2,
        scanTargetCount: 2,
        skippedNotFoundCount: 2,
        stopReason: "page_limit",
      });
      const evidenceResult = await scanPage(`${target}evidence.html`, 30000, testPolicy);
      const incompleteNodes = evidenceResult.axe.incomplete.flatMap((rule) => rule.nodes);
      expect(incompleteNodes.length).toBeGreaterThan(0);
      for (const node of incompleteNodes) {
        expect(node.aiEvidence?.hash).toMatch(/^[a-f0-9]{64}$/);
        expect(node.aiEvidence?.version).toBe("ai-evidence-v2");
        const evidence = JSON.parse(node.aiEvidence!.json) as Record<string, unknown>;
        expect(Array.from(node.aiEvidence!.json).length).toBeLessThanOrEqual(60_000);
        expect(evidence.complete).toBe(true);
        expect(evidence.version).toBe("ai-evidence-v2");
        expect(evidence.facts).toEqual(expect.objectContaining({
          target: expect.objectContaining({ tagName: expect.any(String) }),
          page: expect.objectContaining({ url: expect.any(String) }),
        }));
        const outerHtml = (evidence.facts as { target?: { outerHtml?: unknown } }).target?.outerHtml;
        expect(outerHtml).toEqual(expect.any(String));
        expect(Array.from(outerHtml as string).length).toBe(6_000);
        expect(JSON.stringify(evidence.facts)).not.toContain('"rule"');
        expect(evidence).not.toHaveProperty("rule");
        expect(evidence).not.toHaveProperty("impact");
        expect(evidence).not.toHaveProperty("wcag");
      }
      const mixed = await scanPage(`${target}mixed-image-alt.html`, 30000, testPolicy);
      const mixedViolations = mixed.axe.violations.find((item) => item.id === "image-alt");
      const mixedPasses = mixed.axe.passes.find((item) => item.id === "image-alt");
      expect(mixedViolations?.nodes.length).toBeGreaterThan(0);
      expect(mixedPasses?.nodes.length).toBeGreaterThan(0);
      const sameOrigin = await scanPage(`${target}same-origin-frame.html`, 30000, testPolicy);
      expect(sameOrigin.frameCoverage).toMatchObject({
        frameTotal: 1,
        sameOriginFrameTotal: 1,
        crossOriginFrameTotal: 0,
        frameTestedTotal: 1,
        status: "full",
      });
      const crossOrigin = await scanPage(`${target}cross-origin-frame.html`, 30000, testPolicy);
      expect(crossOrigin.frameCoverage).toMatchObject({
        frameTotal: 1,
        sameOriginFrameTotal: 0,
        crossOriginFrameTotal: 1,
      });
      const sandboxed = await scanPage(`${target}sandboxed-frame.html`, 5000, testPolicy);
      expect(sandboxed.frameCoverage.frameTotal).toBe(1);
      expect(sandboxed.frameCoverage.status).toBe("coverage_limited");
      expect(sandboxed.frameCoverage.issues?.length).toBeGreaterThan(0);
      await expect(scanPage(`${target}non-html.pdf`, 5000, testPolicy)).rejects.toMatchObject({
        code: "NON_HTML",
      });
      expect(
        await discoverSite(`${target}links-loop.html#one`, {
          maxPages: 3,
          maxDepth: 0,
          delayMs: 0,
          networkPolicy: testPolicy,
        }),
      ).toEqual([`${target}links-loop.html`]);
      expect(
        await discoverSite(target, {
          maxPages: 3,
          maxDepth: 0,
          maxDurationMs: 0,
          delayMs: 0,
          networkPolicy: testPolicy,
        }),
      ).toEqual([]);
      await closeScanner();
      await expect(scanPage(target, 30000, testPolicy)).resolves.toMatchObject({ status: 200 });
      expect(crossPort).toBeGreaterThan(0);
      await expect(scanPage(`${target}status-401`, 5000, testPolicy)).rejects.toMatchObject({
        code: "HTTP_UNAUTHORIZED",
      });
      await expect(scanPage(`${target}status-403`, 5000, testPolicy)).rejects.toMatchObject({
        code: "HTTP_FORBIDDEN",
      });
      await expect(
        discoverSite(`${target}status-503`, { maxPages: 1, delayMs: 0, networkPolicy: testPolicy }),
      ).resolves.toEqual([`${target}status-503`]);
      await expect(scanPage(`${target}status-503`, 5000, testPolicy)).rejects.toMatchObject({
        code: "HTTP_ERROR",
        details: { status: 503 },
      });
      await expect(
        discoverSite(`${target}navigation-failure`, {
          maxPages: 1,
          delayMs: 0,
          networkPolicy: testPolicy,
        }),
      ).resolves.toEqual([`${target}navigation-failure`]);
    } finally {
      await closeScanner();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => crossOriginServer.close(() => resolve()));
    }
  }, 30000);
});
