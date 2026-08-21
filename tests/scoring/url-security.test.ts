import { describe, expect, it } from "vitest";
import { canonicalizeUrl, isPrivateIp, validateTargetUrl } from "@/lib/url-security";

describe("target URL security", () => {
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
      "192.0.2.1",
      "198.18.0.1",
      "224.0.0.1",
      "fe80::1",
      "ff02::1",
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
});
