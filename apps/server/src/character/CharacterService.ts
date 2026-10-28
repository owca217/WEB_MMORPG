import {
  getCharacterStatistics,
  getLevelForExperience,
  getTotalExperienceForLevel,
  MAX_CHARACTER_LEVEL,
  type CharacterSnapshot,
  type PlayerId
} from "@web-mmorpg/shared";

export class CharacterService {
  private readonly characters = new Map<PlayerId, CharacterSnapshot>();

  createPlayer(playerId: PlayerId, nickname: string): CharacterSnapshot {
    const existing = this.characters.get(playerId);
    if (existing) return this.clone(existing);

    const statistics = getCharacterStatistics(1);
    const character: CharacterSnapshot = {
      playerId,
      nickname,
      level: 1,
      experience: 0,
      statistics,
      hp: statistics.maxHp,
      maxHp: statistics.maxHp,
      maxAp: statistics.maxAp,
      initiative: statistics.initiative,
      severelyInjured: false,
      injuries: []
    };

    this.characters.set(playerId, character);
    return this.clone(character);
  }

  hydrate(snapshot: CharacterSnapshot): CharacterSnapshot {
    const hydrated = this.clone(snapshot);
    const storedExperience = Number.isFinite(snapshot.experience) ? Math.floor(snapshot.experience!) : 0;
    hydrated.experience = Math.min(
      getTotalExperienceForLevel(MAX_CHARACTER_LEVEL),
      Math.max(getTotalExperienceForLevel(snapshot.level), storedExperience)
    );
    hydrated.level = getLevelForExperience(hydrated.experience);
    hydrated.statistics = getCharacterStatistics(hydrated.level);
    hydrated.maxHp = hydrated.statistics.maxHp;
    hydrated.maxAp = hydrated.statistics.maxAp;
    hydrated.initiative = hydrated.statistics.initiative;
    hydrated.hp = Number.isFinite(snapshot.hp)
      ? Math.max(0, Math.min(hydrated.maxHp, Math.floor(snapshot.hp)))
      : hydrated.maxHp;
    this.characters.set(snapshot.playerId, hydrated);
    return this.clone(hydrated);
  }

  awardExperience(playerId: PlayerId, amount: number): CharacterSnapshot {
    if (!Number.isInteger(amount) || amount < 0) throw new Error("INVALID_EXPERIENCE_AMOUNT");
    const character = this.require(playerId);
    const previousMaxHp = character.maxHp;
    character.experience = Math.min(
      getTotalExperienceForLevel(MAX_CHARACTER_LEVEL),
      (character.experience ?? getTotalExperienceForLevel(character.level)) + amount
    );
    character.level = getLevelForExperience(character.experience);
    character.statistics = getCharacterStatistics(character.level);
    character.maxHp = character.statistics.maxHp;
    character.maxAp = character.statistics.maxAp;
    character.initiative = character.statistics.initiative;
    character.hp = Math.min(character.maxHp, character.hp + Math.max(0, character.maxHp - previousMaxHp));
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
      ...(character.appearance !== undefined ? { appearance: structuredClone(character.appearance) } : {}),
      ...(character.statistics !== undefined ? { statistics: { ...character.statistics } } : {}),
      injuries: [...character.injuries]
    };
  }
}
