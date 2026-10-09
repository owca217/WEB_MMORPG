import express, { type NextFunction, type Request, type Response } from "express";
import { AuthError, type AuthService } from "../auth/AuthService";
import { bearerToken, requireAuthContext } from "../auth/AuthContext";
import {
  CharacterLifecycleError,
  type CharacterLifecycleService
} from "../character/CharacterLifecycleService";
import type { ActiveConnectionRegistry } from "../server/ActiveConnectionRegistry";
import { AuthRateLimiter } from "./AuthRateLimiter";

export interface AuthRouterDeps {
  authService: AuthService;
  characterService: CharacterLifecycleService;
  rateLimiter?: AuthRateLimiter;
  connections?: ActiveConnectionRegistry;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function rateKey(request: Request, path: string): string {
  const forwarded = request.header("x-forwarded-for")?.split(",")[0]?.trim();
  return `${forwarded || request.ip || request.socket.remoteAddress || "unknown"}:${path}`;
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}

export function createAuthRouter(deps: AuthRouterDeps): express.Router {
  const router = express.Router();
  const limiter = deps.rateLimiter ?? new AuthRateLimiter();

  const limited = (path: string, request: Request, response: Response): boolean => {
    if (limiter.consume(rateKey(request, path))) return false;
    response.status(429).json({
      code: "RATE_LIMITED",
      message: "Too many attempts. Try again shortly."
    });
    return true;
  };

  router.post(
    "/auth/register",
    asyncRoute(async (request, response) => {
      if (limited("register", request, response)) return;
      const password = text(request.body?.password);
      if (password !== text(request.body?.passwordConfirmation)) {
        response.status(400).json({ code: "PASSWORD_MISMATCH", message: "Passwords do not match." });
        return;
      }
      const result = await deps.authService.register(text(request.body?.username), password);
      response.status(201).json(result);
    })
  );

  router.post(
    "/auth/login",
    asyncRoute(async (request, response) => {
      if (limited("login", request, response)) return;
      const result = await deps.authService.login(
        text(request.body?.username),
        text(request.body?.password)
      );
      deps.connections?.closeAccount(result.accountId, "SESSION_REPLACED");
      response.status(200).json({ token: result.token, session: result.session });
    })
  );

  router.get(
    "/auth/session",
    asyncRoute(async (request, response) => {
      const token = bearerToken(request.header("authorization"));
      if (!token) throw new AuthError("UNAUTHORIZED", 401, "Authentication is required.");
      const validated = await deps.authService.validateToken(token);
      if (!validated) throw new AuthError("UNAUTHORIZED", 401, "Authentication is required.");
      response.status(200).json(validated.view);
    })
  );

  router.post(
    "/auth/logout",
    asyncRoute(async (request, response) => {
      const token = bearerToken(request.header("authorization"));
      if (!token) throw new AuthError("UNAUTHORIZED", 401, "Authentication is required.");
      const validated = await deps.authService.validateToken(token);
      if (!validated) throw new AuthError("UNAUTHORIZED", 401, "Authentication is required.");
      await deps.authService.logout(token);
      deps.connections?.closeAccount(validated.account.id, "SESSION_REVOKED");
      response.status(204).end();
    })
  );

  router.post(
    "/auth/recover",
    asyncRoute(async (request, response) => {
      if (limited("recover", request, response)) return;
      const newPassword = text(request.body?.newPassword);
      if (newPassword !== text(request.body?.passwordConfirmation)) {
        response.status(400).json({ code: "PASSWORD_MISMATCH", message: "Passwords do not match." });
        return;
      }
      const result = await deps.authService.recover(
        text(request.body?.username),
        text(request.body?.recoveryCode),
        newPassword
      );
      deps.connections?.closeAccount(result.accountId, "SESSION_REVOKED");
      response.status(200).json(result.response);
    })
  );

  router.get(
    "/character",
    asyncRoute(async (request, response) => {
      const context = await requireAuthContext(deps.authService, request.header("authorization"));
      const character = await deps.characterService.getCharacter(context.accountId);
      if (!character) {
        response.status(404).json({ code: "CHARACTER_NOT_FOUND", message: "This account has no character." });
        return;
      }
      response.status(200).json(character);
    })
  );

  router.post(
    "/character",
    asyncRoute(async (request, response) => {
      const context = await requireAuthContext(deps.authService, request.header("authorization"));
      const character = await deps.characterService.createCharacter(context.accountId, {
        nickname: text(request.body?.nickname),
        appearance: request.body?.appearance
      });
      response.status(201).json(character);
    })
  );

  router.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (error instanceof AuthError || error instanceof CharacterLifecycleError) {
      response.status(error.status).json({ code: error.code, message: error.message });
      return;
    }
    if (response.headersSent) {
      next(error);
      return;
    }
    response.status(500).json({ code: "INTERNAL_ERROR", message: "The server could not complete the request." });
  });

  return router;
}
