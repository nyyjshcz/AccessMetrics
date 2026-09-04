import dns from "node:dns/promises";
import net from "node:net";
import { AppError } from "./errors";
import { config } from "./config";

export interface NetworkPolicy {
  lookupAll(host: string): Promise<string[]>;
  /** Test-only escape hatch. Production policy leaves this unset/false. */
  allowPrivateAddresses?: boolean;
}

type DohAnswer = { type?: number; data?: string; TTL?: number };
type DohResponse = { Status?: number; Answer?: DohAnswer[] };
type ProxyResolution = { addresses?: unknown };

const MAX_RESOLUTION_ATTEMPTS = 3;
const RESOLUTION_RETRY_DELAY_MS = 150;
const TRANSIENT_RESOLVER_CODES = new Set([
  "EAI_AGAIN",
  "ETIMEOUT",
  "TEMPORARY_RESOLVER_UNAVAILABLE",
]);
const WORKER_RESOLVER_TIMEOUT_MS = 5000;

function isTransientResolverError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("code" in error &&
      typeof error.code === "string" &&
      TRANSIENT_RESOLVER_CODES.has(error.code)) ||
      ("name" in error && error.name === "TimeoutError"))
  );
}

function parseIpv6Words(address: string): number[] | null {
  let value = address.toLowerCase();
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

const dohCache = new Map<string, { addresses: string[]; expiresAt: number }>();

export function parseDohAnswers(payload: DohResponse, recordType: 1 | 28) {
  const typedAnswers = (payload.Answer ?? [])
    .filter((answer) => answer.type === recordType && typeof answer.data === "string")
    .map((answer) => ({ ...answer, data: answer.data!.trim() }))
    .filter((answer) => net.isIP(answer.data) !== 0);
  const addresses = typedAnswers.map((answer) => answer.data);
  const ttlSeconds = typedAnswers
    .filter((answer) => Number.isFinite(answer.TTL))
    .map((answer) => Math.max(1, Number(answer.TTL)))
    .sort((a, b) => a - b)[0];
  return { addresses, ttlMs: (ttlSeconds ?? 60) * 1000 };
}

async function queryDoh(hostname: string, recordType: 1 | 28) {
  const endpoint = config.DNS_OVER_HTTPS_URL;
  if (!endpoint) throw new Error("DNS_OVER_HTTPS_URL is not configured");
  const url = new URL(endpoint);
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", recordType === 1 ? "A" : "AAAA");
  const response = await fetch(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(WORKER_RESOLVER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`DoH request failed: ${response.status}`);
  const payload = (await response.json()) as DohResponse;
  if (payload.Status !== undefined && payload.Status !== 0) return { addresses: [], ttlMs: 60_000 };
  return parseDohAnswers(payload, recordType);
}

async function dohLookupAll(hostname: string) {
  const cached = dohCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.addresses;
  const answers = await Promise.all([queryDoh(hostname, 1), queryDoh(hostname, 28)]);
  const addresses = [...new Set(answers.flatMap((answer) => answer.addresses))];
  if (addresses.length === 0) throw new Error("DoH returned no address");
  dohCache.set(hostname, {
    addresses,
    expiresAt: Date.now() + Math.min(...answers.map((answer) => answer.ttlMs)),
  });
  return addresses;
}

export function parseProxyResolution(payload: ProxyResolution) {
  if (!Array.isArray(payload.addresses)) return [];
  return payload.addresses.filter(
    (address): address is string => typeof address === "string" && net.isIP(address) !== 0,
  );
}

const proxyLookupAll = async (hostname: string) => {
  if (!config.EGRESS_PROXY_URL) throw new Error("EGRESS_PROXY_URL is not configured");
  const endpoint = new URL("/resolve", config.EGRESS_PROXY_URL);
  endpoint.searchParams.set("name", hostname);
  try {
    const response = await fetch(endpoint, {
      redirect: "error",
      signal: AbortSignal.timeout(WORKER_RESOLVER_TIMEOUT_MS),
    });
    if (response.status === 503) {
      const error = new Error("proxy resolver temporarily unavailable");
      error.name = "TemporaryResolverError";
      Object.assign(error, { code: "TEMPORARY_RESOLVER_UNAVAILABLE" });
      throw error;
    }
    if (!response.ok) throw new Error(`proxy resolver failed: ${response.status}`);
    const addresses = parseProxyResolution((await response.json()) as ProxyResolution);
    if (addresses.length === 0) throw new Error("proxy resolver returned no address");
    return addresses;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "TimeoutError"
    ) {
      console.warn(JSON.stringify({
        event: "resolver_timeout",
        resolver: "egress_proxy",
        timeoutMs: WORKER_RESOLVER_TIMEOUT_MS,
      }));
      const timeoutError = new Error("proxy resolver timed out");
      timeoutError.name = "TemporaryResolverError";
      Object.assign(timeoutError, { code: "TEMPORARY_RESOLVER_UNAVAILABLE" });
      throw timeoutError;
    }
    throw error;
  }
};

const systemLookupAll = async (host: string) =>
  (await dns.lookup(host, { all: true })).map((item) => item.address);
const defaultPolicy: NetworkPolicy = {
  lookupAll:
    config.DNS_RESOLVER_MODE === "doh"
      ? dohLookupAll
      : config.DNS_RESOLVER_MODE === "proxy"
        ? proxyLookupAll
        : systemLookupAll,
  allowPrivateAddresses:
    config.APP_ENV === "test" && process.env.SCAN_TEST_ALLOW_PRIVATE_ADDRESSES === "1",
};

export function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^[[]|[]]$/g, "");
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized === "::"
  )
    return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0) ||
      (a === 198 && b >= 18 && b <= 19) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0 && Number(address.split(".")[2]) === 113) ||
      a >= 224
    );
  }
  if (net.isIPv6(address)) {
    if (
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fec0:") ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:")
    )
      return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return isPrivateIp(mapped);
    const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      return isPrivateIp([high >>> 8, high & 255, low >>> 8, low & 255].join("."));
    }
    // IPv4-compatible IPv6 (::/96) can encode an IPv4 address either in
    // dotted-decimal or hexadecimal form. Normalize the embedded address so
    // loopback, private, link-local, and other forbidden IPv4 ranges cannot
    // bypass the same policy applied to ordinary IPv4 results.
    const compatibleDotted = normalized.match(/^::(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (compatibleDotted) return isPrivateIp(compatibleDotted);
    const words = parseIpv6Words(normalized);
    if (words?.slice(0, 6).every((word) => word === 0)) {
      const high = words[6];
      const low = words[7];
      return isPrivateIp([high >>> 8, high & 255, low >>> 8, low & 255].join("."));
    }
    return false;
  }
  // Node's URL parser accepts decimal/hex/octal IPv4 spellings. Normalize those
  // spellings before the DNS policy is consulted so they cannot bypass checks.
  if (/^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/.test(normalized)) {
    const number = normalized.startsWith("0x")
      ? Number.parseInt(normalized, 16)
      : normalized.length > 1 && normalized.startsWith("0") && !/[89]/.test(normalized)
        ? Number.parseInt(normalized, 8)
        : Number(normalized);
    if (Number.isSafeInteger(number) && number >= 0 && number <= 0xffffffff)
      return isPrivateIp(
        [number >>> 24, (number >>> 16) & 255, (number >>> 8) & 255, number & 255].join("."),
      );
  }
  return false;
}

