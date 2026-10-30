import type {
  BattleCommand,
  BattleId,
  GeneratedArena,
  HexCoord,
  PlayerId
} from "@web-mmorpg/shared";
import { isBattleAttackEnabled, mitigatedBattleDamage, STAFF_HEAL_AP_COST } from "@web-mmorpg/shared";
import { findPath, hexDistance, hexKey } from "./hex";
import { hasLineOfSight } from "./lineOfSight";
import {
  applyDamageWithInjuries,
  applyEndTurnInjuries,
  effectiveInitiative,
  movementApCost,
  rangedAttackApCost,
  type CombatantState
} from "./injuries";

export interface CreateCombatantInput extends Omit<CombatantState, "ap"> { }

export interface BattleState {
  id: BattleId;
  seed: number;
  round: number;
  activeCombatantId: string;
  turnOrder: string[];
  arena: GeneratedArena;
  combatants: Record<string, CombatantState>;
  finished: boolean;
}

export type BattleResult =
  | { ok: true; state: BattleState }
  | { ok: false; code: string; message: string };

type ActorValidationResult =
  | { ok: true; combatant: CombatantState }
  | { ok: false; code: string; message: string };

export interface CreateBattleStateInput {
  id: BattleId;
  seed: number;
  arena: GeneratedArena;
  combatants: CreateCombatantInput[];
}

function reject(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}

function cloneState(state: BattleState): BattleState {
  return {
    ...state,
    arena: {
      ...state.arena,
      cells: [...state.arena.cells],
      blockedCells: [...state.arena.blockedCells],
      coverCells: [...state.arena.coverCells],
      playerStartCells: [...state.arena.playerStartCells],
      enemyStartCells: [...state.arena.enemyStartCells]
    },
    turnOrder: [...state.turnOrder],
    combatants: Object.fromEntries(
      Object.entries(state.combatants).map(([id, combatant]) => [
        id,
        {
          ...combatant,
          position: { ...combatant.position },
          injuries: [...combatant.injuries],
          ...(combatant.combatStats ? { combatStats: { ...combatant.combatStats } } : {})
        }
      ])
    )
  };
}

