# NPC skins and starting merchant

Goal: give Boran, Ada and the new merchant Miro distinct generated pixel-art skins, and let players buy functional starting supplies in web and Android.

The existing Phaser world, Socket.IO transport and PostgreSQL item catalog remain the integration points. NPCs are stationary and use separate transparent full-body sprites. Miro stands at the settlement market near spawn. Clicking him opens a responsive shop with server-owned prices, item effects, quantity, total cost and current gold.

Implementation defaults: persistent gold, one-time 100 starting gold for existing and new characters, 15 gold per wolf encounter victory. Purchases: field bandage5, rag bag30, small healing potion10 (HP50), invigorating tonic12 (PA3). Equipment with no gameplay effect is excluded. Gold is a separate database balance, never overwritten by gameplay snapshots. Purchase receipts and fresh per-encounter reward tokens prevent duplicate charges/rewards. Purchases validate authentication, owner/session, same location, merchant range, battle state, item publication, quantities and funds; balance and inventory commit together.

- [ ] Generate and inspect three transparent NPC assets, save prompts, integrate loader and renderer with fallback.
- [ ] Add merchant contracts, migration008, wallet/receipt service, consumable seeds and focused transaction tests.
- [ ] Add authenticated shop/purchase socket handlers, pending-operation cleanup and idempotent victory gold.
- [ ] Add responsive shop and gold HUD, preserve input/session handling, test transport and scene integration.
- [ ] Verify local buy/relogin flow and NPC appearance, build signed Android0.1.6, deploy, check CI and publish APK.

Review focus: retry after uncertain ACK; disconnect while COMMIT completes; battle entry during purchase; container/pristine stack constraints; wallet persistence through stale gameplay saves. Destructive DB tests use only local web_mmorpg_test, sequentially across agents.
