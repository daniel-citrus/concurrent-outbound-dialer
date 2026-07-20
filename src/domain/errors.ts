export type ErrorCode =
  | "SESSION_NOT_FOUND"
  | "CALL_ATTEMPT_NOT_FOUND"
  | "INVALID_SESSION_TRANSITION"
  | "DUPLICATE_ACTIVE_CLIENT_SESSION"
  | "INVALID_CONTACT_INPUT"
  | "PROVIDER_FAILURE"
  | "DATABASE_CONFLICT"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function sessionNotFound(sessionId: string): DomainError {
  return new DomainError("SESSION_NOT_FOUND", `Session ${sessionId} was not found.`, 404, {
    sessionId,
  });
}

export function callAttemptNotFound(callAttemptId: string): DomainError {
  return new DomainError(
    "CALL_ATTEMPT_NOT_FOUND",
    `Call attempt ${callAttemptId} was not found.`,
    404,
    { callAttemptId },
  );
}

export function invalidSessionTransition(message: string): DomainError {
  return new DomainError("INVALID_SESSION_TRANSITION", message, 409);
}

export function duplicateActiveClientSession(clientId: string): DomainError {
  return new DomainError(
    "DUPLICATE_ACTIVE_CLIENT_SESSION",
    `Client ${clientId} already has an active dialing session.`,
    409,
    { clientId },
  );
}

export function invalidContactInput(message: string): DomainError {
  return new DomainError("INVALID_CONTACT_INPUT", message, 400);
}

export function providerFailure(message: string): DomainError {
  return new DomainError("PROVIDER_FAILURE", message, 502);
}

export function databaseConflict(message: string): DomainError {
  return new DomainError("DATABASE_CONFLICT", message, 409);
}

export function validationError(message: string): DomainError {
  return new DomainError("VALIDATION_ERROR", message, 400);
}

export function unauthorized(): DomainError {
  return new DomainError("UNAUTHORIZED", "Missing or invalid service API key.", 401);
}
