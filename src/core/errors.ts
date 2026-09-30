export type ErrorCode =
  | "VALIDATION_ERROR"
  | "ZERO_FLOW"
  | "NON_POSITIVE_CP"
  | "INVALID_TEMPERATURE_SPREAD"
  | "PHASE_CHANGE_UNSUPPORTED"
  | "NON_POSITIVE_U"
  | "NEGATIVE_FOULING"
  | "NEGATIVE_AREA"
  | "LOCAL_HEAT_FLOW_VIOLATION"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "BAD_REQUEST"
  | "CONFLICT";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.httpStatus =
      code === "NOT_FOUND"
        ? 404
        : code === "VERSION_CONFLICT" ||
            code === "IDEMPOTENCY_CONFLICT" ||
            code === "CONFLICT"
          ? 409
          : 400;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
