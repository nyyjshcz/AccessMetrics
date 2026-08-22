import { NextResponse } from "next/server";
import { POST as submitAdHoc } from "@/app/api/reviews/ad-hoc/route";
import { AppError, errorEnvelope } from "@/lib/errors";

export async function POST(request: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "审核请求必须是对象", 422);
    if ("resultNodeId" in body) throw new AppError("UNKNOWN_FIELD", "节点 ID 必须来自 URL", 400);
    const { nodeId } = await context.params;
    return submitAdHoc(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify({ ...body, resultNodeId: nodeId }),
      }),
    );
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
