import { describe, expect, it } from "vitest";
import { createProxyServer, DestinationPolicy } from "../../tools/egress-proxy/proxy.mjs";

describe("controlled egress DNS resolver", () => {
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
});
