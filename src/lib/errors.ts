/**
 * Typed error hierarchy for structured error responses across all three surfaces
 * (admin, REST, MCP). Classes are intentional here — error hierarchies are the
 * canonical use case for class inheritance + `instanceof` (see the ESLint override
 * note in CODING_CONVENTIONS.md).
 *
 * Every AppError carries a machine-readable `code` so clients branch on error type
 * without parsing human-readable messages. See steering/ERROR_HANDLING.md.
 */

export interface ErrorDetails {
  readonly path?: string;
  readonly message: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly friendlyMessage: string;
  readonly details?: readonly ErrorDetails[];

  constructor(
    message: string,
    status: number,
    code: string,
    friendlyMessage?: string,
    details?: readonly ErrorDetails[],
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.friendlyMessage = friendlyMessage ?? message;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: readonly ErrorDetails[]) {
    super(message, 400, 'BAD_REQUEST', message, details);
    this.name = 'BadRequestError';
  }
}

/**
 * Validation failure. Carries the Zod issue shape used identically by admin, REST,
 * and MCP (steering/API_AND_MCP_STANDARDS.md).
 */
export class InputValidationError extends AppError {
  constructor(details: readonly ErrorDetails[], message = 'Validation failed') {
    super(message, 422, 'VALIDATION', message, details);
    this.name = 'InputValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND', `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

/**
 * Authorization denial. `missing` names the exact (action, collection) the
 * principal lacked, so an agent can reason about what it needs rather than retry
 * blindly (steering/ACCESS_CONTROL.md). The full access module (Phase 3)
 * constructs these; Phase 1/2 use the base 403.
 */
export interface MissingPermission {
  readonly action: string;
  readonly collection?: string;
}

export class ForbiddenError extends AppError {
  readonly missing?: MissingPermission;
  constructor(message = 'Forbidden', missing?: MissingPermission) {
    super(message, 403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
    this.missing = missing;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR', 'Something went wrong — please try again');
    this.name = 'InternalServerError';
  }
}
