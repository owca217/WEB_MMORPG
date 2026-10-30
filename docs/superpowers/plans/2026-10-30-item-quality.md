# Item Quality Implementation Plan

**Goal:** Add six persistent cosmetic item qualities and matching inventory icon frames in the web and Android clients.

**Architecture:** Quality is separate from rarity and numeric material `specialData.quality`. Published definitions specify the quality of newly granted items; each owned instance stores its quality permanently. Existing items and older payloads default to Normalna. No quality modifies statistics, effects, prices or rewards.

**Tech stack:** Existing TypeScript shared models, PostgreSQL, Phaser/DOM UI and Capacitor Android.

## User specification

| ID | Name | Frame |
| --- | --- | --- |
| BASIC | Zwykła | Gray #8b8b8b |
| NORMAL | Normalna | White #ffffff |
| GOOD | Dobra | Green #2ecc71 |
| EXCELLENT | Znakomita | Blue #3498db |
| PERFECT | Doskonała | Gold #ffd700 |
| MASTERWORK | Arcydzieło | Red #e74c3c |

Normalna is the stated migration default. No random quality generation is introduced.

## Tasks

- [x] Shared `itemQuality.ts`: six definitions, `ItemQuality`, default, validation/normalization and presentation helper. Optional quality in draft, inventory, shop and trade types preserves older callers. Two focused tests verified RED/GREEN.
- [x] Server migration012: constrained quality on versions and instances; preserve catalog CRUD, duplicates/history restore, inventory and merchant grants, same-quality stacks and partial trade transfers. Reject invalid supplied qualities. Verify defaults and durable round trips with focused database tests.
- [x] Client: one frame decorator across container/equipment helpers, other inventory/battle icons and editor preview. Keep empty slots unchanged. Display Polish names with colors, separate quality selector in editor, history comparison and shop/trade text labels. Verify six frames, old payload fallback and editor save.
- [x] Desktop and844x390 phone QA with six owned quality samples. Verify unchanged item statistics, persistent colors and empty slots.
- [x] Android0.1.17/code18 signed build and source review. Release gate: exact production deployment, required CI and public artifact verification.

## Review focus

- A metadata republish must not recolor an already owned item.
- Partial stack transfer must preserve quality and grants must not combine differently colored stacks.
- Invalid quality values must be rejected at authoring/storage boundaries, while missing old payload fields remain compatible.
- Frames must remain on real icons after image failure; empty container slots keep their existing appearance.
- Quality remains cosmetic, independent of rarity, equipment modifiers, consumable effects and numeric material quality.

## Ownership

Root owns shared models/helpers and this plan. Server worker owns server persistence, migration and database tests. Client worker owns client icons/editor/style and focused UI tests. Android worker owns versioning, release documentation and external build/publish helpers. Test database access is serial and exclusive; development data is preserved.

Verification: local full release suite passed737 tests (264client,422server,51shared). Desktop/phone screenshots show all six colors; reconnect and moving/equipping a Masterwork sword preserved quality, with42 melee damage unchanged. The final legacy-editor omission fix also passed6 focused persistence tests and the server TypeScript build; omitted quality retains the locked existing value, while explicit Normalna remains honored.
