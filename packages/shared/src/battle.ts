import type { BattleId, EntityId, PlayerId } from "./ids";
import type { CombatStatistics } from "./characterProgression";

export interface HexCoord {
  q: number;
  r: number;
}

export type BattleMode = "manual" | "auto";

export type BattleAutoResult =
  | { ok: true; snapshot: BattleSnapshot }
  | { ok: false; code: string; message: string };

export type InjuryKind =
  | "brokenArm"
  | "legTrauma"
  | "bleeding"
  | "concussion"
  | "chestWound"
  | "burn"
  | "poison";

export interface CombatantSnapshot {
  id: EntityId;
  side?: "player" | "enemy";
  ownerPlayerId?: PlayerId;
  name: string;
  level?: number;
  combatStats?: CombatStatistics;
  healingUsedThisTurn?: boolean;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  initiative: number;
  position: HexCoord;
  severelyInjured: boolean;
  injuries: InjuryKind[];
}

export interface BattleSnapshot {
  autoBattle?: boolean;
  id: BattleId;
  round: number;
  activeCombatantId: EntityId;
  turnOrder: EntityId[];
  cells: HexCoord[];
  blockedCells: HexCoord[];
  coverCells: HexCoord[];
  combatants: CombatantSnapshot[];
  finished: boolean;
}

export type BattleCommand =
  | { type: "healSelf"; combatantId: EntityId }
  | { type: "move"; combatantId: EntityId; target: HexCoord }
  | { type: "meleeAttack"; combatantId: EntityId; targetId: EntityId }
  | { type: "rangedAttack"; combatantId: EntityId; targetId: EntityId }
  | { type: "endTurn"; combatantId: EntityId };

export interface ArenaProfile {
  radius: number;
  obstacleCount: number;
  coverCount: number;
}

export interface GeneratedArena {
  cells: HexCoord[];
  blockedCells: HexCoord[];
  coverCells: HexCoord[];
  playerStartCells: HexCoord[];
  enemyStartCells: HexCoord[];
}
