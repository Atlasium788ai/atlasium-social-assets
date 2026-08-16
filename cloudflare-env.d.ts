declare module "cloudflare:workers" {
  // The runtime binding shape is supplied by Cloudflare at deployment time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const env: Record<string, any>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface R2ObjectBody {
  body: ReadableStream;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView, options?: Record<string, unknown>): Promise<unknown>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
}

interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>;
}
