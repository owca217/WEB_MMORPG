import { describe, expect, expectTypeOf, it } from "vitest";
import { ACCOUNT_ROLES } from "./auth";
import type {
  AccountRole,
  CharacterLifecycleSummary,
  LoginResponse,
  RegisterResponse,
  RecoverResponse
} from "./auth";
import { ACCOUNT_STATUSES } from "./accountAdmin";
import type {
  AccountStatus,
  AdminAccountQuery,
  AdminAccountSummary,
  UpdateAccountAccessInput
} from "./accountAdmin";
import type { ClientToServerEvents } from "./protocol";

describe("persistent account auth contracts", () => {
  it("represents every character lifecycle state", () => {
    const none: CharacterLifecycleSummary = { state: "none" };
    const active: CharacterLifecycleSummary = {
      state: "active",
      characterId: "character-1",
      nickname: "Owczy"
    };
    const pendingDeletion: CharacterLifecycleSummary = {
      state: "pendingDeletion",
      characterId: "character-1",
      nickname: "Owczy",
      deletionEffectiveAt: "2026-10-10T08:00:00.000Z"
    };

    expect(none.state).toBe("none");
    expect(active.state).toBe("active");
    expect(pendingDeletion.state).toBe("pendingDeletion");
  });

  it("keeps account roles and statuses constrained", () => {
    const roles: AccountRole[] = ["PLAYER", "ADMIN"];
    const statuses: AccountStatus[] = ["active", "banned"];

    expect(ACCOUNT_ROLES).toEqual(roles);
    expect(ACCOUNT_STATUSES).toEqual(statuses);
  });

  it("returns opaque token plus session view from login", () => {
    const response: LoginResponse = {
      token: "opaque-session-token",
      session: {
        accountUsername: "Owczy",
        accountRole: "ADMIN",
        character: { state: "none" }
      }
    };
    const registered: RegisterResponse = { recoveryCode: "RECOVERY-CODE" };
    const recovered: RecoverResponse = { recoveryCode: "NEW-RECOVERY-CODE" };

    expect(response.token).toBe("opaque-session-token");
    expect(response.session.accountRole).toBe("ADMIN");
    expect(registered.recoveryCode).toBeTruthy();
    expect(recovered.recoveryCode).toBeTruthy();
  });

  it("defines account administration without accepting arbitrary role or status", () => {
    const query: AdminAccountQuery = { search: "ow", page: 1, pageSize: 20 };
    const account: AdminAccountSummary = {
      id: "account-1",
      username: "Owczy",
      role: "PLAYER",
      status: "active",
      createdAt: "2026-10-09T08:00:00.000Z"
    };
    const update: UpdateAccountAccessInput = { role: "ADMIN", status: "active" };

    expect(query.search).toBe("ow");
    expect(account.role).toBe("PLAYER");
    expect(update.role).toBe("ADMIN");
    expectTypeOf<UpdateAccountAccessInput["role"]>().toEqualTypeOf<AccountRole | undefined>();
    expectTypeOf<UpdateAccountAccessInput["status"]>().toEqualTypeOf<AccountStatus | undefined>();
  });

  it("authenticates Socket.IO with only the opaque session token", () => {
    type AuthenticatePayload = Parameters<ClientToServerEvents["authenticate"]>[0];
    expectTypeOf<AuthenticatePayload>().toEqualTypeOf<{ sessionToken: string }>();
  });
});
