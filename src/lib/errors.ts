import crypto from "node:crypto";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorEnvelope(error: unknown, requestId = crypto.randomUUID()) {
  if (error instanceof AppError) {
    return {
      error: { code: error.code, message: error.message, details: error.details, requestId },
    };
  }
  return { error: { code: "INTERNAL_ERROR", message: "服务器内部错误", requestId } };
}
