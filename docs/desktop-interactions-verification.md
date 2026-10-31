# Desktop interactions and floating social windows — 2026-10-31

Implemented in the existing managed checkout and local preview at `http://127.0.0.1:5174/WEB_MMORPG/`.

## Delivered behavior

- Menu → Opcje → Interakcja prawym przyciskiem myszy. Enabled by default for mouse input, saved in browser localStorage. Opt-out restores primary-click entity interaction. Touch/pen taps retain their existing interaction behavior.
- With the setting enabled, primary clicks on map, NPCs, monsters and other players select movement only. RMB opens NPC/monster/player actions; RMB/middle clicks never select a movement destination. Portals remain primary-click/touch navigation into their zone. Native browser context menus are suppressed only on the game canvas and player menu.
- Player menu uses the exact current other-player ID and offers party invitation and trade invitation. Self, absent/departed players and stale menu callbacks are guarded. Dismissing the menu on the map preserves the same primary click's movement.
- Social now opens friends only; party/trade tabs and online-player pickers are removed. Separate party/trade windows preserve existing protocol, consent, pending actions, offer revisions, draft, eligibility and inventory authority. Menu provides reopening shortcuts on all devices.
- Windows drag by their headers, clamp to the visual viewport/safe areas, preserve position across renders/reopening and scroll independently. Party rules are collapsed by default. Empty party window measured 320×212px; trade 360×176px on desktop. Visible information windows do not block map movement; typing still blocks controls.
- New party/current active trade and incoming invitations open once, including scene entry, without stealing focus. Same-state polls respect manual closure. Escape/native Back close the foreground surface. Floating layers remain bounded below chat/options/context menus. Open HUD Menu raises above floating windows and participates in foreground closure.

## Focused verification

81 distinct relevant tests passed across 10 files; only directly affected suites were run.

| Command suffix after `npm run test -w @web-mmorpg/client --` | Passing tests |
| --- | ---: |
| `tests/worldSceneProgression.test.ts` | 21 |
| `tests/worldHud.test.ts tests/gameWindows.test.ts tests/nativeLifecycle.test.ts` | 20 |
| `tests/interactionPreferences.test.ts tests/worldEntitiesRenderer.test.ts` | 15 |
| `tests/desktopInteractionPanels.test.ts` | 6 |
| `tests/floatingGameWindow.test.ts tests/socialPanel.test.ts tests/chatSocialControllers.test.ts` | 19 |

The world-scene event-order regression, pointer/portal policies, blocked-storage fallback, drag-release shielding and outside-dismiss focus regression were reproduced before their fixes. Final changed HUD/foreground/native suites passed after the compact-menu stacking correction. `npm run build -w @web-mmorpg/client` passed TypeScript and Vite; the existing large Phaser chunk warning remains. Scoped `git diff --check` passed with only the repository's LF/CRLF notice.

## Browser acceptance

Used an isolated `localhost` origin and the existing disposable preview account for movement/preference tests, preserving owca/yuna's session and inventory. Confirmed:

- Actual RMB player menu, exact action labels, NPC RMB menu, LPM movement onto an NPC without opening its menu, and restored LPM interaction after switching off.
- Preference remains off after a full reload, then was restored on.
- Friends-only Social; separate party/trade windows; actual header dragging and changed bounds.
- Compact 844×390 viewport clamps both windows and scrolls the expanded Menu. Options remains clickable even when a dragged Trade overlaps the Menu area. Temporary viewport override was reset.
- Final user preview remains connected on owca/yuna with the Options, Party and Trade surfaces available. Disposable tab closed. No invitations/messages/trades sent to the user's account.

Screenshots:

- `artifacts/ui/current-desktop-interactions.jpg` — final owca/yuna preview with Options and both windows.
- `artifacts/ui/current-player-context-menu.jpg` — real other-player RMB menu.
- `artifacts/ui/current-social-floating.jpg` — separated dragged windows.
- `artifacts/ui/current-social-compact.jpg` — compact acceptance.

No backend/database changes, production publishing, push, commit, or new APK were performed for this desktop request. Actual two-account trade completion and physical touch hardware were not exercised in the browser; relevant existing UI consent/revision/draft tests and touch pointer cases passed.
