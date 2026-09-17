import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthError, type AuthService } from "../auth/AuthService";
import { AuthRateLimiter } from "./AuthRateLimiter";
import { bearerToken, readJson, sendJson } from "./httpJson";

export interface ApiHandlerDeps {
  authService: AuthService;
  clientOrigin: string;
  authRateLimiter?: AuthRateLimiter;
}

interface RegisterBody {
  username?: unknown;
  password?: unknown;
  passwordConfirmation?: unknown;
}

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

interface RecoverBody {
  username?: unknown;
  recoveryCode?: unknown;
  newPassword?: unknown;
  passwordConfirmation?: unknown;
}

function value(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function setCors(
  request: IncomingMessage,
  response: ServerResponse,
  clientOrigin: string
): void {
  if (request.headers.origin !== clientOrigin) return;
  response.setHeader("access-control-allow-origin", clientOrigin);
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization,content-type");
  response.setHeader("vary", "Origin");
}

function rateKey(request: IncomingMessage): string {
  const ip = request.socket.remoteAddress ?? "unknown";
  return `${ip}:${request.url ?? "/"}`;
}

function unauthorized(response: ServerResponse): void {
  sendJson(response, 401, {
    code: "UNAUTHORIZED",
    message: "Authentication is required."
  });
}

export function createApiHandler(deps: ApiHandlerDeps) {
  const limiter = deps.authRateLimiter ?? new AuthRateLimiter();

  return (request: IncomingMessage, response: ServerResponse): void => {
    void handleRequest(request, response, limiter, deps).catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }

      if (error instanceof AuthError) {
        sendJson(response, error.status, {
          code: error.code,
          message: error.message
        });
        return;
      }

      if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
        sendJson(response, 413, {
          code: "REQUEST_TOO_LARGE",
          message: "Request body is too large."
        });
        return;
      }

      if (error instanceof SyntaxError) {
        sendJson(response, 400, {
          code: "INVALID_JSON",
          message: "Request body must be valid JSON."
        });
        return;
      }

      sendJson(response, 500, {
        code: "INTERNAL_ERROR",
        message: "The server could not complete the request."
      });
    });
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  limiter: AuthRateLimiter,
  deps: ApiHandlerDeps
): Promise<void> {
  setCors(request, response, deps.clientOrigin);

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  const path = new URL(request.url ?? "/", "http://localhost").pathname;

  if (request.method === "POST" && path === "/api/auth/register") {
    if (!limiter.consume(rateKey(request))) {
      sendJson(response, 429, {
        code: "RATE_LIMITED",
        message: "Too many attempts. Try again shortly."
      });
      return;
    }

    const body = await readJson<RegisterBody>(request);
    const password = value(body.password);
    if (password !== value(body.passwordConfirmation)) {
      sendJson(response, 400, {
        code: "PASSWORD_MISMATCH",
        message: "Passwords do not match."
      });
      return;
    }

    const result = await deps.authService.register(value(body.username), password);
    sendJson(response, 201, result);
    return;
  }

  if (request.method === "POST" && path === "/api/auth/login") {
    if (!limiter.consume(rateKey(request))) {
      sendJson(response, 429, {
        code: "RATE_LIMITED",
        message: "Too many attempts. Try again shortly."
      });
      return;
    }

    const body = await readJson<LoginBody>(request);
    const result = await deps.authService.login(
      value(body.username),
      value(body.password)
    );
    sendJson(response, 200, {
      token: result.token,
      session: result.session
    });
    return;
  }

  if (request.method === "POST" && path === "/api/auth/logout") {
    const token = bearerToken(request);
    if (!token || !(await deps.authService.validateToken(token))) {
      unauthorized(response);
      return;
    }

    await deps.authService.logout(token);
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method === "POST" && path === "/api/auth/recover") {
    if (!limiter.consume(rateKey(request))) {
      sendJson(response, 429, {
        code: "RATE_LIMITED",
        message: "Too many attempts. Try again shortly."
      });
      return;
    }

    const body = await readJson<RecoverBody>(request);
    const newPassword = value(body.newPassword);
    if (newPassword !== value(body.passwordConfirmation)) {
      sendJson(response, 400, {
        code: "PASSWORD_MISMATCH",
        message: "Passwords do not match."
      });
      return;
    }

    const result = await deps.authService.recover(
      value(body.username),
      value(body.recoveryCode),
      newPassword
    );
    sendJson(response, 200, result.response);
    return;
  }

  if (request.method === "GET" && path === "/api/auth/session") {
    const token = bearerToken(request);
    if (!token) {
      unauthorized(response);
      return;
    }

    const auth = await deps.authService.validateToken(token);
    if (!auth) {
      unauthorized(response);
      return;
    }

    sendJson(response, 200, auth.view);
    return;
  }

  sendJson(response, 404, {
    code: "NOT_FOUND",
    message: "Endpoint not found."
  });
}
