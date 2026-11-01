import type {
  BattleCommand,
  BattleId,
  GeneratedArena,
  HexCoord,
  PlayerId
} from "@web-mmorpg/shared";
import { effectiveBattleArmor, effectiveBattleBlock, getWeaponSkill, getWeaponSkillPreview, hasInjury, injuryAdjustedAttackDamage, isBattleAttackEnabled, isWeaponInjuryUpgrade, meleeAttackApCost, mitigatedBattleDamage, rangedAttackRange, receivedBattleHealing, remainingMovementHexes, STAFF_HEAL_AP_COST } from "@web-mmorpg/shared";
import { findPath, hexDistance, hexKey } from "./hex";
import { hasLineOfSight } from "./lineOfSight";
import {
  applyDamageWithInjuries,
  applyEndTurnInjuries,
  effectiveInitiative,
  applyTemporaryInjury,
  beginCombatantTurn,
  expireTurnInjuries,
  updateInjuryHpCap,
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
  injuryRandomState?: number;
  actedCombatantIds?: string[];
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
  injuryRandomSeed?: number;
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
    ...(state.actedCombatantIds ? { actedCombatantIds: [...state.actedCombatantIds] } : {}),
    combatants: Object.fromEntries(
      Object.entries(state.combatants).map(([id, combatant]) => [
        id,
        {
          ...combatant,
          position: { ...combatant.position },
          injuries: [...combatant.injuries],
          ...(combatant.temporaryInjuries ? { temporaryInjuries: combatant.temporaryInjuries.map(effect => ({ ...effect })) } : {}),
          ...(combatant.weaponInjuryUpgrade ? { weaponInjuryUpgrade: { ...combatant.weaponInjuryUpgrade } } : {}),
          ...(combatant.injuryAttemptedTargetsThisTurn ? { injuryAttemptedTargetsThisTurn: [...combatant.injuryAttemptedTargetsThisTurn] } : {}),
          ...(combatant.fullTurnInjuryKinds ? { fullTurnInjuryKinds: [...combatant.fullTurnInjuryKinds] } : {}),
          ...(combatant.combatStats ? { combatStats: { ...combatant.combatStats } } : {}),
          ...(combatant.weaponSkills ? { weaponSkills: [...combatant.weaponSkills] } : {}),
          ...(combatant.weaponSkillCooldowns ? { weaponSkillCooldowns: {...combatant.weaponSkillCooldowns} } : {}),
          ...(combatant.weaponSkillBuffs ? { weaponSkillBuffs: combatant.weaponSkillBuffs.map(buff => ({...buff})) } : {})
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
    combatants[inputCombatant.id] = updateInjuryHpCap({
      ...inputCombatant,
      position: { ...inputCombatant.position },
      injuries: [...inputCombatant.injuries],
      ...(inputCombatant.temporaryInjuries ? { temporaryInjuries: inputCombatant.temporaryInjuries.map(effect => ({ ...effect })) } : {}),
      ...(inputCombatant.weaponInjuryUpgrade ? { weaponInjuryUpgrade: { ...inputCombatant.weaponInjuryUpgrade } } : {}),
      ...(inputCombatant.combatStats ? { combatStats: { ...inputCombatant.combatStats } } : {}),
      ...(inputCombatant.weaponSkills ? { weaponSkills: [...inputCombatant.weaponSkills] } : {}),
      ...(inputCombatant.weaponSkillCooldowns ? { weaponSkillCooldowns: {...inputCombatant.weaponSkillCooldowns} } : {}),
      ...(inputCombatant.weaponSkillBuffs ? { weaponSkillBuffs: inputCombatant.weaponSkillBuffs.map(buff => ({...buff})) } : {}),
      ap: 0
    });
  }

  const activeCombatantId = ordered[0]!.id;
  beginCombatantTurn(combatants[activeCombatantId]!);

  return {
    id: input.id,
    seed: input.seed,
    round: 1,
    activeCombatantId,
    turnOrder: ordered.map((combatant) => combatant.id),
    arena: input.arena,
    combatants,
    finished: false,
    injuryRandomState: ((input.injuryRandomSeed ?? input.seed) >>> 0) || 0x9e3779b9,
    actedCombatantIds: []
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
  const acted = new Set(next.actedCombatantIds?.length ? next.actedCombatantIds : next.turnOrder.slice(0, Math.max(0, currentIndex)));
  acted.add(next.activeCombatantId);
  const ordered = Object.values(next.combatants).sort((a, b) => effectiveInitiative(b) - effectiveInitiative(a) || a.id.localeCompare(b.id));
  next.turnOrder = ordered.map(unit => unit.id);
  let active = ordered.find(unit => unit.hp > 0 && !acted.has(unit.id));
  if (!active) {
    next.round += 1;
    acted.clear();
    active = ordered.find(unit => unit.hp > 0);
  }
  next.actedCombatantIds = [...acted];
  if (active) {
    next.activeCombatantId = active.id;
    beginCombatantTurn(active);
  }
  return next;
}

function finishIfDecided(state: BattleState): void {
  state.finished = battleFinished(state.combatants);
  if (!state.finished) return;
  for (const [id, unit] of Object.entries(state.combatants)) {
    state.combatants[id] = updateInjuryHpCap({ ...unit, temporaryInjuries: [], fullTurnInjuryKinds: [] });
  }
}

/** Remove a departing owner without applying end-turn damage or leaving a blocked turn. */
export function removeBattleCombatant(state: BattleState, combatantId: string): BattleState {
  if (!state.combatants[combatantId]) return cloneState(state);
  const next = cloneState(state), wasActive = next.activeCombatantId === combatantId;
  delete next.combatants[combatantId];
  next.turnOrder = next.turnOrder.filter(id => id !== combatantId);
  finishIfDecided(next);
  if (wasActive && !next.finished) return advanceTurn(next);
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
  apCost: number,
  melee: boolean,
  armorPenetration = 0,
  applyWeaponEffect = true
): BattleState {
  const next = cloneState(state);
  const attacker = next.combatants[attackerId]!;
  const target = next.combatants[targetId]!;
  const adjustedDamage = injuryAdjustedAttackDamage(attacker, target, damage);
  const armor = effectiveBattleArmor(target) * (1 - armorPenetration);
  const armorDamage = mitigatedBattleDamage(adjustedDamage, armor);
  const mitigatedDamage = mitigatedBattleDamage(adjustedDamage, armor, effectiveBattleBlock(target));
  if (mitigatedDamage < armorDamage) target.shieldBlocks = (target.shieldBlocks ?? 0) + 1;
  attacker.ap -= apCost;
  attacker.attackedThisTurn = true;
  if (melee) attacker.meleeAttackUsedThisTurn = true;
  next.combatants[targetId] = applyDamageWithInjuries(target, mitigatedDamage, next.seed + next.round);
  const upgrade = attacker.weaponInjuryUpgrade;
  if (applyWeaponEffect && next.combatants[targetId]!.hp > 0 && isWeaponInjuryUpgrade(upgrade) && !(attacker.injuryAttemptedTargetsThisTurn ?? []).includes(targetId)) {
    attacker.injuryAttemptedTargetsThisTurn = [...(attacker.injuryAttemptedTargetsThisTurn ?? []), targetId];
    // Persist a separate stream: repeated attack commands must never reuse a round's roll.
    let randomState = next.injuryRandomState ?? ((next.seed >>> 0) || 0x9e3779b9);
    randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
    next.injuryRandomState = randomState >>> 0;
    if (next.injuryRandomState / 0x100000000 < upgrade.chancePercent / 100) next.combatants[targetId] = applyTemporaryInjury(next.combatants[targetId]!, upgrade);
  }
  finishIfDecided(next);
  return next;
}

function applyValidatedCommand(
  state: BattleState,
  actor: CombatantState,
  command: BattleCommand
): BattleResult {
  if (command.type === "useWeaponSkill") {
    const skill = getWeaponSkill(command.skillId);
    const preview = getWeaponSkillPreview({id:state.id,round:state.round,activeCombatantId:state.activeCombatantId,turnOrder:state.turnOrder,cells:state.arena.cells,blockedCells:state.arena.blockedCells,coverCells:state.arena.coverCells,combatants:Object.values(state.combatants),finished:state.finished},actor.id,command.skillId,command.targetId);
    if (!skill || !preview.available) return reject(preview.code ?? "WEAPON_SKILL_UNAVAILABLE", preview.reason ?? "Technika jest niedostępna.");
    let next: BattleState;
    if (skill.kind === "attack") {
      const melee = skill.attackMode !== "rangedAttack";
      const base = melee ? actor.combatStats?.meleeDamage ?? 20 : actor.combatStats?.rangedDamage ?? 15;
      next = applyAttack(state,actor.id,preview.targetId!,base * (skill.damageMultiplier ?? 1),preview.apCost,melee,skill.armorPenetration ?? 0,skill.family !== "shield");
      const target = next.combatants[preview.targetId!]!;
      if (!next.finished && target.hp > 0 && skill.injury) next.combatants[target.id] = applyTemporaryInjury(target,{kind:skill.injury.kind,chancePercent:100,duration:skill.injury.duration});
    } else {
      next = cloneState(state);
      next.combatants[actor.id]!.ap -= preview.apCost;
      if (skill.kind === "heal") {
        next.combatants[preview.targetId!]!.hp += preview.amount;
        if (skill.family === "staff") next.combatants[actor.id]!.healingUsedThisTurn = true;
      } else if (skill.kind === "guard") {
        const caster = next.combatants[actor.id]!;
        caster.weaponSkillBuffs = [...(caster.weaponSkillBuffs ?? []),{armorBonus:skill.armorBonus ?? 0,blockBonus:skill.blockBonus ?? 0,remainingTurns:skill.durationTurns ?? 1}];
      }
    }
    const caster = next.combatants[actor.id]!;
    caster.weaponSkillCooldowns = {...caster.weaponSkillCooldowns,[skill.id]:skill.cooldownTurns};
    return {ok:true,state:next};
  }
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
    const amount = Math.min(target.maxHp - target.hp, receivedBattleHealing(target, power));
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
    if (path.length > remainingMovementHexes(actor)) return reject("MOVEMENT_LIMIT", "Uraz pozwala przejść najwyżej 3 pola w turze.");

    const cost = movementApCost(actor, path.length);
    if (actor.ap < cost) return reject("INSUFFICIENT_AP", "Not enough AP to move there.");

    const next = cloneState(state);
    const moving = next.combatants[actor.id]!;
    moving.ap -= cost;
    moving.position = { ...command.target };
    moving.movedHexesThisTurn = (moving.movedHexesThisTurn ?? 0) + path.length;
    if (path.length > 0 && hasInjury(moving, "backInjury") && moving.attackedThisTurn) moving.backInjuryMovementUsedThisTurn = true;
    const damage = hasInjury(moving, "thighWound") ? Math.min(path.length * 2, Math.max(0, 6 - (moving.thighWoundDamageThisTurn ?? 0))) : 0;
    moving.thighWoundDamageThisTurn = (moving.thighWoundDamageThisTurn ?? 0) + damage;
    next.combatants[actor.id] = damage ? applyDamageWithInjuries(moving, damage, next.seed + next.round) : moving;
    finishIfDecided(next);
    if (!next.finished && next.combatants[actor.id]!.hp <= 0) return { ok: true, state: advanceTurn(next) };
    return { ok: true, state: next };
  }

  if (command.type === "meleeAttack" || command.type === "rangedAttack") {
    if(!isBattleAttackEnabled(actor,command.type))return reject("WEAPON_ATTACK_UNAVAILABLE","Założona broń nie pozwala na ten atak.");
    const target = targetCombatant(state, command.targetId);
    if (!target || target.hp <= 0) return reject("INVALID_TARGET", "Target is not available.");
    if (target.side === actor.side) return reject("INVALID_TARGET", "Cannot attack an ally.");

    const distance = hexDistance(actor.position, target.position);

    if (command.type === "meleeAttack") {
      const cost = meleeAttackApCost(actor);
      if (actor.ap < cost) return reject("INSUFFICIENT_AP", "Not enough AP.");
      if (distance !== 1) return reject("OUT_OF_RANGE", "Melee target must be adjacent.");
      return { ok: true, state: applyAttack(state, actor.id, target.id, actor.combatStats?.meleeDamage ?? 20, cost, true) };
    }

    const cost = rangedAttackApCost(actor);
    if (actor.ap < cost) return reject("INSUFFICIENT_AP", "Not enough AP.");
    if (distance <= 0 || distance > rangedAttackRange(actor)) return reject("OUT_OF_RANGE", "Ranged target is too far away.");
    const blockers = new Set(state.arena.blockedCells.map(hexKey));
    if (!hasLineOfSight(actor.position, target.position, blockers)) {
      return reject("NO_LINE_OF_SIGHT", "Line of sight is blocked.");
    }
    return { ok: true, state: applyAttack(state, actor.id, target.id, actor.combatStats?.rangedDamage ?? 15, cost, false) };
  }

  if (command.type !== "endTurn") return reject("INVALID_BATTLE_COMMAND", "Nieznane polecenie walki.");
  const next = cloneState(state);
  const current = next.combatants[actor.id]!;
  next.combatants[actor.id] = expireTurnInjuries(applyEndTurnInjuries(current, next.seed + next.round));
  finishIfDecided(next);
  if (next.finished) return { ok: true, state: next };
  return { ok: true, state: advanceTurn(next) };
}

export function applyBattleCommand(
  state: BattleState,
  actorPlayerId: PlayerId,
  command: BattleCommand
): BattleResult {
  if (!command || typeof command !== "object" || typeof command.combatantId !== "string") return reject("INVALID_BATTLE_COMMAND", "Niepoprawne polecenie walki.");
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
