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
