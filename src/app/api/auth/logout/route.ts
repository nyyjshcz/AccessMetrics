import { NextResponse } from "next/server";
import { reviewerSessionCookieName, sessionCookieName } from "@/lib/auth";
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(sessionCookieName);
  response.cookies.delete("accesscheck_csrf");
  response.cookies.delete(reviewerSessionCookieName);
  response.cookies.delete("accesscheck_reviewer_csrf");
  return response;
}
