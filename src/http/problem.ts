export type ProblemCode =
  | "bad_request"
  | "conflict"
  | "forbidden"
  | "internal_error"
  | "not_found"
  | "rate_limited"
  | "request_too_large"
  | "service_unavailable"
  | "unauthorized";

export class HttpProblem extends Error {
  readonly code: ProblemCode;
  readonly status: number;

  constructor(status: number, code: ProblemCode, message: string) {
    super(message);
    this.name = "HttpProblem";
    this.status = status;
    this.code = code;
  }
}

export function isUniqueConstraintError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (/UNIQUE constraint failed|SQLITE_CONSTRAINT(?:_UNIQUE)?/i.test(current.message)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}
