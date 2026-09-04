import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalizeUrl,
  isPrivateIp,
  parseDohAnswers,
  parseProxyResolution,
  validateTargetUrl,
} from "@/lib/url-security";

describe("target URL security", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects any private address returned by DNS policy", async () => {
    await expect(
      validateTargetUrl("https://example.test", {
        lookupAll: async () => ["93.184.216.34", "192.168.1.4"],
      }),
    ).rejects.toMatchObject({ code: "PRIVATE_TARGET" });
  });
  it("accepts a public address and removes fragments", async () => {
    const url = await validateTargetUrl("https://example.test/path#section", {
      lookupAll: async () => ["93.184.216.34"],
    });
    expect(url.toString()).toBe("https://example.test/path");
  });
  it("rejects credentials, localhost and IPv6 private space", async () => {
    await expect(
      validateTargetUrl("https://user:pass@example.test", {
        lookupAll: async () => ["93.184.216.34"],
      }),
    ).rejects.toMatchObject({ code: "URL_NOT_ALLOWED" });
    await expect(
      validateTargetUrl("http://localhost:8080", { lookupAll: async () => ["93.184.216.34"] }),
    ).rejects.toMatchObject({ code: "PRIVATE_TARGET" });
    await expect(
      validateTargetUrl("http://[::1]/", { lookupAll: async () => ["::1"] }),
    ).rejects.toMatchObject({ code: "PRIVATE_TARGET" });
  });
  it("canonicalizes tracking parameters deterministically", () => {
    expect(canonicalizeUrl("https://example.test/a/?utm_source=x&b=2&a=1#x")).toBe(
      "https://example.test/a?a=1&b=2",
    );
  });
  it("blocks carrier-grade, link-local, multicast and encoded IPv4 ranges", () => {
    for (const address of [
      "100.64.0.1",
      "0.0.0.1",
      "0.255.255.255",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::127.0.0.1",
      "::192.168.1.1",
      "::0.0.0.0",
      "::7f00:1",
      "::c0a8:101",
      "0:0:0:0:0:0:7f00:1",
      "0000:0000:0000:0000:0000:0000:7f00:0001",
      "0:0:0:0:0:0:192.168.1.1",
      "2130706433",
      "0x7f000001",
      "017700000001",
    ]) {
      expect(isPrivateIp(address)).toBe(true);
    }
  });

  it("rejects numeric/hex IPv4 aliases before consulting DNS", async () => {
    for (const hostname of ["2130706433", "0x7f000001", "017700000001"]) {
      await expect(
        validateTargetUrl(`http://${hostname}/`, {
          lookupAll: async () => ["93.184.216.34"],
        }),
      ).rejects.toMatchObject({ code: "PRIVATE_TARGET" });
    }
  });

  it("rejects mapped IPv6 addresses and every 0/8 IPv4 address", async () => {
    await expect(
      validateTargetUrl("http://[::ffff:7f00:1]/", {
        lookupAll: async () => ["93.184.216.34"],
      }),
    ).rejects.toMatchObject({ code: "PRIVATE_TARGET" });
    for (const address of ["0.0.0.1", "0.255.255.255"]) expect(isPrivateIp(address)).toBe(true);
  });

  it("parses only typed DoH answers and preserves the shortest TTL", () => {
    expect(
      parseDohAnswers(
        {
          Status: 0,
          Answer: [
            { type: 1, data: "112.124.240.62", TTL: 600 },
            { type: 1, data: "198.18.0.67", TTL: 120 },
            { type: 28, data: "2408:4005:1011:1000::108", TTL: 300 },
            { type: 1, data: "not-an-ip", TTL: 1 },
          ],
        },
        1,
      ),
    ).toEqual({
      addresses: ["112.124.240.62", "198.18.0.67"],
      ttlMs: 120_000,
    });
  });

  it("accepts only IP addresses from the controlled proxy resolver", () => {
    expect(parseProxyResolution({ addresses: ["93.184.216.34", "not-an-ip", 42] })).toEqual([
      "93.184.216.34",
    ]);
    expect(parseProxyResolution({ addresses: "93.184.216.34" })).toEqual([]);
  });

  it("turns resolver failures into a safe client error", async () => {
    await expect(
      validateTargetUrl("https://example.test", {
        lookupAll: async () => {
          throw new Error("resolver unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "DNS_LOOKUP_FAILED", status: 422 });
  });

  it("recovers from a transient resolver failure within the bounded retry budget", async () => {
    let calls = 0;
    const url = await validateTargetUrl("https://example.test", {
      lookupAll: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("try again"), { code: "EAI_AGAIN" });
        return ["93.184.216.34"];
      },
    });
    expect(url.hostname).toBe("example.test");
    expect(calls).toBe(2);
  });

  it("recovers after one proxy resolver timeout", async () => {
    let calls = 0;
    const url = await validateTargetUrl("https://example.test", {
      lookupAll: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new DOMException("timed out", "TimeoutError"));
        return ["93.184.216.34"];
      },
    });
    expect(url.hostname).toBe("example.test");
    expect(calls).toBe(2);
  });

  it("retries a TimeoutError from the actual proxy fetch seam", async () => {
    vi.resetModules();
    vi.stubEnv("DNS_RESOLVER_MODE", "proxy");
    vi.stubEnv("EGRESS_PROXY_URL", "http://egress-proxy.test");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ addresses: ["93.184.216.34"] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { validateTargetUrl: validateProxyTargetUrl } = await import("@/lib/url-security");

    await expect(validateProxyTargetUrl("https://example.test")).resolves.toMatchObject({
      hostname: "example.test",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("backs off before retrying transient resolver failures", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const pending = validateTargetUrl("https://example.test", {
      lookupAll: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("try again"), { code: "EAI_AGAIN" });
        return ["93.184.216.34"];
      },
    });
    await Promise.resolve();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(149);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ hostname: "example.test" });
    expect(calls).toBe(2);
  });

  it("does not retry permanent resolver failures or retry after exhaustion", async () => {
    let permanentCalls = 0;
    await expect(
      validateTargetUrl("https://example.test", {
        lookupAll: async () => {
          permanentCalls += 1;
          throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
        },
      }),
    ).rejects.toMatchObject({ code: "DNS_LOOKUP_FAILED" });
    expect(permanentCalls).toBe(1);

    let transientCalls = 0;
    await expect(
      validateTargetUrl("https://example.test", {
        lookupAll: async () => {
          transientCalls += 1;
          throw Object.assign(new Error("still unavailable"), { code: "EAI_AGAIN" });
        },
      }),
    ).rejects.toMatchObject({ code: "DNS_LOOKUP_FAILED" });
    expect(transientCalls).toBe(3);
  });

  it("exhausts exactly three attempts for repeated proxy resolver timeouts", async () => {
    let calls = 0;
    await expect(
      validateTargetUrl("https://example.test", {
        lookupAll: async () => {
          calls += 1;
          throw Object.assign(new DOMException("timed out", "TimeoutError"));
        },
      }),
    ).rejects.toMatchObject({ code: "DNS_LOOKUP_FAILED" });
    expect(calls).toBe(3);
  });

  it("exhausts exactly three attempts through the actual proxy fetch seam", async () => {
    vi.resetModules();
    vi.stubEnv("DNS_RESOLVER_MODE", "proxy");
    vi.stubEnv("EGRESS_PROXY_URL", "http://egress-proxy.test");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);
    const { validateTargetUrl: validateProxyTargetUrl } = await import("@/lib/url-security");

    await expect(validateProxyTargetUrl("https://example.test")).rejects.toMatchObject({
      code: "DNS_LOOKUP_FAILED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
