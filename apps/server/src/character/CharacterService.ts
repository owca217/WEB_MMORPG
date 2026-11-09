import {
  getCharacterStatistics,
  getEquipmentCombatStatistics,
  emptyCharacterEquipment,
  normalizeWeaponTraining,
  normalizeArmorTraining,
  ARMOR_FAMILIES,
  WEAPON_FAMILIES,
  MAX_WEAPON_EXPERIENCE,
  type WeaponFamily,
  type ArmorFamily,
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
      armorTraining:normalizeArmorTraining(undefined),
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
    hydrated.weaponTraining=normalizeWeaponTraining(snapshot.weaponTraining);
    hydrated.armorTraining=normalizeArmorTraining(snapshot.armorTraining);
    this.recalculate(hydrated);
    hydrated.hp = Number.isFinite(snapshot.hp)
      ? Math.max(0, Math.min(hydrated.maxHp, Math.floor(snapshot.hp)))
      : hydrated.maxHp;
    this.characters.set(snapshot.playerId, hydrated);
    return this.clone(hydrated);
  }

  awardExperience(playerId: PlayerId, amount: number): CharacterSnapshot {
    if (!Number.isInteger(amount) || amount < 0) throw new Error("INVALID_EXPERIENCE_AMOUNT");
    const character = this.require(playerId);
    // Historical general progression remains readable, but gameplay no longer earns it.
    return this.clone(character);
  }

  getSnapshot(playerId: PlayerId): CharacterSnapshot | undefined {
    const character = this.characters.get(playerId);
    return character ? this.clone(character) : undefined;
  }

  setEquipment(playerId:PlayerId,equipment:CharacterEquipment):CharacterSnapshot {
    const character=this.require(playerId);
    character.equipment=structuredClone(equipment);
    this.recalculate(character);
    return this.clone(character);
  }

  setWeaponTraining(playerId: PlayerId, training: unknown): CharacterSnapshot {
    const character = this.require(playerId);
    character.weaponTraining = normalizeWeaponTraining(training);
    this.recalculate(character);
    return this.clone(character);
  }

  setArmorTraining(playerId: PlayerId, training: unknown): CharacterSnapshot {
    const character = this.require(playerId);
    character.armorTraining = normalizeArmorTraining(training);
    this.recalculate(character);
    return this.clone(character);
  }

  trainWeapon(playerId:PlayerId,family:WeaponFamily,amount=1):CharacterSnapshot {
    if(!WEAPON_FAMILIES.some(item=>item.id===family))throw new Error("INVALID_WEAPON_FAMILY");
    if(!Number.isSafeInteger(amount) || amount<0)throw new Error("INVALID_WEAPON_EXPERIENCE");
    const character=this.require(playerId);
    character.weaponTraining=normalizeWeaponTraining(character.weaponTraining);
    character.weaponTraining.experience[family]=Math.min(MAX_WEAPON_EXPERIENCE,character.weaponTraining.experience[family]+amount);
    this.recalculate(character);
    return this.clone(character);
  }

  trainArmor(playerId: PlayerId, family: ArmorFamily, amount = 1): CharacterSnapshot {
    if (!ARMOR_FAMILIES.some(item => item.id === family)) throw new Error("INVALID_ARMOR_FAMILY");
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("INVALID_ARMOR_EXPERIENCE");
    const character = this.require(playerId);
    character.armorTraining = normalizeArmorTraining(character.armorTraining);
    character.armorTraining.experience[family] = Math.min(MAX_WEAPON_EXPERIENCE, character.armorTraining.experience[family] + amount);
    this.recalculate(character);
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

  recoverAtHealer(playerId: PlayerId): CharacterSnapshot {
    const character = this.require(playerId);
    character.hp = character.maxHp;
    character.severelyInjured = false;
    character.injuries = [];
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

  private recalculate(character: CharacterSnapshot): void {
    character.statistics = getEquipmentCombatStatistics(getCharacterStatistics(), character.weaponTraining, character.equipment, character.armorTraining);
    character.maxHp = character.statistics.maxHp;
    character.maxAp = character.statistics.maxAp;
    character.initiative = character.statistics.initiative;
    character.hp = Math.min(character.hp, character.maxHp);
  }

  private clone(character: CharacterSnapshot): CharacterSnapshot {
    return {
      ...character,
      ...(character.appearance !== undefined ? { appearance: structuredClone(character.appearance) } : {}),
      ...(character.statistics !== undefined ? { statistics: { ...character.statistics } } : {}),
      ...(character.weaponTraining !== undefined ? {weaponTraining:normalizeWeaponTraining(character.weaponTraining)} : {}),
      ...(character.armorTraining !== undefined ? {armorTraining:normalizeArmorTraining(character.armorTraining)} : {}),
      ...(character.equipment !== undefined ? {equipment:structuredClone(character.equipment)} : {}),
      injuries: [...character.injuries]
    };
  }
}