export async function validateTargetUrl(
  raw: string,
  policy: NetworkPolicy = defaultPolicy,
): Promise<URL> {
  if (raw.length === 0 || raw.length > 2048)
    throw new AppError("INVALID_URL", "URL 长度必须为 1 到 2048 个字符", 422);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("INVALID_URL", "URL 格式无效", 422);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new AppError("URL_NOT_ALLOWED", "只允许不带凭据的 HTTP/HTTPS URL", 422);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  )
    throw new AppError("PRIVATE_TARGET", "目标地址是本机或云元数据地址", 422);
  // Check numeric/hex/octal IPv4 spellings before DNS lookup. URL parsers and
  // resolvers do not behave consistently for these aliases, so relying only
  // on the returned DNS address would leave a rebinding/normalization gap.
  if (!policy.allowPrivateAddresses && isPrivateIp(hostname))
    throw new AppError("PRIVATE_TARGET", "目标地址是本机或云元数据地址", 422);
  let addresses: string[];
  for (let attempt = 1; ; attempt += 1) {
    try {
      addresses = await policy.lookupAll(hostname);
      break;
    } catch (error) {
      if (!isTransientResolverError(error) || attempt >= MAX_RESOLUTION_ATTEMPTS)
        throw new AppError("DNS_LOOKUP_FAILED", "目标域名无法解析", 422);
      await new Promise((resolve) =>
        setTimeout(resolve, RESOLUTION_RETRY_DELAY_MS * 2 ** (attempt - 1)),
      );
    }
  }
  if (addresses.length === 0 || (!policy.allowPrivateAddresses && addresses.some(isPrivateIp)))
    throw new AppError("PRIVATE_TARGET", "目标地址解析到禁止的内网或本机地址", 422);
  url.hash = "";
  return url;
}

export function canonicalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.search = [...url.searchParams.entries()]
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
