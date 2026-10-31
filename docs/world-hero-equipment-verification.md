# World hero equipment and gold — 2026-10-31

Implemented and accepted in the existing local preview checkout.

## Delivered

- Numeric level before nickname in the rail and compact topbar (`1 yuna`). Removed the Wędrowiec/Poziom presentation labels beside the portrait.
- Eight standard36×36px slots beside the portrait: weapon, shield, helmet, chest, gloves, pants, boots, cloak. Empty slots have distinct category SVGs; equipped items use the existing quality/icon presentation. Buttons remain stable across updates.
- Clicking a slot opens the existing CharacterPanel equipment tab and focuses the matching slot. Existing inline backpack drag targets equip through the authoritative equipment acknowledgement; two-handed and level requirements retain existing validation.
- AP ticks removed. Plain AP and gold share two columns at the same height. Gold displays integers below1000, floor-thousands `k` from1000, and floor-millions `kk` from1000000, with no decimal part. Examples:999→999,1000→1k,1999→1k,999999→999k,1000000→1kk,50000000→50kk.
- Exact gold is available in a local tooltip on hover/focus or first click/tap. First activation pins it despite preceding hover/focus, second closes it; outside/Escape dismiss. Unknown balance remains `—`. Read-only tooltip does not become a blocking game window and stays within the rail.
- Browser acceptance found the old bag-hover transfer intercepted the natural path from backpack to HUD gear. Bag transfers now commit on release, matching cell/equipment drops. Passing over a bag only highlights it, allowing the selected item to reach equipment safely.

## Focused checks

97 distinct relevant tests passed across7 files; no unrelated full suite was run:

| Suite (after `npm run test -w @web-mmorpg/client --`) | Tests |
| --- | ---: |
| `tests/worldHud.test.ts` | 11 |
| `tests/worldSceneProgression.test.ts` | 22 |
| `tests/containerContentsPanel.test.ts` | 25 |
| `tests/weaponTrainingUi.test.ts` | 10 |
| `tests/hudEquipmentSlots.test.ts` | 4 |
| `tests/goldDisplay.test.ts` | 10 |
| `tests/inventoryDragController.test.ts` | 15 |

New behaviors were covered by focused red/green regressions, including HUD gear integration, gold activation ordering and crossing a bag before equipment release. After the release-only correction, container/scene integration47 tests passed. Final `npm run build -w @web-mmorpg/client` passed TypeScript and Vite; existing large Phaser bundle warning remains. Scoped diff checks passed.

## Browser acceptance and runtime

- User preview remains connected on owca/yuna, preserving its account, role, gold and inventory. Header/empty category icons/AP+gold layout and first-click exact tooltip were inspected. All8 equipment cells measured exactly36×36px; no horizontal rail overflow. AP and gold numeric centers align.
- On the existing disposable localhost account, actual mouse dragging of a shield past a bag to the HUD equipped the shield only after release; the shield appeared with its quality frame. Clicking that HUD slot opened Uzbrojenie with the shield slot focused. The test shield was then unequipped and restored to its original permanent-backpack cell1. No user-account gameplay mutations occurred.
- Compact844×390 preview checked: rail remains scrollable, exact tooltip stays within its width, first click opens, and no horizontal overflow. Temporary viewport override reset and disposable tab closed. Touch event ordering has focused automated coverage; physical phone hardware was not exercised.
- The pre-existing local PostgreSQL/backend had stopped before browser acceptance (user screenshots also showed disconnection). Existing PostgreSQL cluster was restarted without initialization, reset or data edits; read-only check confirmed owca ADMIN/yuna and migrations001–014. Backend3002 restarted against the same preview DB. The user's saved session resumed after reload.

Current runtime sessions: backend75400, PostgreSQL launcher82195 (do not interrupt its waiting launcher), Vite12676. PostgreSQL PID1668804 onlocalhost5433.

Screenshots:

- `artifacts/ui/current-hud-equipment-gold.jpg` — final user preview.
- `artifacts/ui/current-hud-equipment-equipped.jpg` — real equipped test shield and exact gold.
- `artifacts/ui/current-hud-equipment-phone.jpg` — compact preview.

No backend source/schema change, production publishing, push, commit, or new APK was performed for this request.

## Follow-up: equipment around the character silhouette

The user's next request replaced the4×2 equipment grid with a paperdoll layout. Existing portrait is now centered inside the equipment grid; helmet is above, boots below, chest/gloves/weapon on the left and cloak/pants/shield on the right. Named CSS grid areas use columns36/82/36px,12px column gaps and five36px rows with4px gaps (178×196px). All existing buttons, category art, quality frames, drop metadata and callbacks are retained. Drag visibility remains explicit on the eight slot buttons; the decorative portrait follows the surrounding rail.

Changed only HudEquipmentSlots.css and WorldHud.ts/.css. `npm run test -w @web-mmorpg/client -- tests/worldHud.test.ts tests/hudEquipmentSlots.test.ts` passed15 tests; `npm run build -w @web-mmorpg/client` passed with the existing bundle-size warning. Browser confirmed all8 cells36×36px. At844×390 every equipment slot remains inside the visible rail (lowest edge306px, rail bottom334px), no horizontal overflow. Viewport reset; user session/account/inventory unchanged, preview tab retained.

Screenshots: `artifacts/ui/current-equipment-paperdoll.jpg` and `artifacts/ui/current-equipment-paperdoll-phone.jpg`. No APK/production publishing for this presentation change.
