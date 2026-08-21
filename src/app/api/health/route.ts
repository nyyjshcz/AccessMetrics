import { NextResponse } from "next/server";
import { migrate, getDb } from "@/lib/db";
import { assertPrivateEvidenceRoot, assertProductionSecrets } from "@/lib/config";
export async function GET() {
  try {
    migrate();
    assertPrivateEvidenceRoot();
    assertProductionSecrets();
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
