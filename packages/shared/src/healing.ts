export const WORLD_HEAL_RANGE = 160;
export const WORLD_HEAL_COOLDOWN_MS = 10_000;

export interface HealingTarget {
  id: string;
  nickname: string;
  hp: number;
  maxHp: number;
  available: boolean;
  reason?: string;
}
export interface HealingRequest { requestId: string; targetId: string; }
export interface HealingFailure { ok: false; code: string; message: string; }
export type HealingTargetsResult =
  | { ok: true; targets: HealingTarget[]; healingPower: number; cooldownMs: number }
  | HealingFailure;
export type HealingResult =
  | { ok: true; requestId: string; targetId: string; restoredHp: number; cooldownMs: number }
  | HealingFailure;
