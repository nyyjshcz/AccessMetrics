import { NextResponse } from "next/server";
import crypto from "node:crypto";

export async function POST(request: Request) {
  void request;
  return NextResponse.json(
    {
      error: {
        code: "AUTH_ROUTE_DEPRECATED",
        message: "请分别使用 /api/admin/login 或 /api/reviewer/login",
        requestId: crypto.randomUUID(),
      },
    },
    { status: 410 },
  );
}
