import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { id } from "./ids";
import { config } from "./config";
import { AppError } from "./errors";

export type Role = "admin" | "computer_reviewer" | "math_reviewer";
const COOKIE = "accesscheck_session";
const REVIEWER_COOKIE = "accesscheck_reviewer_session";
const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const sign = (value: string) =>
  crypto.createHmac("sha256", config.SESSION_SECRET).update(value).digest("base64url");
const cookieValue = (value: string) => `${value}.${sign(value)}`;
const passwordHash = (password: string, salt = crypto.randomBytes(16).toString("hex")) =>
  `${salt}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
const passwordMatches = (password: string, stored: string) => {
  const [salt, hash] = stored.split(":");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), crypto.scryptSync(password, salt, 32));
};

export function createUser(username: string, password: string, role: Role) {
  const now = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO users(id,username,role,password_hash,created_at) VALUES (?,?,?,?,?)")
    .run(id("usr"), username, role, passwordHash(password), now);
}

export function login(username: string, password: string) {
  const user = getDb()
    .prepare("SELECT id,username,role,password_hash FROM users WHERE username=? AND active=1")
    .get(username) as any;
  if (!user || !passwordMatches(password, user.password_hash))
    throw new AppError("INVALID_LOGIN", "用户名或密码错误", 401);
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const rawCsrf = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  getDb()
    .prepare(
      "INSERT INTO sessions(id,user_id,token_hash,csrf_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)",
    )
    .run(
      id("ses"),
      user.id,
      digest(rawToken),
      digest(rawCsrf),
      expires.toISOString(),
      now.toISOString(),
    );
  return {
    rawToken: cookieValue(rawToken),
    rawCsrf,
    user: { id: user.id, username: user.username, role: user.role as Role },
    expires,
    cookieName: COOKIE,
  };
}

function constantTimeTokenMatches(token: string, expected: string | undefined) {
  if (!expected) return false;
  const actualBytes = Buffer.from(token);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function loginWithToken(role: Role, token: string) {
  const expected =
    role === "admin"
      ? config.SCAN_ADMIN_TOKEN
      : role === "computer_reviewer"
        ? (config.COMPUTER_REVIEW_TOKEN ?? config.COMPUTER_REVIEWER_TOKEN)
        : (config.MATH_REVIEW_TOKEN ?? config.MATH_REVIEWER_TOKEN);
  if (!constantTimeTokenMatches(token, expected))
    throw new AppError("INVALID_LOGIN", "登录口令错误", 401);
  let user = getDb()
    .prepare("SELECT id,username,role FROM users WHERE role=? AND active=1 LIMIT 1")
    .get(role) as any;
  if (!user) {
    const now = new Date().toISOString();
    const generatedPassword = passwordHash(crypto.randomBytes(32).toString("base64url"));
    const userId = id("usr");
    getDb()
      .prepare("INSERT INTO users(id,username,role,password_hash,created_at) VALUES (?,?,?,?,?)")
      .run(userId, `${role}_service`, role, generatedPassword, now);
    user = { id: userId, username: `${role}_service`, role };
  }
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const rawCsrf = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  getDb()
    .prepare(
      "INSERT INTO sessions(id,user_id,token_hash,csrf_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)",
    )
    .run(
      id("ses"),
      user.id,
      digest(rawToken),
      digest(rawCsrf),
      expires.toISOString(),
      now.toISOString(),
    );
  return {
    rawToken: cookieValue(rawToken),
    rawCsrf,
    user: { id: user.id, username: user.username, role: user.role as Role },
    expires,
    cookieName: role === "admin" ? COOKIE : REVIEWER_COOKIE,
  };
}

export async function currentSession() {
  const jar = await cookies();
  const signed = jar.get(REVIEWER_COOKIE)?.value ?? jar.get(COOKIE)?.value;
  if (!signed) return null;
  const [raw, signature] = signed.split(".");
  if (!raw || !signature || !constantTimeTokenMatches(signature, sign(raw))) return null;
  const session = getDb()
    .prepare(
      "SELECT s.id,s.csrf_hash,s.expires_at,u.id user_id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.active=1",
    )
    .get(digest(raw)) as any;
  if (!session || new Date(session.expires_at) <= new Date()) return null;
  return {
    id: session.id,
    csrfHash: session.csrf_hash,
    expiresAt: session.expires_at,
    user: { id: session.user_id, username: session.username, role: session.role as Role },
  };
}

export async function currentCsrfToken(session: { csrfHash: string; user: { role: Role } }) {
  const jar = await cookies();
  const cookieName =
    session.user.role === "admin" ? "accesscheck_csrf" : "accesscheck_reviewer_csrf";
  const token = jar.get(cookieName)?.value;
  return token && csrfMatches(session, token) ? token : null;
}

export async function requireRole(...roles: Role[]) {
  const session = await currentSession();
  if (!session) throw new AppError("UNAUTHORIZED", "请先登录", 401);
  if (!roles.includes(session.user.role)) throw new AppError("FORBIDDEN", "当前角色没有权限", 403);
  return session;
}

export function csrfMatches(session: { csrfHash: string }, token: string | null | undefined) {
  return Boolean(token) && digest(token!) === session.csrfHash;
}
export function reviewerReauthMatches(
  role: "computer_reviewer" | "math_reviewer",
  token: string | null | undefined,
) {
  const expected =
    role === "computer_reviewer"
      ? (config.COMPUTER_REVIEW_TOKEN ?? config.COMPUTER_REVIEWER_TOKEN)
      : (config.MATH_REVIEW_TOKEN ?? config.MATH_REVIEWER_TOKEN);
  return Boolean(
    token && expected && token.length <= 1024 && constantTimeTokenMatches(token, expected),
  );
}
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(config.APP_BASE_URL).origin;
  } catch {
    return false;
  }
}
export const sessionCookieName = COOKIE;
export const reviewerSessionCookieName = REVIEWER_COOKIE;
