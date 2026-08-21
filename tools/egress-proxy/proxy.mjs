import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import { URL } from "node:url";

const port = Number(process.env.PORT ?? 8080);
const privateIp = (address) => {
  const value = address.toLowerCase();
  if (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80:") ||
    value.startsWith("ff")
  )
    return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  return false;
};
async function destination(hostname, portNumber) {
  if (!Number.isInteger(portNumber) || ![80, 443].includes(portNumber))
    throw new Error("port not allowed");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  )
    throw new Error("private host not allowed");
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => privateIp(entry.address)))
    throw new Error("private destination not allowed");
  return addresses[0].address;
}
const server = http.createServer(async (request, response) => {
  try {
    const target = new URL(request.url);
    const address = await destination(
      target.hostname,
      Number(target.port || (target.protocol === "https:" ? 443 : 80)),
    );
    const upstream = http.request(
      {
        protocol: target.protocol,
        hostname: address,
        port: Number(target.port || 80),
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers: { ...request.headers, host: target.host },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", () => response.writeHead(502).end("upstream error"));
    request.pipe(upstream);
  } catch {
    response.writeHead(403).end("destination denied");
  }
});
server.on("connect", async (request, clientSocket, head) => {
  try {
    const [hostname, portText] = String(request.url).split(":");
    const portNumber = Number(portText);
    const address = await destination(hostname, portNumber);
    const upstream = net.connect(portNumber, address, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
  } catch {
    clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    clientSocket.destroy();
  }
});
server.listen(port, "0.0.0.0", () => console.log(`egress proxy listening on ${port}`));
