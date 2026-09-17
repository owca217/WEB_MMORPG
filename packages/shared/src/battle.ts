import type { BattleId, EntityId, PlayerId } from "./ids";

export interface HexCoord {
  q: number;
  r: number;
}

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
  ownerPlayerId?: PlayerId;
  name: string;
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
