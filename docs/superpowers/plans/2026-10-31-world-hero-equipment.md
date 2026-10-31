# World hero equipment and resources implementation plan

**Goal:** Move the level number before the nickname, replace hero labels with standard equipment slots, and show compact gold beside action points with exact-value disclosure.

**Architecture:** Keep the existing authoritative player/inventory state and equipment mutations. WorldHud owns two small components: HudEquipmentSlots and GoldDisplay. Existing inline inventory drag controller discovers equipment targets; slot clicks open the existing CharacterPanel equipment tab.

**Spec:** User browser comments of 2026-10-31: numeric level before nickname; remove Wędrowiec/Poziom labels; 36×36px gear slots with category icons when empty; remove AP ticks; gold alongside AP, truncating integer k/kk units from1000, exact value on hover/tap.

- [x] Add stable 8-slot equipment component with shared dimensions/category icons, quality and authoritative item rendering; focused component tests.
- [x] Add compact gold formatter/disclosure with threshold and hover/tap/cleanup tests, preserving unknown/loading values.
- [x] Add CharacterPanel.showEquipment(slot?) without changing existing mutation authority; focused test.
- [x] Integrate WorldHud heading, hero, AP/gold row and cleanup; wire existing WorldScene equipment flow and verify the new HUD target.
- [x] Run relevant tests and final client build, inspect desktop/compact preview, save screenshot and receipt. Preserve existing dirty work, owca/yuna account and inventory, no backend/database/publishing changes.

Browser correction: bag hover must not commit a transfer on the way to HUD equipment, so all pointer transfers now commit on release. Existing local PostgreSQL/backend were safely restarted for acceptance. Receipt: `docs/world-hero-equipment-verification.md` (97 focused tests and final build passed).
