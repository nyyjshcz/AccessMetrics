import { afterEach, describe, expect, it, vi } from "vitest";
import { createProxyServer, DestinationPolicy } from "../../tools/egress-proxy/proxy.mjs";

describe("controlled egress DNS resolver", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves through the proxy endpoint and rejects private results", async () => {
    const policy = new DestinationPolicy({
      lookupAll: async (host: string) =>
        host === "public.example"
          ? [{ address: "93.184.216.34" }]
          : host === "compatible-private.example"
            ? [{ address: "::7f00:1" }]
            : host === "compatible-full-private.example"
              ? [{ address: "0000:0000:0000:0000:0000:0000:7f00:0001" }]
              : [{ address: "127.0.0.1" }],
    });
    const server = createProxyServer({ policy });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const allowed = await fetch(`http://127.0.0.1:${port}/resolve?name=public.example`);
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toEqual({ addresses: ["93.184.216.34"] });
      const blocked = await fetch(`http://127.0.0.1:${port}/resolve?name=private.example`);
      expect(blocked.status).toBe(403);
      const compatibleBlocked = await fetch(
        `http://127.0.0.1:${port}/resolve?name=compatible-private.example`,
      );
      expect(compatibleBlocked.status).toBe(403);
      const fullCompatibleBlocked = await fetch(
        `http://127.0.0.1:${port}/resolve?name=compatible-full-private.example`,
      );
      expect(fullCompatibleBlocked.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error?: Error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("exposes temporary resolver unavailability without leaking resolver details", async () => {
    const policy = new DestinationPolicy({
      lookupAll: async () => {
        throw Object.assign(new Error("internal resolver address=10.0.0.2"), {
          code: "EAI_AGAIN",
        });
      },
    });
    const server = createProxyServer({ policy });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/resolve?name=public.example`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "resolver_unavailable" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error?: Error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("combines addresses from concurrent IPv4 and IPv6 resolver calls", async () => {
    const calls: string[] = [];
    let release!: () => void;
    const bothFamiliesStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const policy = new DestinationPolicy({
      resolverFactory: () => ({
        resolve4: async (host: string) => {
          calls.push(`4:${host}`);
          if (calls.length === 2) release();
          await bothFamiliesStarted;
          return ["93.184.216.34"];
        },
        resolve6: async (host: string) => {
          calls.push(`6:${host}`);
          if (calls.length === 2) release();
          await bothFamiliesStarted;
          return ["2001:4860:4860::8888"];
        },
      }),
    });
    const server = createProxyServer({ policy });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/resolve?name=public.example`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        addresses: ["93.184.216.34", "2001:4860:4860::8888"],
      });
      expect(calls).toEqual(["4:public.example", "6:public.example"]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error?: Error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("sanitizes temporary family failures when no address resolves", async () => {
    const policy = new DestinationPolicy({
      resolverFactory: () => ({
        resolve4: async () => {
          throw Object.assign(new Error("internal resolver address=10.0.0.2"), {
            code: "ETIMEOUT",
          });
        },
        resolve6: async () => {
          throw Object.assign(new Error("internal resolver address=10.0.0.3"), {
            code: "EAI_AGAIN",
          });
        },
      }),
    });
    const server = createProxyServer({ policy });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/resolve?name=public.example`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "resolver_unavailable" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error?: Error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("bounds upstream DNS lookup at four seconds", async () => {
    vi.useFakeTimers();
    const policy = new DestinationPolicy({ lookupAll: async () => new Promise(() => {}) });
    const pending = policy.lookup("public.example");
    await vi.advanceTimersByTimeAsync(3_999);
    let settled = false;
    void pending.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toMatchObject({ code: "ETIMEOUT" });
  });

  it("clears the DNS timeout when lookup fails synchronously", async () => {
    vi.useFakeTimers();
    const policy = new DestinationPolicy({
      lookupAll: () => {
        throw new Error("resolver failed synchronously");
      },
    });

    await expect(policy.lookup("public.example")).rejects.toThrow("resolver failed synchronously");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sanitizes ETIMEOUT from the proxy resolver", async () => {
    const policy = new DestinationPolicy({
      lookupAll: async () => {
        throw Object.assign(new Error("internal resolver address=10.0.0.2"), {
          code: "ETIMEOUT",
        });
      },
    });
    const server = createProxyServer({ policy });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/resolve?name=public.example`);
      expect(response.status).toBe(503);
      expect(await response.text()).toBe('{"error":"resolver_unavailable"}');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error?: Error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("sanitizes a standard TimeoutError and logs only fixed timeout fields", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const policy = new DestinationPolicy({
      lookupAll: async () => {
        throw new DOMException("resolver target=secret.example", "TimeoutError");
      },
    });
    const server = createProxyServer({ policy });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/resolve?name=secret.example`);
      expect(response.status).toBe(503);
      expect(await response.text()).toBe('{"error":"resolver_unavailable"}');
      expect(log).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(entry).toEqual({
        event: "resolver_timeout",
        resolver: "egress_proxy",
        elapsedMs: expect.any(Number),
        timeoutMs: 4000,
      });
      expect(entry).not.toHaveProperty("hostname");
      expect(entry).not.toHaveProperty("error");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error?: Error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
