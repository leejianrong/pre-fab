export type ApiErrorCode = "validation_error" | "not_found" | "conflict" | "unauthorized" | "forbidden" | "rate_limited" | "internal";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

/**
 * The API's half of R13's exit-code contract: every rejection carries a
 * stable `code` the CLI maps straight onto its exit codes (1 user error,
 * 2 conflict, 3 auth, 4 upstream) with no string-matching on messages.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const notFound = (message: string) => new ApiError("not_found", message);
export const conflict = (message: string, details?: unknown) => new ApiError("conflict", message, details);
export const unauthorized = (message = "authentication required") => new ApiError("unauthorized", message);
export const forbidden = (message = "not allowed") => new ApiError("forbidden", message);
export const validationError = (message: string, details?: unknown) => new ApiError("validation_error", message, details);
export const rateLimited = (message = "too many requests") => new ApiError("rate_limited", message);
