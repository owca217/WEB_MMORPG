# Optional Google sign-in implementation plan

> **For agentic workers:** Implement the server task in this session; the independently owned web and Android adapters may run in parallel under dispatching-parallel-agents. Track results here and obtain a fresh whole-change review.

**Goal:** Additional Google signup/login and explicit linking to existing game accounts on web and Android.
**Architecture:** Existing Render/PostgreSQL accounts and bearer sessions remain authoritative. GIS on web and Credential Manager on Android send nonce-bound ID tokens to the server's Google verifier.
**Tech Stack:** TypeScript, Express, pg, google-auth-library, Phaser/DOM, Capacitor 8, Android Credential Manager.
**Spec:** ../specs/2026-11-11-google-sign-in-design.md — approved by user on 2026-11-11.

## Global constraints

- Preserve all existing accounts, credentials, character data and Android release changes.
- Target https://borderland-chronicles-krystian.onrender.com; Android applicationId io.github.owca217.webmmorpg and existing signer.
- Google sub is unique; no automatic linking using email/name. New Google accounts are PLAYER with neutral generated usernames and null local credentials.
- Challenges expire after five minutes, are single-use and bound to login/link intent; linking binds account/session and requires current password.
- One active game session, disabled accounts rejected, cancellation/closed UI ignores late results.
- Use dedicated disposable local PostgreSQL only for destructive auth tests.

## Fixed interfaces

- GET /api/auth/providers -> {google:{enabled:boolean,clientId:string|null}}.
- POST /api/auth/google/challenge, JSON {intent:'login'|'link'}, bearer required for link -> {challengeId:string,nonce:string,clientId:string}.
- POST /api/auth/google/login, JSON {challengeId,idToken} -> existing LoginResponse {token,session}.
- GET /api/account/google, bearer -> {linked:boolean,canLink:boolean,googleEnabled:boolean}.
- POST /api/account/google/link, bearer + JSON {challengeId,idToken,password} -> same account Google status.
- Errors use existing {code,message}. Cancellation code GOOGLE_CANCELLED is handled quietly by client.
- Capacitor plugin name GoogleSignIn; signIn({clientId,nonce}) -> Promise<{idToken:string}>; signOut() -> Promise<void>. Register plugin in MainActivity. Errors GOOGLE_CANCELLED, GOOGLE_UNAVAILABLE, GOOGLE_INVALID_RESPONSE.
- GOOGLE_WEB_CLIENT_ID is server env config. Client obtains public ID from API; no sample IDs or client secret shipped. Android uses this web client ID as serverClientId.

## Review focus

- Concurrent first sign-ins and cross-account link conflicts cannot leave orphan accounts or transfer identities.
- Invalid/expired tokens and challenges cannot create sessions or mutate links.
- Existing password/recovery flows handle null credentials and retain existing local accounts.
- Async results after UI disposal/logout/session replacement cannot authenticate or link a different account.
- Android store/local signing certificates and OAuth clients must match; builds alone cannot establish live Google login.

## Task 1: Server identity, persistence and API (primary agent)

Files: new 019_google_auth.sql, GoogleIdentityVerifier.ts, GoogleAuthService.ts, createGoogleAuthRouter.ts and focused tests; modify db/migrate.ts, persistence/AccountRepository.ts, auth/AuthService.ts, index.ts, server dependency manifest/lock.

- [ ] Save and verify restore point (HEAD source archive plus existing local release diff).
- [ ] Create disposable local PG database with localhost-only connection and run new failing tests for first/returning/concurrent login, link preservation/conflict, nonce lifecycle and null local credentials.
- [ ] Add nullable local credentials, unique Google identity links and nonce challenges; add migration 019.
- [ ] Implement official verifier and transactional service, including status checks, session reuse, stable sub, nonce/intent/session checks and rate limits.
- [ ] Wire the fixed routes with normalized errors; leave Google disabled until actual client ID is configured.
- [ ] Run Google tests and existing auth service/API/migration tests against the disposable database, plus server typecheck. Record results.

## Task 2: Browser and shared client UI (web adapter agent)

Files owned: apps/client/src/net/AuthApi.ts, scenes/AuthScene.ts, scenes/WorldScene.ts, ui/WorldHud.ts; new GoogleSignIn.ts/AccountPanel.ts and styles; client focused tests. Do not edit Android native files, server files, package manifests or lockfile.

