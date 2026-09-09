import crypto from "node:crypto";
import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMISSIONS_ACCESS_KEY_PATTERN, config, normalizeAdmissionsAccessKey } from "@/lib/config";
import { AppError } from "@/lib/errors";

export const ACCESS_SESSION_COOKIE = "accesscheck_session";
const SESSION_VERSION = "v2";
const LEGACY_SESSION_VERSION = "v1";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type AccessRole = "admin" | "visitor";
export type AccessCredentialSource = AccessRole | "admissions";
export type AccessCredential = { role: AccessRole; source: AccessCredentialSource };
type RequiredRole = AccessRole;

function configuredKey(source: AccessCredentialSource) {
  if (source === "admin") return config.ADMIN_ACCESS_KEY;
  if (source === "visitor") return config.VISITOR_ACCESS_KEY;
  return config.ADMISSIONS_ACCESS_KEY;
}

export function accessControlConfigured() {
  return Boolean(config.ADMIN_ACCESS_KEY && config.VISITOR_ACCESS_KEY);
}

function accessConfigurationError() {
  return new AppError("ACCESS_CONTROL_NOT_CONFIGURED", "服务器尚未配置管理员和访客访问密钥", 503);
}

function requireAccessConfiguration() {
  if (!accessControlConfigured()) throw accessConfigurationError();
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest();
}

function constantTimeMatch(left: string, right: string) {
  return crypto.timingSafeEqual(hash(left), hash(right));
}

function signingKey(source: AccessCredentialSource) {
  const accessKey = configuredKey(source);
  if (!accessKey) throw accessConfigurationError();
  return crypto
    .createHash("sha256")
    .update(config.SESSION_SECRET)
    .update("\u0000accesscheck-session\u0000")
    .update(source)
    .update("\u0000")
    .update(accessKey)
    .digest();
}

function sign(source: AccessCredentialSource, payload: string) {
  return crypto.createHmac("sha256", signingKey(source)).update(payload).digest("base64url");
}

function validRole(value: string): value is AccessRole {
  return value === "admin" || value === "visitor";
}

function validCredentialSource(value: string): value is AccessCredentialSource {
  return validRole(value) || value === "admissions";
}

function accessRoleForSource(source: AccessCredentialSource): AccessRole {
  return source === "visitor" ? "visitor" : "admin";
}

export function roleCanAccess(role: AccessRole, required: RequiredRole) {
  return role === "admin" || required === "visitor";
}

export function isAdmissionsAccessKeyCandidate(accessKey: string) {
  return ADMISSIONS_ACCESS_KEY_PATTERN.test(normalizeAdmissionsAccessKey(accessKey));
}

export function authenticateAccessCredential(accessKey: string): AccessCredential {
  requireAccessConfiguration();
  if (constantTimeMatch(accessKey, config.ADMIN_ACCESS_KEY!))
    return { role: "admin", source: "admin" };
  if (constantTimeMatch(accessKey, config.VISITOR_ACCESS_KEY!))
    return { role: "visitor", source: "visitor" };
  if (
    config.ADMISSIONS_ACCESS_KEY &&
    isAdmissionsAccessKeyCandidate(accessKey) &&
    constantTimeMatch(normalizeAdmissionsAccessKey(accessKey), config.ADMISSIONS_ACCESS_KEY)
  )
    return { role: "admin", source: "admissions" };
  throw new AppError("ACCESS_KEY_INVALID", "访问密钥不正确", 401);
}

export function authenticateAccessKey(accessKey: string): AccessRole {
  return authenticateAccessCredential(accessKey).role;
}

export function createAccessSession(credential: AccessCredential | AccessRole) {
  requireAccessConfiguration();
  const resolved =
    typeof credential === "string" ? { role: credential, source: credential } : credential;
  if (accessRoleForSource(resolved.source) !== resolved.role)
    throw new Error("access credential source does not match its role");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const nonce = crypto.randomBytes(18).toString("base64url");
  const payload = [SESSION_VERSION, resolved.role, resolved.source, String(expiresAt), nonce].join(
    ".",
  );
  return `${payload}.${sign(resolved.source, payload)}`;
}

