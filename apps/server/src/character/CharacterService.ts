import type {
  AppearanceSelection,
  CharacterSnapshot,
  PlayerId
} from "@web-mmorpg/shared";
import { DEFAULT_APPEARANCE } from "@web-mmorpg/shared";

export class CharacterService {
  private readonly characters = new Map<PlayerId, CharacterSnapshot>();

  createPlayer(
    playerId: PlayerId,
    nickname: string,
    appearance: AppearanceSelection = DEFAULT_APPEARANCE
  ): CharacterSnapshot {
    const existing = this.characters.get(playerId);
    if (existing) return this.clone(existing);

    const character: CharacterSnapshot = {
      playerId,
      nickname,
      appearance: { ...appearance },
      level: 1,
      hp: 100,
      maxHp: 100,
      maxAp: 5,
      initiative: 10,
      severelyInjured: false,
      injuries: []
    };

    this.characters.set(playerId, character);
    return this.clone(character);
  }

  getSnapshot(playerId: PlayerId): CharacterSnapshot | undefined {
    const character = this.characters.get(playerId);
    return character ? this.clone(character) : undefined;
  }

  applyBattleResult(
    playerId: PlayerId,
    result: Pick<CharacterSnapshot, "hp" | "severelyInjured" | "injuries">
  ): CharacterSnapshot {
    const character = this.require(playerId);
    character.hp = result.hp;
    character.severelyInjured = result.severelyInjured;
    character.injuries = [...result.injuries];
    return this.clone(character);
  }

  recoverAfterDefeat(playerId: PlayerId): CharacterSnapshot {
    const character = this.require(playerId);
    character.hp = Math.max(1, Math.ceil(character.maxHp * 0.25));
    return this.clone(character);
  }

  healHp(playerId: PlayerId): CharacterSnapshot {
    const character = this.require(playerId);
    character.hp = character.maxHp;
    return this.clone(character);
  }

  removePlayer(playerId: PlayerId): void {
    this.characters.delete(playerId);
  }

  private require(playerId: PlayerId): CharacterSnapshot {
    const character = this.characters.get(playerId);
    if (!character) throw new Error("CHARACTER_NOT_FOUND");
    return character;
  }

  private clone(character: CharacterSnapshot): CharacterSnapshot {
    return {
      ...character,
      appearance: { ...character.appearance },
      injuries: [...character.injuries]
    };
  }
}
