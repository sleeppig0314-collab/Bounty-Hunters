/**
 * SqlitePool.test.ts - Tests for SQLite WAL mode, pool sizing, and concurrent access
 */

import { DatabaseSync } from "node:sqlite";
import { Effect, Pool, Ref } from "effect";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { describe as describeEffect } from "@effect/test";
import * as fc from "fast-check";

import { makeSqlitePool, runHealthCheck, type SqlitePoolConfig } from "./SqlitePool.ts";

// ============== Test Setup ==============

function tempDb(prefix = "test-pool") {
  const tmp = require("node:os").tmpdir();
  const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  return `${tmp}/${name}`;
}

function withPool<T>(
  config: Partial<SqlitePoolConfig>,
  fn: (pool: Pool.Pool<any, any, Effect.Scope>, cleanup: () => void) => Effect.Effect<T, any, Effect.Scope>,
) {
  const dbPath = tempDb();
  const cfg: SqlitePoolConfig = {
    filename: dbPath,
    minConnections: 1,
    maxConnections: 5,
    ...config,
  };

  const pool = makeSqlitePool(cfg);
  const cleanup = () => {
    try {
      new DatabaseSync(dbPath).close();
      require("node:fs").unlinkSync(dbPath);
    } catch {}
  };

  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const p = yield* pool;
    const result = yield* fn(p, cleanup);
    return result;
  });
}

// ============== WAL Mode Tests ==============

