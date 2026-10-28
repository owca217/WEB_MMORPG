# Automatic character progression

The player chose automatic development with level. Victory awards durable experience; thresholds grow by 100 XP per level and progression stops at level 100. Defeat grants no experience. Old characters keep their existing level and appearance when migration 005 adds experience.

Strength, dexterity and vitality increase automatically. Derived melee/ranged damage, armor, maximum HP/AP and initiative are computed on the server from level. A level-up increases current HP only by the increase in maximum HP, preserving combat damage and injuries.

Combat uses each actor's damage and the defender's armor. Forest enemies scale with character level and become packs at higher levels. Balance is checked with deterministic fights across several levels so larger HP pools produce longer, winnable encounters. Battle snapshots expose relevant statistics to the HUD.

The character panel and world HUD display level, experience and automatic statistics. Victory feedback shows gained experience and levels after returning to the world. The Socket.IO flow verifies reward, automatic advancement, durable save and reload, and rejection of duplicate completion commands.

Implementation is divided between shared progression/persistence, battle mechanics, client UI and server integration. Verification uses focused tests, the full affected workspace suites, a production build, local browser QA, code review and the deployed commit's CI/Render status. Local database tests use only the disposable web_mmorpg_test database.

Balance verification with healthy characters and actual NPC turns produced victories after 4, 6, 10, 12, 14 and 32 rounds at levels 1, 5, 10, 25, 40 and 100 respectively. This deterministic strategy mixes movement, ranged attacks and melee; different player decisions can still lead to defeat.

Review identified a disconnect during loot persistence that could lose victory XP. The reward is now applied before awaiting loot I/O, so the disconnect save includes the new level and XP. A gated persistence regression reproduces the old loss and verifies the corrected ordering.
