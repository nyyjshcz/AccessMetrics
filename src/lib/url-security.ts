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
    signal: AbortSignal.timeout(5000),
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

const systemLookupAll = async (host: string) =>
  (await dns.lookup(host, { all: true })).map((item) => item.address);
const defaultPolicy: NetworkPolicy = {
  lookupAll: config.DNS_RESOLVER_MODE === "doh" ? dohLookupAll : systemLookupAll,
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
    return mapped ? isPrivateIp(mapped) : false;
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
  try {
    addresses = await policy.lookupAll(hostname);
  } catch {
    throw new AppError("DNS_LOOKUP_FAILED", "目标域名无法解析", 422);
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
