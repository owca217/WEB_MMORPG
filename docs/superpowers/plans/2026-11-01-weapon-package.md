# Weapon Package Implementation Plan

> For agentic workers: implement tasks with superpowers:subagent-driven-development. The approved spec is the source of exact values.

**Goal:** 66 balanced iconed weapons, all11 categories usable, accessible in paginated ADMIN catalog.
**Architecture:** Additive item manifest/seeding, shared equipment/stat derivation, existing battle command and XP settlement, existing DB icon endpoint.
**Tech Stack:** TypeScript, PostgreSQL, Phaser/Vite, Vitest, built-in image generation.
**Spec:** docs/superpowers/specs/2026-11-01-weapon-package-design.md

## Global Constraints

- Preserve existing authored definitions, versions, instances, old XP and assets. No shop/loot/deploy/skill trees.
- Exact profiles, tier levels/qualities/rarities and roles come from the spec. All66 icons original transparentPNG.
- Integration tests only disposable local test DB; no development schema resets.
- Shared workspace: disjoint file ownership, no broad commits/staging and no nested subagents.

## Tasks

- [x] Task1 Runtime: wand proficiency/gear/offense, offensive-shield projection/bonuses/XP usage; meaningful regression tests and fixture compatibility. Own shared runtime and shared/server combat/equipment/mastery tests, BattleService. Root owns client edits and content agent owns item metadata.
- [x] Task2 Content: explicit66-item manifest, safe stableUUIDs, seed options and additive existing metadata upgrade, exact profiles and pipeline tests. Own item content/seeding/statRegistry, migration if needed, catalog integration tests. Root supplies original icon files at agreed paths; no placeholders.
- [x] Task3 Client: catalog pagination and stat labels/proficiency display compatibility, focused UI tests. Root implementation.
- [x] Task4 Assets: generate/inspect/save66 originals, prompt manifest and gallery. Root orchestrates one built-in call per asset and original copy.
- [x] Task5 Verify/review: focused runtime/pipeline/client checks, balance scenarios, builds, independent review; local seed preserving player state and test-account QA. Record results/limits and leave coherent reviewable worktree.

## Review Focus

- Existing seeded metadata flags must not hide newly allowed profile codes.
- Offensive-shield must add matching damage once, never healing/unarmed/2H, and share XP budget.
- Old mastery maps missing wand must normalize and round-trip without data loss.
- Every seeded icon must exist and serve; reseed must preserve authored definitions/instances.
- Pagination must retain filters and reject stale replies.
