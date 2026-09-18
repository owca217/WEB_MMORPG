import type {
  CharacterSnapshot,
  EquipmentSnapshot,
  InventorySnapshot,
  PlayerStateSnapshot
} from "@web-mmorpg/shared";
import type { Pool } from "pg";
import { withTransaction } from "../db/transaction";
import { CharacterRepository } from "./CharacterRepository";
import { EquipmentRepository } from "./EquipmentRepository";
import { InjuryRepository } from "./InjuryRepository";
import { InventoryRepository } from "./InventoryRepository";

export class PlayerPersistenceService {
  constructor(private readonly pool: Pool) {}

  async loadPlayer(characterId: string): Promise<PlayerStateSnapshot> {
    const row = await new CharacterRepository(this.pool).findById(characterId);
    if (!row) throw new Error("CHARACTER_NOT_FOUND");

    const [injuries, inventory, equipment] = await Promise.all([
      new InjuryRepository(this.pool).load(characterId),
      new InventoryRepository(this.pool).load(characterId),
      new EquipmentRepository(this.pool).load(characterId)
    ]);

    return {
      character: {
        playerId: row.id,
        nickname: row.nickname,
        appearance: row.appearance,
        level: row.level,
        hp: row.hp,
        maxHp: row.maxHp,
        maxAp: row.maxAp,
        initiative: row.initiative,
        severelyInjured: row.severelyInjured,
        injuries
      },
      inventory,
      equipment
    };
  }

  async saveCharacterState(character: CharacterSnapshot): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await new CharacterRepository(client).updateVitals(character);
      await new InjuryRepository(client).replaceAll(
        character.playerId,
        character.injuries
      );
    });
  }

  async saveBattleOutcome(
    character: CharacterSnapshot,
    inventory: InventorySnapshot
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const equipmentRepository = new EquipmentRepository(client);
      const equipment = await equipmentRepository.load(character.playerId);

      await new CharacterRepository(client).updateVitals(character);
      await new InjuryRepository(client).replaceAll(
        character.playerId,
        character.injuries
      );
      await new InventoryRepository(client).replaceAll(
        character.playerId,
        inventory
      );
      await equipmentRepository.replaceAll(
        character.playerId,
        equipment
      );
    });
  }

  async saveEquipment(
    characterId: string,
    equipment: EquipmentSnapshot
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await new EquipmentRepository(client).replaceAll(
        characterId,
        equipment
      );
    });
  }
}
