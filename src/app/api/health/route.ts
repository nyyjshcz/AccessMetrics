import { NextResponse } from "next/server";
import { migrate, getDb } from "@/lib/db";
import { assertWebStartup } from "@/lib/startup";
export async function GET() {
  try {
    migrate();
    assertWebStartup();
    getDb().prepare("SELECT 1").get();
    return NextResponse.json({
      status: "ok",
      service: "accesscheck",
      time: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
