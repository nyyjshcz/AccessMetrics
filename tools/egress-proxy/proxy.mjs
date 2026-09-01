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

function ipv6Words(address) {
  const normalized = address.toLowerCase();
  if (normalized.includes("%")) return null;
  let value = normalized;
  if (value.includes(".")) {
    const separator = value.lastIndexOf(":");
    if (separator < 0) return null;
    const octets = value
      .slice(separator + 1)
      .split(".")
      .map(Number);
    if (
      octets.length !== 4 ||
      octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    )
      return null;
    value = `${value.slice(0, separator)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16)),
  ];
}

function ipv6Forbidden(address) {
  const words = ipv6Words(address);
  if (!words) return true;
  const allZero = words.every((word) => word === 0);
  const loopback = allZero || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1);
  if (loopback) return true;
  const first = words[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // deprecated site-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (words[0] === 0x2001 && words[1] === 0x0db8) return true; // documentation
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    // Keep IPv4-mapped IPv6 out of the production dialer entirely. Accepting
    // a public mapped address would still allow a different address family to
    // bypass the policy's explicit IPv4/IPv6 boundary.
    return true;
  }
  return false;
}

export function isForbiddenAddress(address) {
  const kind = net.isIP(address);
  return kind === 4 ? ipv4Forbidden(address) : kind === 6 ? ipv6Forbidden(address) : true;
}

export class DestinationPolicy {
  constructor({
    lookupAll = (hostname) => dns.lookup(hostname, { all: true, verbatim: true }),
  } = {}) {
    this.lookupAll = lookupAll;
  }

  async lookup(hostname) {
    const host = normalizeHost(hostname);
    if (METADATA_HOSTS.has(host)) throw new Error("metadata destination not allowed");
    const entries = net.isIP(host) ? [{ address: host }] : await this.lookupAll(host);
    const addresses = entries
      .map((entry) => (typeof entry === "string" ? entry : entry.address))
      .filter((address) => typeof address === "string" && net.isIP(address) !== 0);
    if (!addresses.length || addresses.some((address) => isForbiddenAddress(address)))
      throw new Error("private destination not allowed");
    return { host, addresses: [...new Set(addresses)] };
  }

  async resolve(hostname, port) {
    if (!ALLOWED_PORTS.has(Number(port))) throw new Error("port not allowed");
    const resolved = await this.lookup(hostname);
    // The chosen address is returned to the caller and used by the dialer;
    // the original hostname is never passed to a downstream socket resolver.
    return { host: resolved.host, port: Number(port), address: resolved.addresses[0] };
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
      const requestUrl = new URL(request.url ?? "/", "http://egress-proxy.internal");
      if (request.method === "GET" && requestUrl.pathname === "/resolve") {
        const hostname = requestUrl.searchParams.get("name");
        if (!hostname) throw new Error("resolver name is required");
        const resolved = await policy.lookup(hostname);
        response.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify({ addresses: resolved.addresses }));
        return;
      }
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
      const upstream = net.connect({
        host: resolved.address,
        port,
        family: net.isIP(resolved.address),
      });
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
      const upstream = net.connect({
        host: resolved.address,
        port,
        family: net.isIP(resolved.address),
      });
      upstream.once("connect", () => {
        const headers = cleanHeaders(request.headers, target.host);
        const lines = [
          `${request.method} ${target.pathname}${target.search} HTTP/${request.httpVersion}`,
        ];
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
