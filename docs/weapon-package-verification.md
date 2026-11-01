# Weapon package verification

Implemented from the approved 2026-11-01 design: 66 published weapons, 11 categories, six levels (1, 5, 10, 15, 20, 30), 66 original transparent icons, wand proficiency, offensive shields and ADMIN catalog pagination. Skill trees, shops, drops and hosted deployment remain separate work.

## Automated checks

- Full client: 55 files, **411 tests passed**.
- Full shared package: 14 files, **68 tests passed**.
- Full server with a disposable database: 83 files, **514 tests passed**. Command: `npm run test -w @web-mmorpg/server -- --no-file-parallelism`, with `DATABASE_URL` pointing to local `web_mmorpg_test`.
- **993 tests passed** across these runs. The server checks include all 66 catalog definitions, exact icon HTTP bytes, metadata, migrations, reseeding, authored versions, inventory preservation, equipment, battles, injuries and proficiency persistence.
- `npm run build` passed for client, server and shared code. A subsequent client build with `VITE_BASE_PATH=/` prepared the local artifact. The existing large-chunk advisory remains.

The initial root test invocation omitted `DATABASE_URL`. Client/shared tests and 248 server unit tests passed, but 26 database suites failed during collection and 22 more skipped because several suites construct pools before an optional skip. The configured full server run above resolved that verification gap; the initial invocation was not reported as a full pass.

## Artwork and gallery

There are 66 distinct built-in image_gen originals, totaling 47,519,485 bytes. Each project copy matches its generated source byte-for-byte and has a distinct SHA-256 hash, 1254 x 1254 RGBA format and actual transparent pixels. Workers visually inspected every icon; the root agent sampled several families and reviewed the gallery in the browser. Three corner samples retain alpha 1/255 rather than zero. No pixels were edited; those edges are effectively transparent.

Prompts, source paths, dimensions, hashes and alpha observations are recorded in `docs/art/progression-weapons.json`. The gallery is `docs/art/progression-weapons.html`. The user reviewed it and said it was ideal; no additional visual changes followed.

## Balance

`node --import tsx scripts/verify-weapon-balance.mjs` reproducibly measured 432 loadouts, 3,888 encounter combinations and 3,240 comparisons. The maximum actual neutral score spread was 18.9% for one-handed weapons with a shield versus two-handed weapons, and 17.2% for wand with a shield versus bow. Continuous mitigation sensitivity gave 18.0% and 15.0%, respectively.

These are documented departures from an approximate 15% heuristic. The approved statistics are preserved. The proxy does not fully value movement, initiative, line of sight, injuries or PvP outcomes. See `docs/weapon-package-balance.md` and its adjacent JSON for the complete observations and limitations.

## Local persistence and test-account behavior

After verification, additive migrations and the insert-only catalog seed were applied to local `web_mmorpg_dev`: **66 progression definitions published**. Before/after hashes of prior gameplay fields matched for all **8 characters and 73 existing item instances**. No items were granted to real players.

On a separate disposable preview database, the actual InventoryService, EquipmentService, CharacterRepository, CharacterService and BattleService verified:

- Masterwork instance quality, minimum-level rejection and wrong-hand rejection.
- Level-30 wand with offensive shield: 120 ranged damage, 10% block, no melee attack or healing.
- A two-handed swap removes the shield and prevents re-equipping it.
- Level-30 staff healing power: 125.
- Auto defeated the fixed rat in two commands. Wand and shield each received 10 proficiency XP from one shared half-XP budget, and both values persisted through PostgreSQL.

ADMIN pagination, filter reset, stale responses and stat labels passed real UI component tests. The gallery was inspected in the in-app browser. Live game-browser QA could not be completed: automatic approval review rejected starting the game preview server, both as a hidden helper and in a controlled terminal session, without providing a more specific reason. No alternative listener was started to bypass that decision. The service-level test-account checks above completed without a game listener.

## Review and delivery

Independent runtime, content/client and whole-code reviews all passed specification and quality checks without important findings. The changes are retained in the managed weapon-package worktree. No push, pull request, merge or hosted deployment was performed; the original checkout was not overwritten.

Windows currently reserves TCP ports 55430-55529, including the previous PostgreSQL port 55432. The same local cluster was started with a process-only port override of 56432. Its stored configuration was not changed.

## Integration for the hosted release

The package was subsequently integrated onto live commit `d69626e`, preserving the newer weapon skill trees, inventory changes, game name and logout keyboard fix. Wand now has the same four-node ranged skill template as other attack families. Learning or resetting any tree retains wand XP and other learned skills. Accepted attack techniques also credit the offensive shield when its matching damage bonus contributes, using the same half-XP budget.

Local integration checks passed: all 77 shared tests, all 422 client tests, 35 focused server tests across nine files, and five skill-persistence socket tests. The latter verify wand XP through learning, reconnect and reset. All workspace builds passed. The first socket-suite setup exceeded its ten-second hook limit while the client tests/build ran concurrently; the isolated socket suite then completed in 5.14 seconds without changing timeouts.

A read-only hosted-database preflight found zero progression definitions, zero progression icons, no migration 016 and 28 owned item instances. The normal server startup applies the additive migration and catalog seed before accepting HTTP requests. This release adds catalog definitions and icons; it does not grant weapons to players or add shop/drop sources. Deployment and public verification results are recorded separately after the hosted release completes.
