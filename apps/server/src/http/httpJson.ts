import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_BODY_BYTES = 16 * 1024;

export async function readJson<T>(request: IncomingMessage): Promise<T> {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function bearerToken(request: IncomingMessage): string | null {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token || null;
}
