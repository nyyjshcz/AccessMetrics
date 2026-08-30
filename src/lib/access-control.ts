import crypto from "node:crypto";
import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "@/lib/config";
import { AppError } from "@/lib/errors";

export const ACCESS_SESSION_COOKIE = "accesscheck_session";
const SESSION_VERSION = "v1";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type AccessRole = "admin" | "visitor";
type RequiredRole = AccessRole;

function configuredKey(role: AccessRole) {
  return role === "admin" ? config.ADMIN_ACCESS_KEY : config.VISITOR_ACCESS_KEY;
}

export function accessControlConfigured() {
  return Boolean(config.ADMIN_ACCESS_KEY && config.VISITOR_ACCESS_KEY);
}

function accessConfigurationError() {
  return new AppError(
    "ACCESS_CONTROL_NOT_CONFIGURED",
    "服务器尚未配置管理员和访客访问密钥",
    503,
  );
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

function signingKey(role: AccessRole) {
  const accessKey = configuredKey(role);
  if (!accessKey) throw accessConfigurationError();
  return crypto
    .createHash("sha256")
    .update(config.SESSION_SECRET)
    .update("\u0000accesscheck-session\u0000")
    .update(role)
    .update("\u0000")
    .update(accessKey)
    .digest();
}

function sign(role: AccessRole, payload: string) {
  return crypto.createHmac("sha256", signingKey(role)).update(payload).digest("base64url");
}

function validRole(value: string): value is AccessRole {
  return value === "admin" || value === "visitor";
}

export function roleCanAccess(role: AccessRole, required: RequiredRole) {
  return role === "admin" || required === "visitor";
}

export function authenticateAccessKey(accessKey: string): AccessRole {
  requireAccessConfiguration();
  if (constantTimeMatch(accessKey, config.ADMIN_ACCESS_KEY!)) return "admin";
  if (constantTimeMatch(accessKey, config.VISITOR_ACCESS_KEY!)) return "visitor";
  throw new AppError("ACCESS_KEY_INVALID", "访问密钥不正确", 401);
}

export function createAccessSession(role: AccessRole) {
  requireAccessConfiguration();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const nonce = crypto.randomBytes(18).toString("base64url");
  const payload = [SESSION_VERSION, role, String(expiresAt), nonce].join(".");
  return `${payload}.${sign(role, payload)}`;
}

export function verifyAccessSession(value: string | undefined | null): AccessRole | null {
  if (!value || !accessControlConfigured()) return null;
  const parts = value.split(".");
  if (parts.length !== 5) return null;
  const [version, rawRole, rawExpiresAt, nonce, signature] = parts;
  if (version !== SESSION_VERSION || !validRole(rawRole) || !/^[A-Za-z0-9_-]{16,}$/.test(nonce))
    return null;
  const expiresAt = Number(rawExpiresAt);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const payload = [version, rawRole, rawExpiresAt, nonce].join(".");
  const expected = sign(rawRole, payload);
  return constantTimeMatch(signature, expected) ? rawRole : null;
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
    redirect((`/login?next=${encodeURIComponent(safeNextPath(nextPath))}`) as Route);
  }
  if (!roleCanAccess(role, required)) {
    redirect((role === "visitor" ? "/reports" : "/") as Route);
  }
  return role;
}

export function loginRedirectPath(value: unknown, role: AccessRole) {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    if (role === "admin" || value === "/reports" || value.startsWith("/reports?")) return value;
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