export function createBattleState(input: CreateBattleStateInput): BattleState {
  if (input.combatants.length === 0) {
    throw new Error("Battle requires at least one combatant.");
  }

  const ordered = [...input.combatants].sort((a, b) => {
    const diff = effectiveInitiative({ ...b, ap: 0 }) - effectiveInitiative({ ...a, ap: 0 });
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const combatants: Record<string, CombatantState> = {};
  for (const inputCombatant of input.combatants) {
    combatants[inputCombatant.id] = {
      ...inputCombatant,
      position: { ...inputCombatant.position },
      injuries: [...inputCombatant.injuries],
      ...(inputCombatant.combatStats ? { combatStats: { ...inputCombatant.combatStats } } : {}),
      ap: 0
    };
  }

  const activeCombatantId = ordered[0]!.id;
  combatants[activeCombatantId]!.ap = combatants[activeCombatantId]!.maxAp;

  return {
    id: input.id,
    seed: input.seed,
    round: 1,
    activeCombatantId,
    turnOrder: ordered.map((combatant) => combatant.id),
    arena: input.arena,
    combatants,
    finished: false
  };
}

function occupiedKeys(state: BattleState, exceptId?: string): Set<string> {
  return new Set(
    Object.values(state.combatants)
      .filter((combatant) => combatant.id !== exceptId && combatant.hp > 0)
      .map((combatant) => hexKey(combatant.position))
  );
}

function battleFinished(combatants: Record<string, CombatantState>): boolean {
  const playerAlive = Object.values(combatants).some((c) => c.side === "player" && c.hp > 0);
  const enemyAlive = Object.values(combatants).some((c) => c.side === "enemy" && c.hp > 0);
  return !playerAlive || !enemyAlive;
}

function advanceTurn(state: BattleState): BattleState {
  const next = cloneState(state);
  const currentIndex = next.turnOrder.indexOf(next.activeCombatantId);
  let nextIndex = currentIndex;

  for (let attempts = 0; attempts < next.turnOrder.length; attempts += 1) {
    nextIndex = (nextIndex + 1) % next.turnOrder.length;
    const candidate = next.combatants[next.turnOrder[nextIndex]!];
    if (candidate && candidate.hp > 0) break;
  }

  if (nextIndex <= currentIndex) next.round += 1;
  next.activeCombatantId = next.turnOrder[nextIndex]!;
  const active = next.combatants[next.activeCombatantId]!;
  active.ap = active.maxAp;
  delete active.healingUsedThisTurn;
  return next;
}

/** Remove a departing owner without applying end-turn damage or leaving a blocked turn. */
export function removeBattleCombatant(state: BattleState, combatantId: string): BattleState {
  if (!state.combatants[combatantId]) return cloneState(state);
  const next = cloneState(state), index = next.turnOrder.indexOf(combatantId), wasActive = next.activeCombatantId === combatantId;
  delete next.combatants[combatantId];
  next.turnOrder = next.turnOrder.filter(id => id !== combatantId);
  next.finished = battleFinished(next.combatants);
  if (wasActive && next.turnOrder.length > 0) {
    let nextIndex = Math.max(0, index) % next.turnOrder.length;
    if (nextIndex === 0 && index > 0) next.round++;
    for (let attempts = 0; attempts < next.turnOrder.length; attempts++) {
      const candidate = next.combatants[next.turnOrder[nextIndex]!]!;
      if (candidate.hp > 0) { next.activeCombatantId = candidate.id; candidate.ap = candidate.maxAp; delete candidate.healingUsedThisTurn; break; }
      nextIndex = (nextIndex + 1) % next.turnOrder.length;
      if (nextIndex === 0) next.round++;
    }
  }
  return next;
}

function validateCommonActor(state: BattleState, combatantId: string): ActorValidationResult {
  if (state.finished) return reject("BATTLE_FINISHED", "Battle is already finished.");
  const combatant = state.combatants[combatantId];
  if (!combatant) return reject("COMBATANT_NOT_FOUND", "Combatant does not exist.");
  if (state.activeCombatantId !== combatantId) {
    return reject("NOT_ACTIVE_TURN", "This combatant is not active.");
  }
  if (combatant.hp <= 0) return reject("COMBATANT_DOWN", "Combatant is incapacitated.");
  return { ok: true, combatant };
}

function validatePlayerActor(
  state: BattleState,
  actorPlayerId: PlayerId,
  combatantId: string
): ActorValidationResult {
  if (state.finished) return reject("BATTLE_FINISHED", "Battle is already finished.");
  const combatant = state.combatants[combatantId];
  if (!combatant) return reject("COMBATANT_NOT_FOUND", "Combatant does not exist.");
  if (combatant.ownerPlayerId !== actorPlayerId) {
    return reject("NOT_OWNER", "You do not own this combatant.");
  }
  if (state.activeCombatantId !== combatantId) {
    return reject("NOT_ACTIVE_TURN", "This combatant is not active.");
  }
  if (combatant.hp <= 0) return reject("COMBATANT_DOWN", "Combatant is incapacitated.");
  return { ok: true, combatant };
}

function validateNpcActor(state: BattleState, combatantId: string): ActorValidationResult {
  const validation = validateCommonActor(state, combatantId);
  if (!validation.ok) return validation;
  if (validation.combatant.side !== "enemy" || validation.combatant.ownerPlayerId !== undefined) {
    return reject("NOT_NPC", "Only a server-owned enemy can use an NPC command.");
  }
  return validation;
}

function targetCombatant(state: BattleState, targetId: string): CombatantState | null {
  return state.combatants[targetId] ?? null;
}

function applyAttack(
  state: BattleState,
  attackerId: string,
  targetId: string,
  damage: number,
  apCost: number
): BattleState {
  const next = cloneState(state);
  const attacker = next.combatants[attackerId]!;
  const target = next.combatants[targetId]!;
  const armorDamage = mitigatedBattleDamage(damage, target.combatStats?.armor ?? 0);
  const mitigatedDamage = mitigatedBattleDamage(damage, target.combatStats?.armor ?? 0, target.combatStats?.blockPercent ?? 0);
  if (mitigatedDamage < armorDamage) target.shieldBlocks = (target.shieldBlocks ?? 0) + 1;
  attacker.ap -= apCost;
  next.combatants[targetId] = applyDamageWithInjuries(target, mitigatedDamage, next.seed + next.round);
  next.finished = battleFinished(next.combatants);
  return next;
}

function applyValidatedCommand(
  state: BattleState,
  actor: CombatantState,
  command: BattleCommand
): BattleResult {
  if (command.type === "healSelf" || command.type === "healAlly") {
    const power = actor.combatStats?.healingPower ?? 0;
    if (!Number.isFinite(power) || power <= 0) return reject("HEAL_NO_STAFF", "Załóż kostur leczący przed walką.");
    if (actor.healingUsedThisTurn) return reject("HEAL_ALREADY_USED", "Kostur został już użyty w tej turze.");
    const target = command.type === "healSelf" ? actor : state.combatants[command.targetId];
    if (!target || target.hp <= 0 || target.side !== actor.side) return reject("INVALID_HEAL_TARGET", "Wybierz żywego sojusznika.");
    if (command.type === "healAlly" && target.id !== actor.id) {
      if (hexDistance(actor.position, target.position) > 6) return reject("OUT_OF_RANGE", "Sojusznik jest poza zasięgiem.");
      if (!hasLineOfSight(actor.position, target.position, new Set(state.arena.blockedCells.map(hexKey)))) return reject("NO_LINE_OF_SIGHT", "Przeszkoda zasłania sojusznika.");
    }
    if (target.hp >= target.maxHp) return reject("NO_HEAL_EFFECT", "Cel ma pełne HP.");
    if (actor.ap < STAFF_HEAL_AP_COST) return reject("INSUFFICIENT_AP", `Leczenie wymaga ${STAFF_HEAL_AP_COST} AP.`);
    const amount = Math.min(target.maxHp - target.hp, Math.floor(power));
    if (amount <= 0) return reject("NO_HEAL_EFFECT", "Kostur nie przywróci teraz HP.");
    const next = cloneState(state), healer = next.combatants[actor.id]!;
    next.combatants[target.id]!.hp += amount; healer.ap -= STAFF_HEAL_AP_COST; healer.healingUsedThisTurn = true;
    return { ok: true, state: next };
  }
  if (command.type === "move") {
    const allowed = new Set(state.arena.cells.map(hexKey));
    const blocked = new Set(state.arena.blockedCells.map(hexKey));
    for (const key of occupiedKeys(state, actor.id)) blocked.add(key);

    const path = findPath(actor.position, command.target, blocked, allowed);
    if (!path) return reject("NO_PATH", "No valid path to target cell.");

    const cost = movementApCost(actor, path.length);
    if (actor.ap < cost) return reject("INSUFFICIENT_AP", "Not enough AP to move there.");

    const next = cloneState(state);
    next.combatants[actor.id]!.ap -= cost;
    next.combatants[actor.id]!.position = { ...command.target };
    return { ok: true, state: next };
  }

  if (command.type === "meleeAttack" || command.type === "rangedAttack") {
    if(!isBattleAttackEnabled(actor,command.type))return reject("WEAPON_ATTACK_UNAVAILABLE","Założona broń nie pozwala na ten atak.");
    const target = targetCombatant(state, command.targetId);
    if (!target || target.hp <= 0) return reject("INVALID_TARGET", "Target is not available.");
    if (target.side === actor.side) return reject("INVALID_TARGET", "Cannot attack an ally.");

    const distance = hexDistance(actor.position, target.position);

    if (command.type === "meleeAttack") {
      const cost = 2;
      if (actor.ap < cost) return reject("INSUFFICIENT_AP", "Not enough AP.");
      if (distance !== 1) return reject("OUT_OF_RANGE", "Melee target must be adjacent.");
      return { ok: true, state: applyAttack(state, actor.id, target.id, actor.combatStats?.meleeDamage ?? 20, cost) };
    }

    const cost = rangedAttackApCost(actor);
    if (actor.ap < cost) return reject("INSUFFICIENT_AP", "Not enough AP.");
    if (distance > 6) return reject("OUT_OF_RANGE", "Ranged target is too far away.");
    const blockers = new Set(state.arena.blockedCells.map(hexKey));
    if (!hasLineOfSight(actor.position, target.position, blockers)) {
      return reject("NO_LINE_OF_SIGHT", "Line of sight is blocked.");
    }
    return { ok: true, state: applyAttack(state, actor.id, target.id, actor.combatStats?.rangedDamage ?? 15, cost) };
  }

  const next = cloneState(state);
  const current = next.combatants[actor.id]!;
  next.combatants[actor.id] = applyEndTurnInjuries(current, next.seed + next.round);
  next.finished = battleFinished(next.combatants);
  if (next.finished) return { ok: true, state: next };
  return { ok: true, state: advanceTurn(next) };
}

export function applyBattleCommand(
  state: BattleState,
  actorPlayerId: PlayerId,
  command: BattleCommand
): BattleResult {
  const validation = validatePlayerActor(state, actorPlayerId, command.combatantId);
  if (!validation.ok) return validation;
  return applyValidatedCommand(state, validation.combatant, command);
}

export function applyNpcBattleCommand(
  state: BattleState,
  command: BattleCommand
): BattleResult {
  const validation = validateNpcActor(state, command.combatantId);
  if (!validation.ok) return validation;
  return applyValidatedCommand(state, validation.combatant, command);
}
