import assert from "node:assert/strict";
import { DestinationPolicy, isForbiddenAddress } from "../tools/egress-proxy/proxy.mjs";

const blocked = [
  "0.0.0.0",
  "10.0.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.1.1",
  "192.0.2.1",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "::1",
  "fc00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "2001:db8::1",
];
for (const address of blocked) assert.equal(isForbiddenAddress(address), true, address);
assert.equal(isForbiddenAddress("93.184.216.34"), false);

const policy = new DestinationPolicy({
  lookupAll: async (hostname) =>
    hostname === "public.example" ? [{ address: "93.184.216.34" }] : [{ address: "192.168.1.1" }],
});
assert.deepEqual(await policy.resolve("public.example", 443), {
  host: "public.example",
  port: 443,
  address: "93.184.216.34",
});
await assert.rejects(() => policy.resolve("private.example", 443));
await assert.rejects(() => policy.resolve("public.example", 8080));
await assert.rejects(() => policy.resolve("metadata.google.internal", 443));
console.log("egress proxy destination policy checks passed");
