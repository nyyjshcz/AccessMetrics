import { AppError } from "@/lib/errors";
import { config } from "@/lib/config";

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  try {
    if (new URL(origin).origin !== new URL(config.APP_BASE_URL).origin)
      throw new AppError("ORIGIN_MISMATCH", "请求来源与应用来源不一致", 403);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("ORIGIN_MISMATCH", "请求来源与应用来源不一致", 403);
  }
}