- [ ] Write meaningful failing tests for Google login callbacks, cancellation/disposal, explicit password-confirmed linking, status/config fallback and late results.
- [ ] Consume fixed routes. Web uses official GIS-rendered button and a pre-fetched nonce before popup interaction; Android invokes native bridge only. No One Tap or automatic login.
- [ ] Add Menu → Konto with status, password confirmation, explicit link and normal close/back behavior; stay in panel on success.
- [ ] Preserve username/password/register/recover and integrate sign-out cleanup.
- [ ] Run focused client tests and client typecheck; report exact files, results and limitations.

## Task 3: Android native credential adapter (Android agent)

Files owned: apps/client/android/app/src/main/java/io/github/owca217/webmmorpg/GoogleSignInPlugin.java, MainActivity.java, dependency section only in app/build.gradle, optional focused native tests/docs fragment. Keep applicationId, signing and version untouched.

- [ ] Verify stable official Google Maven dependencies and Java Credential Manager API.
- [ ] Implement fixed plugin interface using GetSignInWithGoogleOption, web server client ID and nonce; normalize cancellation/errors and clear credential state on signOut.
- [ ] Reject overlapping requests, finish pending calls safely on destruction; no credentials in logs or preferences.
- [ ] Compile native Java with local Android toolchain, report result. Parent owns final Capacitor sync/build and version bump.

## Task 4: Configuration, integration, deployment and release (primary agent)

- [ ] Open Google Cloud clients panel and obtain user login if necessary. Prepare web/Android OAuth registrations for concrete project, origin, package and signing certificates; ask only for required final credential/security confirmation.
- [ ] Integrate adapters and run focused combined checks. Obtain fresh review, resolve material findings with regression tests.
- [ ] Configure actual public client ID on target Render service. Back up production database before additive migration/deploy, preserve source service and previous backups. Deploy the tested commit and verify terminal live state.
- [ ] Exercise real browser Google flow and password/link behavior using explicit user account selection as needed. Distinguish native live checks from build verification.
- [ ] Bump next available Android version (expected 0.1.33/code34), build signed APK/AAB for new server, validate manifests/signatures/assets, checksum delivery copies under primary artifacts/android.
- [ ] Document actual configuration, results and remaining external/device limits; preserve all previous releases.

## Progress and rulings

- 2026-11-11: Design approved. Existing isolated worktree on codex/battle-visual-refresh at bc4d196; five local Android 0.1.32 release changes preserved. No product changes at start.
- Ruling: Execute approved scope without another plan approval; public interfaces above allow adapter work in independently owned files. Native adapter/client agents must not install root packages or commit shared index.
- Source restore point: primary artifacts/restore-points/google-sign-in-20261111-192437 (HEAD archive + original 0.1.32 local changes, SHA-256 receipt).
- Local disposable PG16 server: 127.0.0.1:55433/google_auth_tests. Production credentials were never used by destructive tests.
- Tasks 1–3 implemented. Server targeted auth/API/migration/bootstrap/verifier tests: 40 passed across 7 files; server tsc passed. Client focused auth/UI/session/Android config tests: 87 passed across 9 files; web build passed. Native Java compile and 4 operation-gate JVM tests passed.
- Fresh read-only review found two Important defects: lifecycle lookup while holding transaction connection, and no Google retry after successful HTTP authentication followed by socket failure. Both reproduced by failing regression tests and fixed. Session grants now complete lifecycle reads after transaction release; socket failure resets only its active attempt and renders a fresh Google choice. Relevant regressions and targeted suites passed.
- Review rulings: actual OAuth configuration, local/store certificate registration and real browser/device sign-in remain mandatory external acceptance steps; none are treated as proven by builds. Existing 0.1.32 release changes remain preserved. Broader unrelated authentication behavior stays outside this feature.
- Google Cloud project created: borderland-chronicles-krystian / 216526194523. Support/contact email selection is awaiting the user's answer because it will appear to players. OAuth clients are not yet created; no placeholder ID is configured.
- Release 0.1.33/code34: Android web build/Capacitor sync passed; signed assembleRelease and bundleRelease passed (21s). Final package validation/delivery pending.
- Production DB backup completed before any deploy: primary serwer/wdrozenie-krystian/kopia-przed-google-2026-11-11T19-46-46-392Z; pg_dump 18.6 custom format, pg_restore list verified, TLS verify-full, 32 tables, 11 accounts and 11 characters. No production data changed.
- Ruling: Publish on a dedicated codex/google-sign-in branch and point only Krystian's service to it, preserving the old feature/mvp-vertical-slice branch used by the source account. Target live commit was ffccc814; connector can access Natalia only, so use the verified Krystian Render Dashboard for target changes.