describe("WAL mode", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("wal-test");
  });

  afterEach(() => {
    try { new DatabaseSync(dbPath).close(); require("node:fs").unlinkSync(dbPath); } catch {}
  });

  it("enables WAL journal mode on database", () =>
    Effect.gen(function* () {
      const pool = makeSqlitePool({ filename: dbPath, minConnections: 1, maxConnections: 1 });
      const p = yield* pool;

      // Check WAL mode
      const conn = yield* Pool.get(p);
      const db = (conn as any).__db as DatabaseSync;
      const stmt = db.prepare("PRAGMA journal_mode");
      stmt.setReturnArrays(true);
      const rows = stmt.all() as unknown as string[][];
      expect(rows[0]?.[0]).toBe("wal");
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it("sets busy_timeout to 5000ms", () =>
    Effect.gen(function* () {
      const pool = makeSqlitePool({ filename: dbPath });
      const p = yield* pool;
      const conn = yield* Pool.get(p);
      const db = (conn as any).__db as DatabaseSync;
      const stmt = db.prepare("PRAGMA busy_timeout");
      stmt.setReturnArrays(true);
      const rows = stmt.all() as unknown as string[][];
      expect(rows[0]?.[0]).toBe("5000");
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it("sets synchronous to NORMAL", () =>
    Effect.gen(function* () {
      const pool = makeSqlitePool({ filename: dbPath });
      const p = yield* pool;
      const conn = yield* Pool.get(p);
      const db = (conn as any).__db as DatabaseSync;
      const stmt = db.prepare("PRAGMA synchronous");
      stmt.setReturnArrays(true);
      const rows = stmt.all() as unknown as string[][];
      expect(rows[0]?.[0]).toBe("1"); // NORMAL = 1
    }).pipe(Effect.scoped, Effect.runPromise),
  );
});

// ============== Pool Sizing Tests ==============

describe("Pool sizing", () => {
  it("respects min and max connection limits", () =>
    Effect.gen(function* () {
      const dbPath = tempDb("pool-size");
      const pool = makeSqlitePool({ filename: dbPath, minConnections: 2, maxConnections: 4 });
      const p = yield* pool;

      // Acquire 4 connections
      const conns = yield* Effect.all([
        Pool.get(p),
        Pool.get(p),
        Pool.get(p),
        Pool.get(p),
      ], { concurrency: 4 });

      // All should be different connections
      const dbs = conns.map((c: any) => c as DatabaseSync);
      const uniqueDbs = new Set(dbs.map((d: any) => d));
      expect(uniqueDbs.size).toBe(4);

      // Release all
      yield* Effect.all(conns.map((c: any) => Pool.release(p, c)), { concurrency: 4 });

      // Now we should be able to acquire 4 again (pool respects max)
      const conns2 = yield* Effect.all([
        Pool.get(p),
        Pool.get(p),
        Pool.get(p),
        Pool.get(p),
      ], { concurrency: 4 });
      expect(conns2).toHaveLength(4);
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it("reuses idle connections after release", () =>
    Effect.gen(function* () {
      const dbPath = tempDb("pool-reuse");
      const pool = makeSqlitePool({ filename: dbPath, minConnections: 1, maxConnections: 3 });
      const p = yield* pool;

      // Acquire and release
      const c1 = yield* Pool.get(p);
      yield* Pool.release(p, c1);

      // Same connection should be available
      const c2 = yield* Pool.get(p);
      expect(c2).toBe(c1);
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it("acquires timeout throws after 10s", () =>
    Effect.gen(function* () {
      const dbPath = tempDb("pool-timeout");
      const pool = makeSqlitePool({ filename: dbPath, minConnections: 1, maxConnections: 1 });
      const p = yield* pool;

      // Hold the only connection
      const held = yield* Pool.get(p);

      // Try to acquire another — should timeout
      const start = Date.now();
      const result = yield* Effect.timeout(Duration.seconds(12))(
        Pool.get(p),
      );

      expect(result).toBe(null); // timed out
      expect(Date.now() - start).toBeGreaterThan(9000);

      // Release held
      yield* Pool.release(p, held);
    }).pipe(Effect.scoped, Effect.runPromise),
  );
});

// ============== Concurrent Access Tests ==============

describe("Concurrent access", () => {
  it("does not deadlock under concurrent reads and writes", () =>
    Effect.gen(function* () {
      const dbPath = tempDb("concurrent-test");
      const pool = makeSqlitePool({ filename: dbPath, minConnections: 1, maxConnections: 5 });

      // Create table
      const setupDb = new DatabaseSync(dbPath);
      setupDb.exec("CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, value INTEGER)");
      setupDb.exec("INSERT OR REPLACE INTO counter VALUES (1, 0)");
      setupDb.close();

      const p = yield* pool;

      // Run 20 concurrent operations: 10 reads, 10 writes
      const operations = yield* Effect.all(
        Array.from({ length: 20 }, (_, i) =>
          i < 10
            ? Effect.gen(function* () {
                const conn = yield* Pool.get(p);
                try {
                  const db = (conn as any).__db as DatabaseSync;
                  const stmt = db.prepare("SELECT value FROM counter WHERE id = 1");
                  stmt.setReturnArrays(true);
                  const rows = stmt.all() as unknown as number[][];
                  return rows[0]?.[0] ?? null;
                } finally {
                  yield* Pool.release(p, conn);
                }
              })
            : Effect.gen(function* () {
                const conn = yield* Pool.get(p);
                try {
                  const db = (conn as any).__db as DatabaseSync;
                  db.exec("UPDATE counter SET value = value + 1 WHERE id = 1");
                } finally {
                  yield* Pool.release(p, conn);
                }
              }),
        ),
        { concurrency: 20 },
      );

      // All reads should have returned (not deadlocked)
      expect(operations.filter((v: any) => v !== null)).toHaveLength(10);
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it("health check returns pass for healthy database", () =>
    Effect.gen(function* () {
      const dbPath = tempDb("health-test");
      const pool = makeSqlitePool({ filename: dbPath });
      const p = yield* pool;

      const result = yield* runHealthCheck(p);
      expect(result.pass).toBe(true);
      expect(result.detail).toBe("ok");
    }).pipe(Effect.scoped, Effect.runPromise),
  );
});

// ============== Percentile Calculation Tests ==============

describe("Percentile calculation", () => {
  it("calculates p50/p95/p99 correctly", () => {
    const values = Array.from({ length: 100 }, (_, i) => i); // 0-99
    const sorted = [...values].sort((a, b) => a - b);

    const percentile = (arr: number[], p: number) => {
      const idx = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, idx)];
    };

    expect(percentile(sorted, 50)).toBe(49);
    expect(percentile(sorted, 95)).toBe(94);
    expect(percentile(sorted, 99)).toBe(98);
  });

  it("handles small sample sizes", () => {
    const calcP = (arr: number[], p: number) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)];
    };

    expect(calcP([1], 50)).toBe(1);
    expect(calcP([1, 2], 50)).toBe(2);
    expect(calcP([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(calcP([1, 2, 3, 4, 5], 95)).toBe(5);
  });
});

// ============== Window Rotation Tests ==============

describe("Window rotation", () => {
  it("retains exactly 60 windows in circular buffer", () => {
    const windows: number[] = [];
    const MAX_WINDOWS = 60;

    const addWindow = (data: number) => {
      if (windows.length >= MAX_WINDOWS) {
        windows.shift(); // remove oldest
      }
      windows.push(data);
    };

    // Add 70 windows
    for (let i = 0; i < 70; i++) addWindow(i);

    expect(windows.length).toBe(60);
    expect(windows[0]).toBe(10); // oldest remaining
    expect(windows[59]).toBe(69); // newest
  });
});

// ============== Effect.Stream Sliding Window Tests ==============

describe("Effect.Stream sliding window", () => {
  it("correctly overlaps windows", () =>
    Effect.gen(function* () {
      const { Stream } = yield* Effect;
      const numbers = Array.from({ length: 10 }, (_, i) => i);

      const windows = yield* Stream.fromIterable(numbers)
        .pipe(
          Stream.sliding(3, { capacity: 2 }),
          Stream.runCollect,
        );

      // With sliding(3), we should get overlapping windows
      // For 10 numbers with window size 3, we get 8 windows
      expect(windows.length).toBe(8);
    }).pipe(Effect.runPromise),
  );
});

function Duration$seconds(s: number) {
  return { _tag: "Seconds", seconds: s } as any;
}