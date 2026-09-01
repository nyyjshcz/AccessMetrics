import crypto from "node:crypto";
import { DEFAULT_LOCALE, LOCALE_COOKIE, Locale, resolveLocale } from "./i18n";

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

const catalog: Record<string, { "zh-CN": string; en: string }> = {
  ACCESS_AUTH_REQUIRED: { "zh-CN": "请先输入访问密钥", en: "Enter an access key first" },
  ACCESS_FORBIDDEN: {
    "zh-CN": "当前访问密钥没有此操作权限",
    en: "This access key is not permitted",
  },
  ACCESS_KEY_INVALID: { "zh-CN": "访问密钥不正确", en: "The access key is incorrect" },
  ACCESS_LOGIN_INVALID: { "zh-CN": "请输入有效的访问密钥", en: "Enter a valid access key" },
  ACCESS_LOGIN_RATE_LIMITED: {
    "zh-CN": "尝试次数过多，请稍后再试",
    en: "Too many attempts; try again later",
  },
  AI_BATCH_ALREADY_ACTIVE: {
    "zh-CN": "当前扫描已有正在运行的 AI 批次",
    en: "This scan already has an active AI batch",
  },
  AI_BATCH_NOT_FOUND: { "zh-CN": "AI 批次不存在", en: "AI batch not found" },
  AI_BATCH_RETRY_REQUIRED: {
    "zh-CN": "失败的批次必须先重试失败项",
    en: "Retry the failed items in the batch before continuing",
  },
  AI_BATCH_SCOPE_INVALID: { "zh-CN": "AI 批处理范围无效", en: "The AI batch scope is invalid" },
  AI_NODE_NOT_FOUND: { "zh-CN": "AI 节点不存在", en: "AI node not found" },
  AI_NODE_NOT_INCOMPLETE: {
    "zh-CN": "AI 只能处理 axe 标记为 incomplete 的节点",
    en: "AI can only process nodes marked incomplete by axe",
  },
  AI_PROVIDER_DISABLED: { "zh-CN": "模型提供商已停用", en: "The model provider is disabled" },
  AI_PROVIDER_INPUT_INVALID: {
    "zh-CN": "提供商名称和模型名称必填",
    en: "Provider and model names are required",
  },
  AI_PROVIDER_NOT_FOUND: { "zh-CN": "模型提供商不存在", en: "Model provider not found" },
  AI_PROVIDER_RATE_LIMITED: {
    "zh-CN": "模型服务限流，等待后自动重试",
    en: "The model service is rate limited",
  },
  AI_PROVIDER_RATE_LIMIT_INVALID: {
    "zh-CN": "请求速率策略无效",
    en: "The request rate policy is invalid",
  },
  AI_PROVIDER_SECRET_INVALID: { "zh-CN": "模型 API Key 无效", en: "The model API key is invalid" },
  AI_PROVIDER_URL_CREDENTIALS: {
    "zh-CN": "模型地址不得包含用户名或密码",
    en: "The model URL must not contain credentials",
  },
  AI_PROVIDER_URL_INVALID: {
    "zh-CN": "模型 Base URL 不是有效 URL",
    en: "The model Base URL is invalid",
  },
  AI_PROVIDER_URL_TLS_REQUIRED: {
    "zh-CN": "非 localhost 模型地址必须使用 HTTPS",
    en: "Non-localhost model URLs must use HTTPS",
  },
  AI_RESPONSE_EMPTY: { "zh-CN": "模型返回内容为空", en: "The model returned empty content" },
  AI_RESPONSE_INVALID: {
    "zh-CN": "模型没有返回有效 JSON",
    en: "The model did not return valid JSON",
  },
  AI_REVIEW_ACTIVE: {
    "zh-CN": "AI 批处理运行期间不能修改人工结论（verdict）",
    en: "Manual verdicts cannot be changed while an AI batch is running",
  },
  AXE_TOP_LEVEL_FAILED: { "zh-CN": "顶层 axe 执行失败", en: "The top-level axe check failed" },
  DNS_LOOKUP_FAILED: { "zh-CN": "目标域名无法解析", en: "The target domain could not be resolved" },
  HTTP_ERROR: { "zh-CN": "目标页面返回 HTTP 错误", en: "The target page returned an HTTP error" },
  HTTP_FORBIDDEN: {
    "zh-CN": "目标页面拒绝访问，已跳过",
    en: "The target page denied access and was skipped",
  },
  HTTP_UNAUTHORIZED: {
    "zh-CN": "目标页面要求身份验证，已跳过",
    en: "The target page requires authentication and was skipped",
  },
  IDEMPOTENCY_CONFLICT: {
    "zh-CN": "同一请求键不能用于不同请求",
    en: "The same idempotency key cannot be used for different requests",
  },
  INCOMPLETE_NODE_NOT_FOUND: {
    "zh-CN": "axe 标记的 incomplete 节点不存在",
    en: "The incomplete node marked by axe was not found",
  },
  INVALID_INPUT: { "zh-CN": "请求内容无效", en: "The request body is invalid" },
  INVALID_PAGE_LIMIT: {
    "zh-CN": "maxPages 必须是 1 到 15 的整数",
    en: "maxPages must be an integer from 1 to 15",
  },
  INVALID_PAGINATION: { "zh-CN": "分页参数无效", en: "Pagination parameters are invalid" },
  INVALID_URL: { "zh-CN": "URL 格式无效", en: "The URL is invalid" },
  INVALID_VIEW: {
    "zh-CN": "view 必须是 active 或 published",
    en: "view must be active or published",
  },
  MANUAL_NOTE_INVALID: { "zh-CN": "备注必须是文本", en: "The note must be text" },
  MANUAL_VERDICT_INVALID: { "zh-CN": "人工结论无效", en: "The manual verdict is invalid" },
  NON_HTML: {
    "zh-CN": "目标响应不是 HTML/XHTML，未运行 axe",
    en: "The target response was not HTML/XHTML; axe was not run",
  },
  NOT_FOUND: { "zh-CN": "请求的资源不存在", en: "The requested resource was not found" },
  ORIGIN_MISMATCH: {
    "zh-CN": "请求来源与应用来源不一致",
    en: "The request origin does not match the application origin",
  },
  PACKAGE_NOT_FOUND: {
    "zh-CN": "公开包目录不存在",
    en: "The public package directory was not found",
  },
  PACKAGE_SYMLINK: { "zh-CN": "禁止符号链接", en: "Symbolic links are not allowed" },
  PAGE_LEASE_LOST: {
    "zh-CN": "页面租约已失效，拒绝写入结果",
    en: "The page lease expired; results were not written",
  },
  PRIVATE_TARGET: {
    "zh-CN": "目标地址是禁止访问的内网或本机地址",
    en: "The target is a private or local address",
  },
  RATE_LIMITED: { "zh-CN": "扫描创建请求过于频繁", en: "Scan creation is being rate limited" },
  RUN_NOT_COMPLETE: {
    "zh-CN": "扫描未完成，不能发布",
    en: "The scan is not complete and cannot be published",
  },
  RUN_NOT_FOUND: { "zh-CN": "扫描不存在", en: "Scan run not found" },
  RUN_NOT_PUBLISHED: { "zh-CN": "该扫描尚未发布", en: "The scan has not been published" },
  RUN_PUBLISH_CONFLICT: {
    "zh-CN": "扫描发布状态已改变，请刷新后重试",
    en: "The publish state changed; refresh and try again",
  },
  RUN_PUBLISHED_READ_ONLY: { "zh-CN": "已发布扫描为只读", en: "Published scans are read-only" },
  RUN_WITHDRAW_CONFLICT: {
    "zh-CN": "扫描发布状态已改变，请刷新后重试",
    en: "The publish state changed; refresh and try again",
  },
  SCAN_JOB_NOT_TERMINAL: {
    "zh-CN": "仅已结束的任务可以删除",
    en: "Only completed tasks can be deleted",
  },
  SCAN_SHARED_PAGE_REFERENCED: {
    "zh-CN": "任务页面仍被其他任务引用，不能删除",
    en: "Task pages are still referenced by other tasks",
  },
  SCAN_STUDY_REFERENCED: {
    "zh-CN": "研究记录引用了该扫描，不能删除",
    en: "A study still references this scan",
  },
  UNKNOWN_FIELD: { "zh-CN": "请求包含未定义字段", en: "The request contains an unknown field" },
  URL_NOT_ALLOWED: {
    "zh-CN": "只允许不带凭据的 HTTP/HTTPS URL",
    en: "Only credential-free HTTP/HTTPS URLs are allowed",
  },
  JOB_LEASE_LOST: { "zh-CN": "任务租约已失效", en: "The job lease expired" },
};

