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

export interface ApplyAdminGrantInput {
  operationId: string;
  accountId: string;
  characterId: string;
  itemId: string;
  quantity: number;
  inventory: InventorySnapshot;
  equipment: EquipmentSnapshot;
}

export interface ApplyAdminGrantResult {
  status: "applied" | "alreadyApplied";
  inventory: InventorySnapshot;
  equipment: EquipmentSnapshot;
}

export class AdminOperationConflictError extends Error {
  readonly code = "ADMIN_OPERATION_CONFLICT" as const;

  constructor() {
    super("The operation identifier was already used with different grant data.");
  }
}

interface AdminGrantRow {
  operation_id: string;
  account_id: string;
  character_id: string;
  item_id: string;
  quantity: number;
}

function copyInventory(snapshot: InventorySnapshot): InventorySnapshot {
  return { items: snapshot.items.map((item) => ({ ...item })) };
}

function copyEquipment(snapshot: EquipmentSnapshot): EquipmentSnapshot {
  return { items: snapshot.items.map((entry) => ({ ...entry })) };
}

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
        experience: row.experience,
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

  async saveInventoryAndEquipment(
    characterId: string,
    inventory: InventorySnapshot,
    equipment: EquipmentSnapshot
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await new InventoryRepository(client).replaceAll(characterId, inventory);
      await new EquipmentRepository(client).replaceAll(characterId, equipment);
    });
  }

  async applyAdminGrant(input: ApplyAdminGrantInput): Promise<ApplyAdminGrantResult> {
    return withTransaction(this.pool, async (client) => {
      const owner = await client.query<{ account_id: string }>(
        "SELECT account_id FROM characters WHERE id = $1 FOR UPDATE",
        [input.characterId]
      );
      if (!owner.rows[0]) throw new Error("CHARACTER_NOT_FOUND");
      if (owner.rows[0].account_id !== input.accountId) {
        throw new Error("CHARACTER_ACCESS_DENIED");
      }

      const inserted = await client.query<AdminGrantRow>(
        `INSERT INTO admin_item_grants
         (operation_id, account_id, character_id, item_id, quantity)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (operation_id) DO NOTHING
         RETURNING operation_id, account_id, character_id, item_id, quantity`,
        [
          input.operationId,
          input.accountId,
          input.characterId,
          input.itemId,
          input.quantity
        ]
      );

      if (inserted.rows.length === 0) {
        const existing = await client.query<AdminGrantRow>(
          `SELECT operation_id, account_id, character_id, item_id, quantity
           FROM admin_item_grants
           WHERE operation_id = $1
           FOR UPDATE`,
          [input.operationId]
        );
        const row = existing.rows[0];
        if (
          !row ||
          row.account_id !== input.accountId ||
          row.character_id !== input.characterId ||
          row.item_id !== input.itemId ||
          row.quantity !== input.quantity
        ) {
          throw new AdminOperationConflictError();
        }

        const inventory = await new InventoryRepository(client).load(input.characterId);
        const equipment = await new EquipmentRepository(client).load(input.characterId);
        return { status: "alreadyApplied", inventory, equipment };
      }

      await new InventoryRepository(client).replaceAll(
        input.characterId,
        input.inventory
      );
      await new EquipmentRepository(client).replaceAll(
        input.characterId,
        input.equipment
      );

      return {
        status: "applied",
        inventory: copyInventory(input.inventory),
        equipment: copyEquipment(input.equipment)
      };
    });
  }

  async hasNpcRewardClaim(characterId: string, rewardKey: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM character_reward_claims
       WHERE character_id = $1 AND reward_key = $2`,
      [characterId, rewardKey]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async claimNpcRewardOnce(
    characterId: string,
    rewardKey: string,
    inventory: InventorySnapshot,
    equipment: EquipmentSnapshot
  ): Promise<boolean> {
    return withTransaction(this.pool, async (client) => {
      const claim = await client.query(
        `INSERT INTO character_reward_claims (character_id, reward_key)
         VALUES ($1, $2)
         ON CONFLICT (character_id, reward_key) DO NOTHING`,
        [characterId, rewardKey]
      );
      if (claim.rowCount === 0) return false;

      await new InventoryRepository(client).replaceAll(characterId, inventory);
      await new EquipmentRepository(client).replaceAll(characterId, equipment);
      return true;
    });
  }
}
