export type CharacterLifecycleSummary =
  | { state: "none" }
  | { state: "active"; characterId: string; nickname: string }
  | {
      state: "pendingDeletion";
      characterId: string;
      nickname: string;
      deletionEffectiveAt: string;
    };

export type AccountRole = "PLAYER" | "ADMIN";

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

