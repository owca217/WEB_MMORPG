# Shared party battles

## Behavior

Starting an encounter automatically admits available online party members in the initiator's world location. Teammates have no distance restriction. The initiator must still be near the encounter. Parties contain at most five players; unavailable, offline or already fighting members do not join. There is no late joining.

All admitted characters share one arena, with distinct starting cells and individual turns, equipment, inventory and Auto settings. Allies are green, the local character is blue and enemies are red. A healing staff can heal a living ally within six cells and line of sight, for three AP, sharing the once-per-turn limit with self healing.

Group enemy count scales with party size and highest participant level. The encounter XP pool is divided by the initial number of participants. Each eligible participant receives their own loot and gold once. Shared battle XP bonuses count admitted, still online members of the same party, at 10% each, capped at 40%. A disconnected character keeps current HP and injuries, receives no unfinished encounter rewards and leaves the others able to continue.

## Implementation

- BattleService aliases a shared battle by participant, tracks personal Auto and equipment, and returns outcomes and training awards for each affected player.
- The socket server reserves all candidates before asynchronous trade cancellation, then rechecks ownership, membership and location before admission.
- Shared broadcasts send each viewer their own Auto setting. Only the active player's Auto timer runs.
- Settlement uses a unique encounter claim, registers pending reward operations for all participants before awaiting I/O, and applies each reward once.
- Disconnect waits for shared item mutations before removing a combatant. Presentation reads do not delay durable cleanup or reconnection.
- The Android release is 0.1.13, version code 14, signed with the existing key.

## Verification

Focused tests cover party admission across locations and distance, turn ownership, allied healing, consumable broadcasts, independent Auto, reward persistence, duplicate settlement, disconnects and shared item commits. A regression covers an excluded busy party member incorrectly contributing XP after another participant disconnects. Existing solo socket, weapon and healing tests remain covered.

Native browser QA uses two controlled local accounts, including a client at 844 by 390 pixels. Release checks include TypeScript builds, signed APK metadata and certificate, CI, exact Render revision and public artifact hashes. The primary checkout contains unrelated enemy work and is not modified by this task.
