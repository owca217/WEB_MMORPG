import { randomUUID } from "node:crypto";
import type {
  AppearanceSelection,
  CharacterLifecycleSummary,
  CharacterProfile
} from "@web-mmorpg/shared";
import { isAppearanceSelection } from "@web-mmorpg/shared";
import type { Pool } from "pg";
import { withTransaction } from "../db/transaction";
import {
  CharacterRepository,
  type PersistedCharacterRecord
} from "../persistence/CharacterRepository";
import { FOREST_SETTLEMENT_01 } from "../world/worldFixtures";
import { validateNickname } from "./nickname";

export class CharacterLifecycleError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function hasPgCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code
  );
}

function toProfile(character: PersistedCharacterRecord): CharacterProfile {
  return {
    id: character.id,
    nickname: character.nickname,
    appearance: character.appearance
  };
}

export class CharacterLifecycleService {
  constructor(private readonly pool: Pool) {}

  async getLifecycle(
    accountId: string,
    _now: Date
  ): Promise<CharacterLifecycleSummary> {
    const character = await new CharacterRepository(this.pool).findByAccountId(accountId);
    if (!character) return { state: "none" };

    if (character.deletionEffectiveAt) {
      return {
        state: "pendingDeletion",
        characterId: character.id,
        nickname: character.nickname,
        deletionEffectiveAt: character.deletionEffectiveAt.toISOString()
      };
    }

    return {
      state: "active",
      characterId: character.id,
      nickname: character.nickname
    };
  }

  async getCharacter(accountId: string): Promise<CharacterProfile | null> {
    const character = await new CharacterRepository(this.pool).findByAccountId(accountId);
    return character ? toProfile(character) : null;
  }

  async createCharacter(
    accountId: string,
    input: { nickname: string; appearance: unknown }
  ): Promise<CharacterProfile> {
    const nickname = validateNickname(input.nickname);
    if (!nickname.ok) {
      throw new CharacterLifecycleError(
        nickname.code,
        400,
        "Character nickname is invalid."
      );
    }
    if (!isAppearanceSelection(input.appearance)) {
      throw new CharacterLifecycleError(
        "INVALID_APPEARANCE",
        400,
        "Character appearance contains an unsupported option."
      );
    }

    try {
      const created = await withTransaction(this.pool, async (client) => {
        const characters = new CharacterRepository(client);
        if (await characters.findByAccountId(accountId)) {
          throw new CharacterLifecycleError(
            "CHARACTER_ALREADY_EXISTS",
            409,
            "This account already owns a character."
          );
        }

        return characters.create({
          id: randomUUID(),
          accountId,
          nickname: nickname.display,
          nicknameNormalized: nickname.normalized,
          appearance: input.appearance as AppearanceSelection,
          locationId: FOREST_SETTLEMENT_01.id,
          x: FOREST_SETTLEMENT_01.spawn.x,
          y: FOREST_SETTLEMENT_01.spawn.y
        });
      });

      return toProfile(created);
    } catch (error) {
      if (error instanceof CharacterLifecycleError) throw error;
      if (hasPgCode(error, "23505")) {
        throw new CharacterLifecycleError(
          "NICKNAME_TAKEN",
          409,
          "That character nickname is already taken."
        );
      }
      throw error;
    }
  }
}
