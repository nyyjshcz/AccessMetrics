import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/preferences/locale/route";

describe("locale preference endpoint", () => {
  it("accepts only the supported locale payload and sets a durable cookie", async () => {
    const response = await POST(
      new Request("http://localhost/api/preferences/locale", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ locale: "en" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ locale: "en" });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("accesscheck_locale=en");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Path=/");
    expect(cookie.toLowerCase()).not.toContain("secure");
  });

  it("rejects extra fields and cross-origin requests", async () => {
    const extra = await POST(
      new Request("http://localhost/api/preferences/locale", {
        method: "POST",
        body: JSON.stringify({ locale: "en", extra: true }),
      }),
    );
    expect(extra.status).toBe(400);

    const crossOrigin = await POST(
      new Request("http://localhost/api/preferences/locale", {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: JSON.stringify({ locale: "en" }),
      }),
    );
    expect(crossOrigin.status).toBe(403);
  });

  it("accepts a browser origin when the runtime URL is canonicalized differently", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/preferences/locale", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          host: "127.0.0.1:3000",
        },
        body: JSON.stringify({ locale: "en" }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it("accepts the standalone report form and redirects back safely", async () => {
    const response = await POST(
      new Request("http://localhost/api/preferences/locale", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "http://localhost",
        },
        body: new URLSearchParams({ locale: "en", returnTo: "/api/reports/run-1/html" }),
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/api/reports/run-1/html");
    expect(response.headers.get("set-cookie")).toContain("accesscheck_locale=en");
  });

  it("rejects an external standalone report redirect", async () => {
    const response = await POST(
      new Request("http://localhost/api/preferences/locale", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ locale: "en", returnTo: "https://evil.example/" }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("marks the preference cookie Secure only for HTTPS requests", async () => {
    const response = await POST(
      new Request("https://example.test/api/preferences/locale", {
        method: "POST",
        headers: { origin: "https://example.test", "x-forwarded-proto": "https" },
        body: JSON.stringify({ locale: "en" }),
      }),
    );
    expect(response.headers.get("set-cookie")?.toLowerCase()).toContain("secure");
  });
});
