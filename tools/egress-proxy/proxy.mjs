import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { pathToFileURL } from "node:url";

const ALLOWED_PORTS = new Set([80, 443]);
const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data.ec2.internal",
  "169.254.169.254",
  "169.254.170.2",
  "100.100.100.200",
]);

function normalizeHost(value) {
  const host = String(value ?? "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (!host || host.includes("/") || host.includes("%")) throw new Error("invalid host");
  return host;
}

function ipv4Forbidden(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && b >= 18 && b <= 19) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function ipv6Forbidden(address) {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("fec") ||
    normalized.startsWith("fed") ||
    normalized.startsWith("fee") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  )
    return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? ipv4Forbidden(mapped) : false;
}

export function isForbiddenAddress(address) {
  const kind = net.isIP(address);
  return kind === 4 ? ipv4Forbidden(address) : kind === 6 ? ipv6Forbidden(address) : true;
}

export class DestinationPolicy {
  constructor({ lookupAll = (hostname) => dns.lookup(hostname, { all: true, verbatim: true }) } = {}) {
    this.lookupAll = lookupAll;
  }

  async resolve(hostname, port) {
    const host = normalizeHost(hostname);
    if (!ALLOWED_PORTS.has(Number(port))) throw new Error("port not allowed");
    if (METADATA_HOSTS.has(host)) throw new Error("metadata destination not allowed");
    const addresses = net.isIP(host)
      ? [{ address: host }]
      : await this.lookupAll(host);
    if (!addresses.length || addresses.some((entry) => isForbiddenAddress(entry.address)))
      throw new Error("private destination not allowed");
    // The chosen address is returned to the caller and used by the dialer;
    // the original hostname is never passed to a downstream socket resolver.
    return { host, port: Number(port), address: addresses[0].address };
  }
}

function authority(value) {
  const raw = String(value ?? "");
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    if (close < 0 || raw[close + 1] !== ":") throw new Error("invalid CONNECT authority");
    return { hostname: raw.slice(1, close), port: Number(raw.slice(close + 2)) };
  }
  const split = raw.lastIndexOf(":");
  if (split <= 0) throw new Error("invalid CONNECT authority");
  return { hostname: raw.slice(0, split), port: Number(raw.slice(split + 1)) };
}

function requestTarget(raw) {
  const target = new URL(String(raw ?? ""));
  if (!["http:", "https:", "ws:", "wss:"].includes(target.protocol))
    throw new Error("protocol not allowed");
  const port = Number(
    target.port || (target.protocol === "http:" || target.protocol === "ws:" ? 80 : 443),
  );
  return { target, port };
}

function cleanHeaders(headers, host) {
  const result = { ...headers };
  delete result["proxy-connection"];
  delete result["Proxy-Connection"];
  result.host = host;
  return result;
}

function audit(event, details) {
  console.log(JSON.stringify({ event, ...details }));
}

export function createProxyServer({ policy = new DestinationPolicy() } = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      const { target, port } = requestTarget(request.url);
      const resolved = await policy.resolve(target.hostname, port);
      audit("forward", {
        protocol: target.protocol,
        hostname: resolved.host,
        port,
        address: resolved.address,
      });
      const transport = target.protocol === "https:" || target.protocol === "wss:" ? https : http;
      const upstream = transport.request(
        {
          protocol: transport === https ? "https:" : "http:",
          hostname: resolved.address,
          port,
          method: request.method,
          path: `${target.pathname}${target.search}`,
          headers: cleanHeaders(request.headers, target.host),
          ...(transport === https ? { servername: target.hostname } : {}),
        },
        (upstreamResponse) => {
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.pipe(response);
        },
      );
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end("upstream error");
      });
      request.pipe(upstream);
    } catch {
      response.writeHead(403);
      response.end("destination denied");
    }
  });

  server.on("connect", async (request, clientSocket, head) => {
    try {
      const { hostname, port } = authority(request.url);
      const resolved = await policy.resolve(hostname, port);
      audit("connect", {
        protocol: "connect",
        hostname: resolved.host,
        port,
        address: resolved.address,
      });
      const upstream = net.connect({ host: resolved.address, port, family: net.isIP(resolved.address) });
      upstream.once("connect", () => {
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

  server.on("upgrade", async (request, clientSocket, head) => {
    try {
      const { target, port } = requestTarget(request.url);
      if (target.protocol !== "ws:") throw new Error("wss must use CONNECT");
      const resolved = await policy.resolve(target.hostname, port);
      audit("upgrade", {
        protocol: target.protocol,
        hostname: resolved.host,
        port,
        address: resolved.address,
      });
      const upstream = net.connect({ host: resolved.address, port, family: net.isIP(resolved.address) });
      upstream.once("connect", () => {
        const headers = cleanHeaders(request.headers, target.host);
        const lines = [`${request.method} ${target.pathname}${target.search} HTTP/${request.httpVersion}`];
        for (const [key, value] of Object.entries(headers))
          lines.push(`${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
        upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on("error", () => clientSocket.destroy());
    } catch {
      clientSocket.destroy();
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8080);
  createProxyServer().listen(port, "0.0.0.0", () =>
    console.log(`egress proxy listening on ${port}`),
  );
}
