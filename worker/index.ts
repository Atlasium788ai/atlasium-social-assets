import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  UPLOADS: R2Bucket;
  UPLOAD_KEY: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const allowedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function upload(request: Request, env: Env) {
  if (!env.UPLOAD_KEY || request.headers.get("X-Upload-Key") !== env.UPLOAD_KEY) {
    return json({ error: "This uploader link is not authorized." }, 401);
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > 21 * 1024 * 1024) return json({ error: "Image is over the 20 MB limit." }, 413);

  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File)) return json({ error: "Choose an image to upload." }, 400);
  if (image.size > 20 * 1024 * 1024) return json({ error: "Image is over the 20 MB limit." }, 413);

  const extension = allowedTypes.get(image.type.toLowerCase());
  if (!extension) return json({ error: "Use a JPG, PNG, WebP, GIF or HEIC image." }, 415);

  const id = crypto.randomUUID();
  const key = `${new Date().toISOString().slice(0, 10)}/${id}.${extension}`;
  await env.UPLOADS.put(key, image.stream(), {
    httpMetadata: { contentType: image.type, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { originalName: image.name.slice(0, 200) },
  });

  return json({ url: `${new URL(request.url).origin}/i/${key}` }, 201);
}

async function serveImage(request: Request, env: Env, key: string) {
  const object = await env.UPLOADS.get(key);
  if (!object) return new Response("Image not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/upload") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      return upload(request, env);
    }

    if (url.pathname.startsWith("/i/") && (request.method === "GET" || request.method === "HEAD")) {
      return serveImage(request, env, decodeURIComponent(url.pathname.slice(3)));
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
