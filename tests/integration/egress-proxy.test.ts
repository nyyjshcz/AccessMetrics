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

  it("keeps a public IPv4 result when the IPv6 resolver rejects", async () => {
    const policy = new DestinationPolicy({
      resolverFactory: () => ({
        resolve4: async () => ["93.184.216.34"],
        resolve6: async () => {
          throw Object.assign(new Error("IPv6 unavailable"), { code: "EAI_AGAIN" });
        },
      }),
    });

    await expect(policy.lookup("public.example")).resolves.toEqual({
      host: "public.example",
      addresses: ["93.184.216.34"],
    });
  });

  it("keeps a public IPv4 result when the IPv6 resolver is empty", async () => {
    const policy = new DestinationPolicy({
      resolverFactory: () => ({
        resolve4: async () => ["93.184.216.34"],
        resolve6: async () => [],
      }),
    });

    await expect(policy.lookup("public.example")).resolves.toEqual({
      host: "public.example",
      addresses: ["93.184.216.34"],
    });
  });

  it("shares concurrent normalized-host lookups", async () => {
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    let resolverCalls = 0;
    const policy = new DestinationPolicy({
      resolverFactory: () => {
        resolverCalls += 1;
        return {
          resolve4: async () => {
            await started;
            return ["93.184.216.34"];
          },
          resolve6: async () => {
            await started;
            return [];
          },
        };
      },
    });

    const first = policy.lookup("Example.com.");
    const second = policy.lookup("example.com");
    await vi.waitFor(() => expect(resolverCalls).toBe(1));
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { host: "example.com", addresses: ["93.184.216.34"] },
      { host: "example.com", addresses: ["93.184.216.34"] },
    ]);
  });

  it("reuses a valid minimum TTL, clones results, and expires conservatively", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    let resolverCalls = 0;
    const policy = new DestinationPolicy({
      resolverFactory: () => {
        resolverCalls += 1;
        return {
          resolve4: async () => [{ address: "93.184.216.34", ttl: 10 }],
          resolve6: async () => [{ address: "2001:4860:4860::8888", ttl: 5 }],
        } as any;
      },
    });

    const first = await policy.lookup("public.example");
    first.addresses.push("198.51.100.7");
    await expect(policy.lookup("PUBLIC.EXAMPLE.")).resolves.toEqual({
      host: "public.example",
      addresses: ["93.184.216.34", "2001:4860:4860::8888"],
    });
    expect(resolverCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(5_001);
    await expect(policy.lookup("public.example")).resolves.toEqual({
      host: "public.example",
      addresses: ["93.184.216.34", "2001:4860:4860::8888"],
    });
    expect(resolverCalls).toBe(2);
  });

  it("passes TTL options to built-in family lookups and caps long TTLs", async () => {
    vi.useFakeTimers();
    const options: unknown[] = [];
    let resolverCalls = 0;
    const policy = new DestinationPolicy({
      resolverFactory: () => {
        resolverCalls += 1;
        return {
          resolve4: async (_host: string, lookupOptions?: unknown) => {
            options.push(lookupOptions);
            return [{ address: "93.184.216.34", ttl: 120 }];
          },
          resolve6: async (_host: string, lookupOptions?: unknown) => {
            options.push(lookupOptions);
            return [];
          },
        } as any;
      },
    });

    await policy.lookup("long-lived.example");
    await vi.advanceTimersByTimeAsync(60_001);
    await policy.lookup("long-lived.example");

    expect(options).toEqual([{ ttl: true }, { ttl: true }, { ttl: true }, { ttl: true }]);
    expect(resolverCalls).toBe(2);
  });

  it("cleans up failed singleflight attempts so retries can resolve", async () => {
    let resolverCalls = 0;
    const policy = new DestinationPolicy({
      resolverFactory: () => {
        resolverCalls += 1;
        const failed = resolverCalls === 1;
        return {
          resolve4: async () => {
            if (failed) throw Object.assign(new Error("temporary"), { code: "EAI_AGAIN" });
            return ["93.184.216.34"];
          },
          resolve6: async () => {
            if (failed) throw Object.assign(new Error("temporary"), { code: "EAI_AGAIN" });
            return [];
          },
        };
      },
    });

    const first = policy.lookup("retry.example");
    const shared = policy.lookup("RETRY.EXAMPLE.");
    await expect(Promise.all([first, shared])).rejects.toMatchObject({ code: "EAI_AGAIN" });
    expect(resolverCalls).toBe(1);
    await expect(policy.lookup("retry.example")).resolves.toEqual({
      host: "retry.example",
      addresses: ["93.184.216.34"],
    });
    expect(resolverCalls).toBe(2);
  });

  it("does not cache injected, private, negative, or stale results", async () => {
    vi.useFakeTimers();
    let injectedCalls = 0;
    const injectedPolicy = new DestinationPolicy({
      lookupAll: async () => {
        injectedCalls += 1;
        return [{ address: "93.184.216.34" }];
      },
    });
    await injectedPolicy.lookup("injected.example");
    await injectedPolicy.lookup("injected.example");
    expect(injectedCalls).toBe(2);

    let resolverCalls = 0;
    const attemptsByHost = new Map<string, number>();
    const policy = new DestinationPolicy({
      resolverFactory: () => {
        resolverCalls += 1;
        return {
          resolve4: async (host: string) => {
            const attempt = (attemptsByHost.get(host) ?? 0) + 1;
            attemptsByHost.set(host, attempt);
            if (host === "private.example" && attempt === 1)
              return [{ address: "127.0.0.1", ttl: 60 }];
            if (host === "negative.example" && attempt === 1) return [];
            if (host === "stale.example" && attempt === 2)
              return [{ address: "127.0.0.1", ttl: 60 }];
            return [{ address: "93.184.216.34", ttl: host === "stale.example" ? 1 : 60 }];
          },
          resolve6: async () => [],
        } as any;
      },
    });

    await expect(policy.lookup("private.example")).rejects.toThrow("private destination not allowed");
    await expect(policy.lookup("private.example")).resolves.toEqual({
      host: "private.example",
      addresses: ["93.184.216.34"],
    });
    await expect(policy.lookup("negative.example")).rejects.toThrow("private destination not allowed");
    await expect(policy.lookup("negative.example")).resolves.toEqual({
      host: "negative.example",
      addresses: ["93.184.216.34"],
    });
    expect(resolverCalls).toBe(4);

    await expect(policy.lookup("stale.example")).resolves.toEqual({
      host: "stale.example",
      addresses: ["93.184.216.34"],
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(policy.lookup("stale.example")).rejects.toThrow("private destination not allowed");
    expect(resolverCalls).toBe(6);
  });

  it("bounds the positive DNS cache at 512 entries", async () => {
    let resolverCalls = 0;
    const policy = new DestinationPolicy({
      resolverFactory: () => {
        resolverCalls += 1;
        return {
          resolve4: async () => [{ address: "93.184.216.34", ttl: 60 }],
          resolve6: async () => [],
        } as any;
      },
    });

    for (let index = 0; index < 513; index += 1)
      await policy.lookup(`entry-${index}.example`);
    await policy.lookup("entry-0.example");

    expect(resolverCalls).toBe(514);
  });

  it("cancels the resolver when the policy DNS timeout wins", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const policy = new DestinationPolicy({
      resolverFactory: () => ({
        resolve4: async () => new Promise<string[]>(() => {}),
        resolve6: async () => new Promise<string[]>(() => {}),
        cancel,
      }),
    });
    const pending = policy.lookup("public.example");
    const rejection = expect(pending).rejects.toMatchObject({ code: "ETIMEOUT" });

    await vi.advanceTimersByTimeAsync(3_999);
    expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(cancel).toHaveBeenCalledTimes(1);
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
