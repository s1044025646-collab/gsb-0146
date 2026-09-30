/** Stable error codes returned by API and CLI. */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "ZERO_FLOW"
  | "NON_POSITIVE_CP"
  | "INVALID_DRIVING_TEMPERATURE"
  | "PHASE_CHANGE_UNSUPPORTED"
  | "NON_POSITIVE_U"
  | "NON_POSITIVE_AREA"
  | "NEGATIVE_FOULING"
  | "LOCAL_HEAT_FLOW_VIOLATION"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "CONFLICT"
  | "INVALID_ARRANGE"
  | "INVALID_PAGINATION";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}
