export type ErrorContext = Record<string, unknown>;

/**
 * Base application error carrying a stable code and optional safe context.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly context?: ErrorContext;

  constructor(
    message: string,
    code: string,
    statusCode = 500,
    context?: ErrorContext
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
  }
}

/**
 * Error raised when external input fails validation.
 */
export class ValidationError extends AppError {
  constructor(message: string, context?: ErrorContext) {
    super(message, "VALIDATION_ERROR", 400, context);
    this.name = "ValidationError";
  }
}

/**
 * Error raised when authentication or authorization fails.
 */
export class AuthError extends AppError {
  constructor(message: string, context?: ErrorContext) {
    super(message, "AUTH_ERROR", 401, context);
    this.name = "AuthError";
  }
}

/**
 * Error raised when a requested resource cannot be found.
 */
export class NotFoundError extends AppError {
  constructor(resource: string, context?: ErrorContext) {
    super(`${resource} not found`, "NOT_FOUND", 404, context);
    this.name = "NotFoundError";
  }
}

/**
 * Error raised when a rate limit is exceeded.
 */
export class RateLimitError extends AppError {
  constructor(context?: ErrorContext) {
    super("Rate limit exceeded", "RATE_LIMIT", 429, context);
    this.name = "RateLimitError";
  }
}

/**
 * Error raised when an upstream provider fails or returns invalid data.
 */
export class ExternalAPIError extends AppError {
  constructor(provider: string, message: string, context?: ErrorContext) {
    super(`[${provider}] ${message}`, "EXTERNAL_API_ERROR", 502, context);
    this.name = "ExternalAPIError";
  }
}
