import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
export async function GET() {
  const session = await currentSession();
  return NextResponse.json({ authenticated: Boolean(session), user: session?.user ?? null });
}
