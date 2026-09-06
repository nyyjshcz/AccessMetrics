import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
const { createProxyServer } = await import(
  process.env.EGRESS_PROXY_TEST_MODULE ?? "../../tools/egress-proxy/proxy.mjs"
);

// Run in a child process: an unhandled socket error must fail the test rather
// than being intercepted by the test runner's own uncaught-error handler.
const [protocol, phase, code] = process.argv.slice(2);
const deadline = setTimeout(() => {
  console.error("socket lifecycle test timed out");
  process.exit(1);
}, 5000);
const clients = new Set();
let upstreamConnections = 0;
let upstreamClosed = false;
const upstream = net.createServer((socket) => {
  upstreamConnections++;
  clients.add(socket);
  socket.on("error", () => {});
  socket.on("close", () => { upstreamClosed = true; clients.delete(socket); });
  socket.on("data", () => socket.write("upstream payload"));
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
let releaseResolution;
const resolution = new Promise((resolve) => { releaseResolution = resolve; });
const proxy = createProxyServer({ policy: {
  lookup: async () => ({ host: "public.example", addresses: ["93.184.216.34"] }),
  resolve: async () => {
    if (phase === "resolving") await resolution;
    return { host: "public.example", address: "127.0.0.1", port: upstream.address().port };
  },
} });
let proxyClient;
proxy.on(protocol, (_request, socket) => {
  proxyClient = socket;
  if (phase === "resolving") {
    socket.destroy(Object.assign(new Error("simulated peer disconnect"), { code }));
    releaseResolution();
  }
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const client = net.connect(proxy.address().port, "127.0.0.1");
client.on("error", () => {});
const clientClosed = new Promise((resolve) => client.on("close", resolve));
await once(client, "connect");
const received = once(client, "data").catch(() => []);
client.write(protocol === "connect"
  ? `CONNECT public.example:${upstream.address().port} HTTP/1.1\r\nHost: public.example\r\n\r\n`
  : `GET ws://public.example:${upstream.address().port}/chat HTTP/1.1\r\nHost: public.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
if (phase === "connected") {
  await received;
  proxyClient.destroy(Object.assign(new Error("simulated peer disconnect"), { code }));
}
await clientClosed;
// A fresh request must still work after the tunnel's failure.
const health = await fetch(`http://127.0.0.1:${proxy.address().port}/resolve?name=public.example`);
assert.equal(health.status, 200);
if (phase === "resolving") assert.equal(upstreamConnections, 0);
else {
  const until = Date.now() + 1000;
  while (!upstreamClosed && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(upstreamClosed, true, "disconnected tunnel must release upstream socket");
}
proxy.closeAllConnections();
await new Promise((resolve) => proxy.close(resolve));
for (const socket of clients) socket.destroy();
await new Promise((resolve) => upstream.close(resolve));
clearTimeout(deadline);
console.log("socket lifecycle passed");
