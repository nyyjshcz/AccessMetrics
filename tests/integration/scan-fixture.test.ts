import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { discoverSite } from "@/lib/crawler";
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
      const result = await scanPage(target, 30000, testPolicy);
      const ruleIds = result.axe.violations.map((item) => item.id);
      expect(ruleIds).toEqual(expect.arrayContaining(["image-alt", "button-name", "link-name"]));
      expect(result.axe.passes.length).toBeGreaterThan(0);
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
    } finally {
      await closeScanner();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => crossOriginServer.close(() => resolve()));
    }
  }, 30000);
});
