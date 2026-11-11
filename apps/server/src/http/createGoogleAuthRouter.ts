import express, { type NextFunction, type Request, type Response } from "express";
import { AuthError, type AuthService } from "../auth/AuthService";
import { requireAuthContext } from "../auth/AuthContext";
import type { GoogleAuthService } from "../auth/GoogleAuthService";
import type { ActiveConnectionRegistry } from "../server/ActiveConnectionRegistry";
import { AuthRateLimiter } from "./AuthRateLimiter";

export interface GoogleAuthRouterDeps {
  authService: AuthService;
  googleService: GoogleAuthService;
  connections?: ActiveConnectionRegistry;
  rateLimiter?: AuthRateLimiter;
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }

export function createGoogleAuthRouter(deps: GoogleAuthRouterDeps): express.Router {
  const router = express.Router();
  const limiter = deps.rateLimiter ?? new AuthRateLimiter();
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
  function route(path: string, work: (request: Request, response: Response) => Promise<void>) {
    return (request: Request, response: Response, next: NextFunction): void => {
      const ip = request.header("x-forwarded-for")?.split(",")[0]?.trim() || request.ip || "unknown";
      if (!limiter.consume(`google:${path}:${ip}`)) {
        response.status(429).json({ code: "RATE_LIMITED", message: "Zbyt wiele prób. Spróbuj ponownie za chwilę." });
        return;
      }
      void work(request, response).catch(next);
    };
  }
  router.get("/auth/providers", (_request, response) => { response.json(deps.googleService.providers()); });
  router.post("/auth/google/challenge", route("challenge", async (request, response) => {
    const intent = request.body?.intent;
    if (intent !== "login" && intent !== "link") throw new AuthError("GOOGLE_CHALLENGE_INVALID", 400, "Nieprawidłowy rodzaj operacji Google.");
    const context = intent === "link" ? await requireAuthContext(deps.authService, request.header("authorization")) : undefined;
    response.json(await deps.googleService.createChallenge(intent, context));
  }));
  router.post("/auth/google/login", route("login", async (request, response) => {
    const result = await deps.googleService.login(text(request.body?.challengeId), text(request.body?.idToken));
    deps.connections?.closeAccount(result.accountId, "SESSION_REPLACED");
    response.json({ token: result.token, session: result.session });
  }));
  router.get("/account/google", route("status", async (request, response) => {
    const context = await requireAuthContext(deps.authService, request.header("authorization"));
    response.json(await deps.googleService.getStatus(context.accountId));
  }));
  router.post("/account/google/link", route("link", async (request, response) => {
    const context = await requireAuthContext(deps.authService, request.header("authorization"));
    response.json(await deps.googleService.link(context, text(request.body?.challengeId), text(request.body?.idToken), text(request.body?.password)));
  }));
  router.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) { next(error); return; }
    if (error instanceof AuthError) { response.status(error.status).json({ code: error.code, message: error.message }); return; }
    response.status(500).json({ code: "INTERNAL_ERROR", message: "Nie udało się zakończyć operacji. Spróbuj ponownie." });
  });
  return router;
}