/** Return the stable, localized description for a stored application error code. */
export function localizedErrorMessage(code: unknown, locale: Locale): string | null {
  if (typeof code !== "string") return null;
  return catalog[code]?.[locale] ?? null;
}

export function localeFromRequest(request: Request): Locale {
  const url = new URL(request.url);
  const nextCookie = (
    request as Request & { cookies?: { get(name: string): { value: string } | undefined } }
  ).cookies?.get(LOCALE_COOKIE)?.value;
  const headerCookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);
  const cookie = nextCookie ?? headerCookie;
  return resolveLocale(url.searchParams.get("lang"), cookie);
}

export function errorEnvelope(error: unknown, requestOrId?: Request | string, locale?: Locale) {
  const requestId = typeof requestOrId === "string" ? requestOrId : crypto.randomUUID();
  const selected =
    locale ?? (requestOrId instanceof Request ? localeFromRequest(requestOrId) : DEFAULT_LOCALE);
  if (error instanceof AppError) {
    const message =
      catalog[error.code]?.[selected] ?? (selected === "en" ? "An error occurred" : "发生错误");
    return {
      error: {
        code: error.code,
        message,
        ...(error.details === undefined ? {} : { details: error.details }),
        requestId,
      },
    };
  }
  return {
    error: {
      code: "INTERNAL_ERROR",
      message: selected === "en" ? "Internal server error" : "服务器内部错误",
      requestId,
    },
  };
}
