import { getAuth } from "@/lib/auth/server";

type HandlerName = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

function forward(method: HandlerName) {
  return async (request: Request, context: { params: Promise<{ path: string[] }> }) => {
    const handler = getAuth().handler()[method];
    return handler(request, context);
  };
}

export const GET = forward("GET");
export const POST = forward("POST");
export const PUT = forward("PUT");
export const DELETE = forward("DELETE");
export const PATCH = forward("PATCH");
