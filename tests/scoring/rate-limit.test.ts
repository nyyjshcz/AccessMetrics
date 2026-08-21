import { describe, expect, it } from "vitest";
import { requestClientKey } from "@/lib/rate-limit";

describe("trusted reverse-proxy rate-limit identity", () => {
  it("does not trust a spoofed forwarded address without the Caddy marker", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.20" },
    });
    expect(requestClientKey(request, "login")).toBe("login:unknown");
  });

  it("uses the first forwarded address only after Caddy rewrites the marker", () => {
    const request = new Request("http://localhost", {
      headers: {
        "x-accesscheck-trusted-proxy": "caddy",
        "x-forwarded-for": "203.0.113.20, 10.0.0.2",
      },
    });
    expect(requestClientKey(request, "login")).toBe("login:203.0.113.20");
  });
});
