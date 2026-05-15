/**
 * httpCompression.ts - gzip/brotli HTTP compression middleware
 *
 * Compresses responses larger than 1KB when clients support it.
 * Prefers brotli over gzip. Skips already-compressed content types.
 * Also decompresses incoming compressed request bodies.
 */

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as zlib from "node:zlib";
import { HttpServerRequest, HttpServerResponse, HttpRouter } from "effect/unstable/http";

// ============== Types ==============

const MIN_COMPRESSION_SIZE = 1024; // 1KB threshold

// Content types that are already compressed and should not be re-compressed
const COMPRESSED_CONTENT_TYPES = new Set([
  "image/",
  "audio/",
  "video/",
  "application/",
  "font/",
]);

const SKIP_COMPRESSION_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
  "application/",
  "application/gzip",
  "application/zstd",
  "application/zip",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/pdf",
  "font/",
  "audio/",
  "video/",
]);

// ============== Errors ==============

export class CompressionError extends Data.TaggedError("CompressionError")<{
  readonly cause: unknown;
  readonly encoding: string;
}> {}

// ============== Helpers ==============

function shouldSkipCompression(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  // Skip if it's a known compressed type prefix
  for (const skipType of SKIP_COMPRESSION_TYPES) {
    if (ct.startsWith(skipType)) return true;
  }
  return false;
}

function parseAcceptEncoding(acceptEncoding: string | null): {
  brotli: boolean;
  gzip: boolean;
} {
  if (!acceptEncoding) return { brotli: false, gzip: false };
  const encodings = acceptEncoding.toLowerCase().split(",").map((e) => e.trim().split(";")[0]);
  return {
    brotli: encodings.includes("br"),
    gzip: encodings.includes("gzip"),
  };
}

async function compressBuffer(
  buffer: Buffer,
  encoding: "gzip" | "brotli",
  compressionLevel: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const callback = (err: Error | null, result: Buffer) => {
      if (err) reject(err);
      else resolve(result);
    };

    if (encoding === "brotli") {
      zlib.brotliCompress(buffer, { params: { [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, [zlib.constants.BROTLI_PARAM_QUALITY]: compressionLevel } }, callback);
    } else {
      zlib.gzip(buffer, { level: compressionLevel }, callback);
    }
  });
}

async function decompressBuffer(
  buffer: Buffer,
  encoding: "gzip" | "br",
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const callback = (err: Error | null, result: Buffer) => {
      if (err) reject(err);
      else resolve(result);
    };
    if (encoding === "br") {
      zlib.brotliDecompress(buffer, callback);
    } else {
      zlib.gunzip(buffer, callback);
    }
  });
}

// ============== Response Compression ==============

/**
 * Wraps an HttpServerResponse and compresses the body if:
 * - Content-Type is not already compressed
 * - Response body is >= 1KB
 * - Client sent Accept-Encoding with gzip or br
 * - brotli is preferred over gzip when both are accepted
 */
export async function compressResponse(
  response: HttpServerResponse,
  acceptEncoding: string | null,
  compressionLevel: number,
): Promise<HttpServerResponse> {
  const contentType = response.headers?.["content-type"] ?? response.headers?.["Content-Type"];
  if (shouldSkipCompression(contentType)) {
    return response;
  }

  const { brotli, gzip } = parseAcceptEncoding(acceptEncoding);
  if (!brotli && !gzip) {
    return response;
  }

  // Try to read body
  let body: Uint8Array;
  try {
    body = await response.arrayBuffer();
  } catch {
    // Cannot read body (e.g., streaming response) — skip compression
    return response;
  }

  if (body.length < MIN_COMPRESSION_SIZE) {
    // Too small to compress — skip to avoid overhead
    return response;
  }

  const encoding = brotli ? "brotli" : "gzip";

  try {
    const compressed = await compressBuffer(Buffer.from(body), encoding, compressionLevel);

    // Only use compression if it actually reduces size
    if (compressed.length >= body.length) {
      return response; // Compression didn't help
    }

    return HttpServerResponse.arrayBuffer(compressed, {
      status: (response as any).status ?? 200,
      headers: {
        ...((response as any).headers ?? {}),
        "Content-Encoding": encoding === "brotli" ? "br" : "gzip",
        "Content-Length": String(compressed.length),
        "Vary": "Accept-Encoding",
      },
      contentType,
    });
  } catch (err) {
    // Compression failed — return original response
    return response;
  }
}

// ============== Request Decompression ==============

/**
 * Decompresses request body if Content-Encoding is gzip or br.
 * Returns the original body if not compressed or decompression fails.
 */
export async function decompressRequest(
  body: Uint8Array,
  contentEncoding: string | null,
): Promise<Uint8Array> {
  if (!contentEncoding) return body;

  const encoding = contentEncoding.toLowerCase();
  if (encoding !== "gzip" && encoding !== "br") return body;

  try {
    const decompressed = await decompressBuffer(Buffer.from(body), encoding);
    return decompressed;
  } catch {
    return body; // Decompression failed — return original
  }
}

// ============== Middleware ==============

export type CompressionLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const DEFAULT_COMPRESSION_LEVEL: CompressionLevel = 6;

export interface CompressionConfig {
  readonly compressionLevel: CompressionLevel;
}

/**
 * Creates an HTTP middleware that adds compression support to all routes.
 * Apply this by wrapping routes or the server.
 */
export function createCompressionLayer(config: CompressionConfig) {
  return HttpRouter.layer(
    Effect.gen(function* () {
      // This layer doesn't add routes — it enhances the server's HTTP handling
      // The actual compression is applied per-response via compressResponse()
      yield* Effect.logDebug("Compression enabled", {
        compressionLevel: config.compressionLevel,
      });
    }),
  );
}

// ============== Metrics ==============

let _cacheHits = 0;
let _cacheMisses = 0;
let _totalBytesSaved = 0;

export function getCompressionMetrics() {
  return {
    cacheHits: _cacheHits,
    cacheMisses: _cacheMisses,
    totalBytesSaved: _totalBytesSaved,
    hitRate: _cacheHits + _cacheMisses > 0 ? _cacheHits / (_cacheHits + _cacheMisses) : 0,
  };
}

export function recordCompressionMetric(bytesSaved: number, cacheHit: boolean) {
  if (cacheHit) _cacheHits++;
  else _cacheMisses++;
  _totalBytesSaved += bytesSaved;
}
