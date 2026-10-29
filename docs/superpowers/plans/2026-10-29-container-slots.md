# Four container slots in the game HUD

The user explicitly chose four slots directly in the small world HUD, replacing its Ekwipunek button. Clicking a slot opens a picker containing owned category `container` items. Assignment, replacement, movement between slots and clearing are persisted on the character inventory. Existing ordinary items remain stored and are omitted from this picker.

Keep the canonical category ID `container`, rename its visible label to Pojemniki, and keep `backpack` separate. Add nullable `item_instances.container_slot` with range 0–3 and a partial uniqueness constraint per character. Existing `container_instance_id` remains the storage-parent relationship. A whole stack represents one assigned instance and cannot occupy several slots.

The authoritative server validates socket identity, ownership, category, slot range and storage parent before any changes. Changes are serialized per character, validated before clearing the previous occupant, and returned as a dense four-slot tuple in the inventory snapshot. Optional snapshot fields keep older clients and test fixtures compatible. Clone assignments in the client store.

Verification covers DB persistence/constraints, invalid and foreign item rejection, atomic movement/concurrency, legacy migrations, socket ownership and reconnect, HUD/picker interactions, and actual browser preview. Publish the web change and a signed Android 0.1.1 APK using the existing signing key so installed clients can receive the same HUD change.
