# Szmaciany worek and mobile HUD

Add the published `rag-bag` definition in category `container`, with capacity 8 in version special data. Preserve existing catalogue edits. Distribution is outside this change; no automatic character grants.

Use existing instance parent IDs for storage. The server checks ownership, category, capacity, equipped state and nesting in a transaction serialized per character. An item stack occupies one place. Return the authoritative snapshot through the socket acknowledgement and player state. Clicking an equipped bag opens its contents, allows put/remove, and offers replacement through the existing picker.

Empty HUD slots show only a faded backpack SVG on black. In the compact phone layout, the panel can collapse to a 44px icon and expand without losing updates. Desktop resizing restores the panel.

Verify catalogue/capacity, atomic full and foreign item rejection, concurrent moves, socket authentication/persistence, HUD/panel interactions, and browser mobile layout. Build and sign Android 0.1.2 with the existing key; publish the web update and the APK.
