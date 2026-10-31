# Original project and official release integration — 2026-10-31

## Integrated source

The original project at `C:/Users/kgkg1/Documents/ChatGPT/WEB_MMORPG` now contains the tested interface, persistent inventory cell ordering, desktop RMB options/player actions, independent party/trade windows, and silhouette equipment layout.

Existing original-only work was ported additively into the newer game: five enemy sprites/definitions/world encounters and battle presentation, eleven authored starter weapon catalog records/icons, and ADMIN catalog icons with fallback. Current eastern-forest/portal/respawn, party battles/healing/equipment/training, permanent backpack/qualities, account/auth and ADMIN category features are preserved. Authored fixed enemies retain XP-only rewards; existing wolf/forest loot remains unchanged.

The tested source commit is `100bf4a` (base `7f2b12b`). Integration also retains the original design commit `04b9fd4`. Original uncommitted work is separately preserved at local snapshot `005067095370bd767611a1f29c150ac600db4ee8`, branch `backup/original-before-interface-20261031-043709`.

Both original and tested working trees were archived before integration under `C:/Users/kgkg1/Documents/ChatGPT/WEB_MMORPG-backups/before-interface-integration-20261031-043709/`, with file manifests, SHA256 checksums and binary patches. Original archive SHA256: `740244b11cd076d018e6b0eb23abe56d26dc7ddb216854ff01018338d57ab9d1`. Remote attachments remain local and are excluded from the release commit.

## Verification

- Full client:54 files,389 tests passed (`npm run test -w @web-mmorpg/client -- --maxWorkers=2`).
- Full server:77 files,464 tests passed (`npm run test -w @web-mmorpg/server -- --no-file-parallelism --maxWorkers=1`).
- Shared:13 files,53 tests passed (`npm run test -w @web-mmorpg/shared -- --maxWorkers=2`).
- All906 tests passed. Server tests used a new isolated PostgreSQL cluster onlocalhost5434 and its disposable `web_mmorpg_test`, never player/preview/production databases.
- `npm run build` passed for all workspaces. Existing large-bundle warning remains.
- Android0.1.25/versionCode26 built; v2 debug signature verified with apksigner. Artifact:`artifacts/android/WEB-MMORPG-0.1.25-debug.apk`; SHA256:`18a58f4ddb0b4267b5489df23717c3ba1fcdd1c8001892f20877659d0dbc8722`. It uses the official HTTPS backend. No physical-device or app-store release test was performed.

## Production target and migration gate

User explicitly confirmed publishing to the official game and the Render workspace. Service:`web_mmorpg_server`, `srv-daloue2jnfac73ab5v30`, workspace`tea-daloot2jnfac73aak4r0`, official URL`https://web-mmorpg-server.onrender.com/`, automatic deployment on commits to`feature/mvp-vertical-slice`. Current live baseline is`7f2b12b`, deploy`dep-dbigcu6417fc738in330`.

Read-only production preflight: migration013,9accounts/9characters/25item instances,11contained rows,9permanent backpacks. Ownership/capacity/assignment/backfill constraint blockers are zero. Legacy items in unassigned bags remain preserved.

Migration014 adds and backfills container positions and constraints. Old writers must be drained before migration; old-application rollback alone is unsafe afterward. Required release sequence: maintenance mode, restart/drain old instances, completed logical production export, deploy new server/migration, compare identity/count/position invariants, remove maintenance, verify live UI and logs. Use `[skip render]` while preparing source/CI so publishing code cannot bypass this migration gate.

At preparation time the connected Render tools could read/preflight/trigger deploys but could not create exports or set maintenance mode. Dashboard access required the user's existing Google login. No production database mutation or deploy has occurred at this preparation stage.

## Completed production release — 2026-10-31

The user enabled maintenance, restarted the old service, and confirmed the completed downloaded database export. Render events confirmed maintenance and restarts before publication. The release was fast-forwarded to `feature/mvp-vertical-slice`; PR #18 is merged. Render recorded the expected skipped automatic deployment for `[skip render]`, followed by the explicitly triggered release.

Production commit `3098cd0e286dada74d50b051447f02d76954f90d` became live in deploy `dep-dbirnch42hec73bb3b6g` at `2026-10-31T09:59:01Z`. Production migration 014 and its validated constraints were verified read-only. All 9 accounts, 9 characters, 25 item instances and 9 permanent backpacks were preserved; all 22 consistency anomaly counts were zero. The 11 authored starter weapons were published with the expected metadata, statistics and icons (catalog grew from 23 to 34).

Maintenance is disabled. Public verification passed: official HTML and current JavaScript/CSS return HTTP 200, all five enemy PNGs load, an unauthenticated Socket.IO connection succeeds, and the session endpoint correctly returns HTTP 401 without authorization. The official login screen renders with the new theme and no browser errors. This production check did not create accounts or modify player inventories; gameplay interactions were covered by the earlier local tests and preview verification.

Both production-branch workflows passed: Feature CI run 41190781306 and Android APK run 41190781400. Android 0.1.25/versionCode 26 remains the prepared APK for the official backend. Local release receipts and public verification results are retained under ignored `artifacts/release/`, with official UI proof under `artifacts/ui/`.
