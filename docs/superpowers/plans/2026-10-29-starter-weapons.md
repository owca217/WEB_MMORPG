# Starter Weapons Implementation Plan

> **For agentic workers:** Implement the independent icon and catalog tasks in parallel. Use existing seed and icon storage conventions.

**Goal:** Add one level-one common weapon and a generated transparent PNG icon for each of the 11 system weapon subcategories.

**Architecture:** Store original PNG assets in `apps/server/assets/items/`. Seed stable published item definitions and their icons through the existing PostgreSQL item icon endpoint. Preserve existing authored definitions and player inventories on every reseed. Show icons in the existing catalog/inventory UI.

**Tech Stack:** TypeScript, PostgreSQL, existing Express icon route, built-in image generation.

**Scope:** User requested generated starter weapons and item icons. Polish names, ordinary materials, small starter stats, no new combat/equipment mechanics, shop stock, player grants, deployment, dependencies, or changes to unrelated work.

## Content

| ID / subcategory | Polish name |
| --- | --- |
| starter-sword / sword | Miecz rekruta |
| starter-axe / axe | Topór drwala |
| starter-hammer / hammer | Młot czeladnika |
| starter-dagger / dagger | Sztylet wędrowca |
| starter-spear / spear | Włócznia strażnika |
| starter-bow / bow | Łuk myśliwski |
| starter-crossbow / crossbow | Kusza wartownika |
| starter-staff / staff | Kostur ucznia |
| starter-wand / wand | Różdżka nowicjusza |
| starter-offensive-shield / offensive-shield | Puklerz milicjanta |
| starter-two-handed / two-handed | Dwuręczny miecz milicji |

## Tasks

- [x] Generate and visually inspect eleven individual transparent item icons, one image-generation call per asset; copy originals into the workspace and record prompts.
- [x] Add starter weapon definitions with metadata-approved stats and special fields; extend the seed for icon references, minimum level, value and tags while preserving old defaults. Seed image bytes idempotently with stable keys and absolute server icon URLs.
- [x] Verify catalog coverage, creator validation, public icon retrieval, reseed idempotency and preservation of authored definitions in focused database tests. Use a separate disposable test database.
- [x] Display existing iconUrl in catalog/inventory using safe DOM operations; retain fallback for items without icons. Run directly relevant UI checks.
- [x] Seed the local development catalog, confirm eleven definitions and all icon endpoints, and build affected workspaces. Record actual results without claiming deployment.
- [x] Create a local gallery linking all eleven original icons and showing names/types/basic stats for review.

## Review Focus

Cover all eleven subcategories, including offensive shield and two-handed. Do not invent unsupported weaponFamily values. Preserve existing items/versions on conflict. Ensure icons resolve against the server for separate-origin clients. Never run schema-resetting integration tests against the player's development database.

## Verification results

- `npm run test -w @web-mmorpg/client -- tests/adminCatalog.test.ts tests/inventoryPanel.test.ts`: 15 passed; the two new icon cases failed before implementation and passed afterward.
- With `DATABASE_URL` pointing to a separate disposable test database, `npm run test -w @web-mmorpg/server -- tests/starterWeapons.test.ts`: 3 passed after verifying the missing-weapons failure before implementation.
- On that disposable database, `npm run test -w @web-mmorpg/server -- tests/itemMetadata.test.ts tests/itemCreatorE2E.test.ts tests/postgresIconStorage.test.ts`: 9 passed.
- `npm run build -w @web-mmorpg/client` and `npm run build -w @web-mmorpg/server`: passed. Client retains the existing bundle-size warning.
- Local development seed: 11 published weapons; 11 PNG endpoints returned HTTP 200 and correct PNG sizes; character and inventory-instance counts unchanged.
- Focused independent code review found no actionable issues. All 11 original PNGs were inspected; generation metadata records transparency and byte-for-byte copies.
- Gallery: `docs/art/starter-weapons.html`. Not deployed; no weapons granted and no combat/equipment mechanics added.
