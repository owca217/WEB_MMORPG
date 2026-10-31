import type { CombatStatistics } from "./characterProgression";

export type EnemyId = "feral-rat" | "forest-wolf" | "wild-boar" | "forest-bandit" | "outlaw-guard";

export interface EnemyDefinition {
  readonly id: EnemyId;
  readonly name: string;
  readonly description: string;
  readonly level: number;
  readonly recommendedLevels: readonly [number, number];
  readonly maxHp: number;
  readonly maxAp: number;
  readonly initiative: number;
  readonly combatStats: Readonly<CombatStatistics>;
  readonly experienceReward: number;
}

/** Fixed solo encounters. A higher player level never raises these statistics. */
export const ENEMY_DEFINITIONS: readonly EnemyDefinition[] = [
  {
    id: "feral-rat", name: "Zdziczały szczur", level: 1, recommendedLevels: [1, 2],
    description: "Wielki szczur żerujący na skraju osady. Dobry przeciwnik na pierwszą wyprawę.",
    maxHp: 110, maxAp: 4, initiative: 9,
    combatStats: { meleeDamage: 9, rangedDamage: 0, armor: 0 }, experienceReward: 40
  },
  {
    id: "forest-wolf", name: "Leśny wilk", level: 3, recommendedLevels: [3, 4],
    description: "Samotny wilk strzegący leśnego szlaku. Podchodzi do ofiary i atakuje kłami.",
    maxHp: 170, maxAp: 4, initiative: 10,
    combatStats: { meleeDamage: 15, rangedDamage: 0, armor: 4 }, experienceReward: 70
  },
  {
    id: "wild-boar", name: "Rozjuszony dzik", level: 5, recommendedLevels: [5, 6],
    description: "Uparty odyniec o twardej skórze. Walczy z bliska, uderzając ostrymi szablami.",
    maxHp: 230, maxAp: 4, initiative: 11,
    combatStats: { meleeDamage: 18, rangedDamage: 0, armor: 8 }, experienceReward: 100
  },
  {
    id: "forest-bandit", name: "Leśny rabuś", level: 7, recommendedLevels: [7, 8],
    description: "Rabuś czyhający z mieczem wśród drzew. Skórzana zbroja łagodzi zadawane mu ciosy.",
    maxHp: 280, maxAp: 4, initiative: 12,
    combatStats: { meleeDamage: 23, rangedDamage: 0, armor: 12 }, experienceReward: 130
  },
  {
    id: "outlaw-guard", name: "Strażnik banitów", level: 10, recommendedLevels: [9, 10],
    description: "Opancerzony strażnik leśnych banitów. Jego topór i tarcza stanowią wyzwanie dla wprawnego podróżnika.",
    maxHp: 340, maxAp: 4, initiative: 13,
    combatStats: { meleeDamage: 27, rangedDamage: 0, armor: 16 }, experienceReward: 160
  }
];

export function getEnemyDefinition(id: string): EnemyDefinition | undefined {
  return ENEMY_DEFINITIONS.find(enemy => enemy.id === id);
}