function validSessionLifetime(rawExpiresAt: string, nonce: string) {
  if (!/^[A-Za-z0-9_-]{16,}$/.test(nonce)) return false;
  const expiresAt = Number(rawExpiresAt);
  return Number.isSafeInteger(expiresAt) && expiresAt > Math.floor(Date.now() / 1000);
}

function verifyV1AccessSession(parts: string[]): AccessRole | null {
  if (parts.length !== 5) return null;
  const [version, rawRole, rawExpiresAt, nonce, signature] = parts;
  if (
    version !== LEGACY_SESSION_VERSION ||
    !validRole(rawRole) ||
    !validSessionLifetime(rawExpiresAt, nonce)
  )
    return null;
  const payload = [version, rawRole, rawExpiresAt, nonce].join(".");
  const expected = sign(rawRole, payload);
  return constantTimeMatch(signature, expected) ? rawRole : null;
}

function verifyV2AccessSession(parts: string[]): AccessRole | null {
  if (parts.length !== 6) return null;
  const [version, rawRole, rawSource, rawExpiresAt, nonce, signature] = parts;
  if (
    version !== SESSION_VERSION ||
    !validRole(rawRole) ||
    !validCredentialSource(rawSource) ||
    accessRoleForSource(rawSource) !== rawRole ||
    !validSessionLifetime(rawExpiresAt, nonce)
  )
    return null;
  if (rawSource === "admissions" && !config.ADMISSIONS_ACCESS_KEY) return null;
  const payload = [version, rawRole, rawSource, rawExpiresAt, nonce].join(".");
  const expected = sign(rawSource, payload);
  return constantTimeMatch(signature, expected) ? rawRole : null;
}

export function verifyAccessSession(value: string | undefined | null): AccessRole | null {
  if (!value || !accessControlConfigured()) return null;
  const parts = value.split(".");
  if (parts[0] === LEGACY_SESSION_VERSION) return verifyV1AccessSession(parts);
  if (parts[0] === SESSION_VERSION) return verifyV2AccessSession(parts);
  return null;
}

function sessionFromCookieHeader(header: string | null) {
  if (!header) return null;
  const prefix = `${ACCESS_SESSION_COOKIE}=`;
  const value = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  return verifyAccessSession(value);
}

export function requireRequestRole(request: Request, required: RequiredRole): AccessRole {
  // Existing route unit tests do not provide browser sessions. Keep that
  // isolated test harness behavior explicit; deployed and development apps
  // always require configured keys and a signed cookie.
  if (!accessControlConfigured() && config.APP_ENV === "test") return "admin";
  const role = sessionFromCookieHeader(request.headers.get("cookie"));
  if (!role) throw new AppError("ACCESS_AUTH_REQUIRED", "请先输入访问密钥", 401);
  if (!roleCanAccess(role, required))
    throw new AppError("ACCESS_FORBIDDEN", "当前访问密钥没有此操作权限", 403);
  return role;
}

export async function getPageRole() {
  const cookieStore = await cookies();
  return verifyAccessSession(cookieStore.get(ACCESS_SESSION_COOKIE)?.value);
}

function safeNextPath(pathname: string) {
  return pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : "/";
}

export async function requirePageRole(required: RequiredRole, nextPath: string) {
  const role = await getPageRole();
  if (!role) {
    redirect(`/login?next=${encodeURIComponent(safeNextPath(nextPath))}` as Route);
  }
  if (!roleCanAccess(role, required)) {
    redirect((role === "visitor" ? "/reports" : "/") as Route);
  }
  return role;
}

export function loginRedirectPath(value: unknown, role: AccessRole) {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    if (
      role === "admin" ||
      value === "/reports" ||
      value.startsWith("/reports?") ||
      value === "/team" ||
      value.startsWith("/team?")
    )
      return value;
  }
  return role === "admin" ? "/" : "/reports";
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config.APP_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
