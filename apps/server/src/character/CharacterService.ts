import {
  getCharacterStatistics,
  getLevelForExperience,
  getTotalExperienceForLevel,
  MAX_CHARACTER_LEVEL,
  getEquipmentCombatStatistics,
  emptyCharacterEquipment,
  normalizeWeaponTraining,
  WEAPON_FAMILIES,
  MAX_WEAPON_EXPERIENCE,
  type WeaponFamily,
  type CharacterEquipment,
  type CharacterSnapshot,
  type PlayerId
} from "@web-mmorpg/shared";

export class CharacterService {
  private readonly characters = new Map<PlayerId, CharacterSnapshot>();

  createPlayer(playerId: PlayerId, nickname: string): CharacterSnapshot {
    const existing = this.characters.get(playerId);
    if (existing) return this.clone(existing);

    const statistics = getEquipmentCombatStatistics(getCharacterStatistics(1),undefined);
    const character: CharacterSnapshot = {
      playerId,
      nickname,
      level: 1,
      experience: 0,
      statistics,
      weaponTraining:normalizeWeaponTraining(undefined),
      equipment:emptyCharacterEquipment(),
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
    hydrated.weaponTraining=normalizeWeaponTraining(snapshot.weaponTraining);
    hydrated.statistics = getEquipmentCombatStatistics(getCharacterStatistics(hydrated.level),hydrated.weaponTraining,hydrated.equipment);
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
    character.statistics = getEquipmentCombatStatistics(getCharacterStatistics(character.level),character.weaponTraining,character.equipment);
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

  setEquipment(playerId:PlayerId,equipment:CharacterEquipment):CharacterSnapshot {
    const character=this.require(playerId);
    character.equipment=structuredClone(equipment);
    character.statistics=getEquipmentCombatStatistics(getCharacterStatistics(character.level),character.weaponTraining,character.equipment);
    character.maxHp=character.statistics.maxHp;character.maxAp=character.statistics.maxAp;character.initiative=character.statistics.initiative;
    character.hp=Math.min(character.hp,character.maxHp);
    return this.clone(character);
  }

  trainWeapon(playerId:PlayerId,family:WeaponFamily,amount=1):CharacterSnapshot {
    if(!WEAPON_FAMILIES.some(item=>item.id===family))throw new Error("INVALID_WEAPON_FAMILY");
    if(!Number.isSafeInteger(amount) || amount<0)throw new Error("INVALID_WEAPON_EXPERIENCE");
    const character=this.require(playerId);
    character.weaponTraining=normalizeWeaponTraining(character.weaponTraining);
    character.weaponTraining.experience[family]=Math.min(MAX_WEAPON_EXPERIENCE,character.weaponTraining.experience[family]+amount);
    character.statistics=getEquipmentCombatStatistics(getCharacterStatistics(character.level),character.weaponTraining,character.equipment);
    return this.clone(character);
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

  restoreHp(playerId:PlayerId,amount:number):number {
    if(!Number.isSafeInteger(amount) || amount<=0)throw new Error("INVALID_HEAL_AMOUNT");
    const character=this.require(playerId);
    if(character.hp<=0)throw new Error("COMBATANT_DOWN");
    const restored=Math.max(0,Math.min(amount,character.maxHp-character.hp));
    character.hp+=restored;
    return restored;
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
      ...(character.weaponTraining !== undefined ? {weaponTraining:normalizeWeaponTraining(character.weaponTraining)} : {}),
      ...(character.equipment !== undefined ? {equipment:structuredClone(character.equipment)} : {}),
      injuries: [...character.injuries]
    };
  }
}
