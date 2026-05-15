/**
 * errors.ts - Centralized server error types using Effect.Data.TaggedEnum
 *
 * Provides a unified error hierarchy for all server modules.
 * Each error has a unique _tag, descriptive message, optional cause, and timestamp.
 *
 * @module errors
 */

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";

// ============== Error Union Types ==============

/**
 * Network errors - wraps network-level failures (DNS, connection refused, timeout)
 */
export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly operation: string;
  readonly target?: string;
  readonly cause: unknown;
}> {}

/**
 * Database/persistence errors - wraps SQLite and file storage failures
 */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly operation: string;
  readonly detail?: string;
  readonly cause: unknown;
}> {}

/**
 * Authentication/authorization errors
 */
export class AuthError extends Data.TaggedError("AuthError")<{
  readonly operation: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

/**
 * Git/source control errors
 */
export class GitError extends Data.TaggedError("GitError")<{
  readonly operation: string;
  readonly repository?: string;
  readonly cause: unknown;
}> {}

/**
 * Configuration errors - invalid config, missing fields, type mismatches
 */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly field?: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Validation errors - invalid input, schema validation failures
 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field?: string;
  readonly value?: unknown;
  readonly message: string;
}> {}

/**
 * Server runtime errors - startup, lifecycle, shutdown
 */
export class ServerRuntimeError extends Data.TaggedError("ServerRuntimeError")<{
  readonly phase: "startup" | "runtime" | "shutdown";
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============== Error Union ==============

/**
 * Union type of all server error types
 */
export type ServerError =
  | NetworkError
  | DatabaseError
  | AuthError
  | GitError
  | ConfigError
  | ValidationError
  | ServerRuntimeError;

// ============== HTTP Status Code Mapping ==============

/**
 * Maps error tags to HTTP status codes for API responses
 */
export const ERROR_STATUS_MAP: Record<ServerError["_tag"], number> = {
  AuthError: 401,
  ValidationError: 400,
  DatabaseError: 500,
  NetworkError: 502,
  ConfigError: 500,
  GitError: 422,
  ServerRuntimeError: 500,
};

/**
 * Maps an error to its HTTP status code
 */
export function errorToStatusCode(error: ServerError): number {
  return ERROR_STATUS_MAP[error._tag] ?? 500;
}

/**
 * Returns a human-readable status text for an error
 */
export function errorToStatusText(error: ServerError): string {
  const status = errorToStatusCode(error);
  const texts: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    422: "Unprocessable Entity",
    500: "Internal Server Error",
    502: "Bad Gateway",
  };
  return texts[status] ?? "Error";
}

// ============== Logging ==============

/**
 * Log levels per error category
 */
const ERROR_LOG_LEVELS: Record<ServerError["_tag"], Logger.LogLevel> = {
  AuthError: Logger.logLevel.Info,
  ValidationError: Logger.logLevel.Warn,
  DatabaseError: Logger.logLevel.Error,
  NetworkError: Logger.logLevel.Error,
  ConfigError: Logger.logLevel.Error,
  GitError: Logger.logLevel.Warn,
  ServerRuntimeError: Logger.logLevel.Error,
};

/**
 * Structured error log format (JSON)
 */
export interface ErrorLogEntry {
  readonly _tag: string;
  readonly message: string;
  readonly stack?: string;
  readonly timestamp: string;
  readonly operation?: string;
  readonly field?: string;
  readonly cause?: string;
}

/**
 * Formats an error into a structured log object
 */
export function errorToLog(error: ServerError): ErrorLogEntry {
  const cause = error.cause !== undefined ? String(error.cause) : undefined;

  const entry: ErrorLogEntry = {
    _tag: error._tag,
    message: error.message ?? error.reason ?? error.message ?? error._tag,
    timestamp: new Date().toISOString(),
  };

  // Add optional fields based on what's available on the error
  if ("operation" in error && error.operation) {
    (entry as any).operation = error.operation;
  }
  if ("field" in error && error.field) {
    (entry as any).field = error.field;
  }
  if ("reason" in error && error.reason) {
    (entry as any).reason = error.reason;
  }
  if ("repository" in error && error.repository) {
    (entry as any).repository = error.repository;
  }
  if ("phase" in error && error.phase) {
    (entry as any).phase = error.phase;
  }
  if (cause) {
    entry.cause = cause;
  }

  // Add stack trace for Error instances
  if (error instanceof Error && error.stack) {
    entry.stack = error.stack;
  }

  return entry;
}

/**
 * Gets the appropriate log level for an error
 */
export function errorToLogLevel(error: ServerError): Logger.LogLevel {
  return ERROR_LOG_LEVELS[error._tag] ?? Logger.logLevel.Error;
}

// ============== Effect Utilities ==============

/**
 * Lifts a ServerError into an Effect
 */
export function failWithError<E extends ServerError>(error: E): Effect.Effect<never, E> {
  return Effect.fail(error);
}

/**
 * Maps a ServerError to a different error type while preserving the original
 */
export function mapError<E extends ServerError, E2 extends ServerError>(
  effect: Effect.Effect<never, E>,
  fn: (e: E) => E2,
): Effect.Effect<never, E2> {
  return Effect.mapError(effect, fn);
}

// ============== Error Creation Helpers ==============

export function networkError(operation: string, cause: unknown, target?: string): NetworkError {
  return new NetworkError({ operation, cause, target });
}

export function databaseError(operation: string, cause: unknown, detail?: string): DatabaseError {
  return new DatabaseError({ operation, detail, cause });
}

export function authError(operation: string, reason: string, cause?: unknown): AuthError {
  return new AuthError({ operation, reason, cause });
}

export function gitError(operation: string, cause: unknown, repository?: string): GitError {
  return new GitError({ operation, cause, repository });
}

export function configError(message: string, cause?: unknown, field?: string): ConfigError {
  return new ConfigError({ message, cause, field });
}

export function validationError(message: string, field?: string, value?: unknown): ValidationError {
  return new ValidationError({ field, value, message });
}

export function serverRuntimeError(
  phase: "startup" | "runtime" | "shutdown",
  message: string,
  cause?: unknown,
): ServerRuntimeError {
  return new ServerRuntimeError({ phase, message, cause });
}
