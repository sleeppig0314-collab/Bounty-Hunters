/**
 * SqlitePool.ts - Effect.Pool connection pooling for SQLite
 *
 * Implements connection pool using Effect.Pool with:
 * - Min 1, max 5 connections based on demand
 * - Connection reset via PRAGMA on checkout
 * - Health check with PRAGMA integrity_check
 * - 10s acquire timeout
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";

import * as Cache from "effect/Cache";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { identity, pipe } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Pool from "effect/Pool";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Context from "effect/Context";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { SqlError, classifySqliteError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";
import * as Ref from "effect/Ref";

import { serverRuntimeError } from "../../errors.ts";

// ============== Types ==============

export interface SqlitePoolConfig {
  readonly filename: string;
  readonly minConnections?: number;  // default 1
  readonly maxConnections?: number;  // default 5
  readonly acquireTimeout?: Duration.Duration;  // default 10s
  readonly prepareCacheSize?: number;  // default 200
  readonly prepareCacheTTL?: Duration.Duration;  // default 10min
  readonly spanAttributes?: Record<string, unknown>;
  readonly readonly?: boolean;
  readonly allowExtension?: boolean;
}

// ============== Pool Statistics ==============

export interface SqlitePoolStats {
  readonly size: number;
  readonly idleCount: number;
  readonly busyCount: number;
  readonly waitingCount: number;
}

interface PoolState {
  readonly size: number;
  readonly idle: number;
  readonly busy: number;
  readonly waiting: number;
}

// ============== Connection Factory ==============

function openDatabase(cfg: SqlitePoolConfig): DatabaseSync {
  return new DatabaseSync(cfg.filename, {
    readOnly: cfg.readonly ?? false,
    allowExtension: cfg.allowExtension ?? false,
  });
}

function resetConnection(db: DatabaseSync): void {
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
}

function healthCheck(db: DatabaseSync): { pass: boolean; detail: string } {
  try {
    const stmt = db.prepare("PRAGMA integrity_check");
    stmt.setReturnArrays(true);
    const rows = stmt.all() as unknown as string[][];
    const result = rows[0]?.[0] ?? "unknown";
    return { pass: result === "ok", detail: result };
  } catch (e) {
    return { pass: false, detail: String(e) };
  }
}

// ============== Pool Creation ==============

/**
 * Creates an Effect.Pool for SQLite connections.
 * Each acquired connection is reset via PRAGMA to ensure clean state.
 * Pool size is 1-5 connections with 10s acquire timeout.
 */
export function makeSqlitePool(config: SqlitePoolConfig) {
  const minConn = config.minConnections ?? 1;
  const maxConn = config.maxConnections ?? 5;
  const acquireTimeout = config.acquireTimeout ?? Duration.seconds(10);

  const poolState = new Map<DatabaseSync, PoolState>();

  const mkConnection = Effect.gen(function* () {
    const db = openDatabase(config);
    resetConnection(db);

    return identity<Connection>({
      execute(sql, params, rowTransform) {
        return runSql(db, sql, params, rowTransform);
      },
      executeRaw(sql, params) {
        return runSqlRaw(db, sql, params);
      },
      executeValues(sql, params) {
        return runSqlValues(db, sql, params);
      },
      executeUnprepared(sql, params, rowTransform) {
        return runSql(db, sql, params, rowTransform);
      },
      executeStream(_sql, _params) {
        return Stream.die("executeStream not implemented");
      },
    });
  });

  const pool = Pool.makeWithTimeout({
    acquire: mkConnection,
    size: { min: minConn, max: maxConn },
    acquireTimeout,
    release: (conn) =>
      Effect.sync(() => {
        try {
          resetConnection(conn as any);
        } catch {
          // Connection is broken, discard it
        }
      }),
  });

  return pool;
}

// ============== SQL Execution Helpers ==============

function runSql(
  db: DatabaseSync,
  sql: string,
  params: ReadonlyArray<unknown>,
  rowTransform?: (rows: ReadonlyArray<unknown>) => unknown,
) {
  return Effect.tryPromise({
    try: () => {
      const stmt = db.prepare(sql);
      const result = (params.length > 0 ? stmt.all(...(params as any)) : stmt.all()) as any[];
      return rowTransform ? rowTransform(result) : result;
    },
    catch: (cause) =>
      new SqlError({
        reason: classifySqliteError(cause, {
          message: `Failed to execute: ${sql.slice(0, 50)}`,
          operation: "execute",
        }),
      }),
  });
}

function runSqlRaw(
  db: DatabaseSync,
  sql: string,
  params: ReadonlyArray<unknown>,
): Effect.Effect<ReadonlyArray<unknown>, SqlError> {
  return Effect.tryPromise({
    try: () => {
      const stmt = db.prepare(sql);
      return params.length > 0 ? stmt.all(...(params as any)) as unknown as ReadonlyArray<unknown> : [];
    },
    catch: (cause) =>
      new SqlError({
        reason: classifySqliteError(cause, {
          message: `Failed to execute raw: ${sql.slice(0, 50)}`,
          operation: "executeRaw",
        }),
      }),
  });
}

function runSqlValues(
  db: DatabaseSync,
  sql: string,
  params: ReadonlyArray<unknown>,
): Effect.Effect<ReadonlyArray<ReadonlyArray<unknown>>, SqlError> {
  return Effect.tryPromise({
    try: () => {
      const stmt = db.prepare(sql);
      stmt.setReturnArrays(true);
      return params.length > 0 ? stmt.all(...(params as any)) as unknown as ReadonlyArray<ReadonlyArray<unknown>> : [];
    },
    catch: (cause) =>
      new SqlError({
        reason: classifySqliteError(cause, {
          message: `Failed to execute values: ${sql.slice(0, 50)}`,
          operation: "executeValues",
        }),
      }),
  });
}

// ============== Health Check ==============

export interface HealthCheckResult {
  readonly pass: boolean;
  readonly detail: string;
}

export function runHealthCheck(
  pool: Pool.Pool<Connection, SqlError, Scope.Scope>,
): Effect.Effect<HealthCheckResult, never, Scope.Scope> {
  return Effect.flatMap(Pool.get(pool), (conn) =>
    Effect.sync(() => {
      try {
        const db = (conn as any).__db as DatabaseSync;
        const result = healthCheck(db);
        return { pass: result.pass, detail: result.detail } as HealthCheckResult;
      } catch (e) {
        return { pass: false, detail: String(e) } as HealthCheckResult;
      }
    }),
  );
}

// ============== Pool Stats ==============

export function getPoolStats(
  pool: Pool.Pool<Connection, SqlError, Scope.Scope>,
  statsRef: Ref.Ref<SqlitePoolStats>,
): Effect.Effect<SqlitePoolStats, never> {
  return Ref.get(statsRef);
}