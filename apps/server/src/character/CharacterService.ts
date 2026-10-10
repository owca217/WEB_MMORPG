import { DEFAULT_APPEARANCE, experienceRequiredForLevelUp, normalizeAppearanceSelection, type AppearanceSelection, type CharacterSnapshot, type PlayerId } from "@web-mmorpg/shared";

export class CharacterService {
  private readonly characters = new Map<PlayerId, CharacterSnapshot>();

  createPlayer(playerId: PlayerId, nickname: string, appearance: AppearanceSelection = DEFAULT_APPEARANCE): CharacterSnapshot {
    const existing = this.characters.get(playerId);
    if (existing) return this.clone(existing);

    const character: CharacterSnapshot = {
      playerId,
      nickname,
      appearance: { ...appearance },
      level: 1,
      experience: 0,
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

  hydrate(snapshot: CharacterSnapshot): CharacterSnapshot {
    const hydrated = this.clone(snapshot);
    this.characters.set(snapshot.playerId, hydrated);
    return this.clone(hydrated);
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

  addExperience(playerId: PlayerId, amount: number): CharacterSnapshot {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError("Experience gain must be a positive safe integer.");
    const character = this.require(playerId);
    let remaining = (character.experience ?? 0) + amount;
    while (remaining >= experienceRequiredForLevelUp(character.level)) {
      remaining -= experienceRequiredForLevelUp(character.level);
      character.level += 1;
      character.maxHp += 5;
      character.hp = Math.min(character.maxHp, character.hp + 5);
    }
    character.experience = remaining;
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
      appearance: normalizeAppearanceSelection(character.appearance),
      experience: character.experience ?? 0,
      injuries: [...character.injuries]
    };
  }
}
