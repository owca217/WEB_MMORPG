import type { UserRole } from "./admin";

export const ACCOUNT_ROLES = ["PLAYER", "ADMIN"] as const;
export type AccountRole = UserRole;

export type CharacterLifecycleSummary =
  | { state: "none" }
  | { state: "active"; characterId: string; nickname: string }
  | {
      state: "pendingDeletion";
      characterId: string;
      nickname: string;
      deletionEffectiveAt: string;
    };

export interface SessionView {
  accountUsername: string;
  accountRole: AccountRole;
  character: CharacterLifecycleSummary;
}

export interface RegisterResponse {
  recoveryCode: string;
}

export interface LoginResponse {
  token: string;
  session: SessionView;
}

export interface RecoverResponse {
  recoveryCode: string;
}
