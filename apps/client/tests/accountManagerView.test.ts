/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiRequestError, type AdminApi } from "../src/net/AdminApi";
import { AccountManagerView } from "../src/ui/admin/AccountManagerView";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function api(overrides: Partial<Record<keyof AdminApi, unknown>> = {}): AdminApi {
  return {
    listAccounts: vi.fn().mockResolvedValue({
      accounts: [
        {
          id: "admin-1",
          username: "OwczyAdmin",
          role: "ADMIN",
          status: "active",
          createdAt: "2026-10-01T00:00:00.000Z"
        },
        {
          id: "player-1",
          username: "PlayerOne",
          role: "PLAYER",
          status: "active",
          createdAt: "2026-10-02T00:00:00.000Z"
        }
      ],
      total: 2,
      page: 1,
      pageSize: 20
    }),
    updateAccountAccess: vi.fn(),
    ...overrides
  } as unknown as AdminApi;
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AccountManagerView", () => {
  it("searches accounts and keeps pagination in the request", async () => {
    const listAccounts = vi.fn().mockResolvedValue({
      accounts: [],
      total: 0,
      page: 1,
      pageSize: 20
    });
    const host = document.createElement("div");
    const view = new AccountManagerView(host, api({ listAccounts }));
    await view.show();

    const search = host.querySelector<HTMLInputElement>("[data-account-search]");
    const form = host.querySelector<HTMLFormElement>("[data-account-search-form]");
    if (!search || !form) throw new Error("Account search UI missing");
    search.value = "player";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(listAccounts).toHaveBeenLastCalledWith({ search: "player", page: 1, pageSize: 20 });
  });

  it("requires explicit confirmation before promoting an account and refreshes the list", async () => {
    const listAccounts = vi.fn().mockResolvedValue({
      accounts: [
        {
          id: "player-1",
          username: "PlayerOne",
          role: "PLAYER",
          status: "active",
          createdAt: "2026-10-02T00:00:00.000Z"
        }
      ],
      total: 1,
      page: 1,
      pageSize: 20
    });
    const updateAccountAccess = vi.fn().mockResolvedValue({
      id: "player-1",
      username: "PlayerOne",
      role: "ADMIN",
      status: "active",
      createdAt: "2026-10-02T00:00:00.000Z"
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const host = document.createElement("div");
    const view = new AccountManagerView(host, api({ listAccounts, updateAccountAccess }));
    await view.show();

    const promote = host.querySelector<HTMLButtonElement>(
      "[data-account-action='promote'][data-account-id='player-1']"
    );
    if (!promote) throw new Error("Promote action missing");
    promote.click();
    await flush();

    expect(window.confirm).toHaveBeenCalled();
    expect(updateAccountAccess).toHaveBeenCalledWith("player-1", { role: "ADMIN" });
    expect(listAccounts).toHaveBeenCalledTimes(2);
  });

  it("shows last-admin 409 without clearing the current account list", async () => {
    const updateAccountAccess = vi.fn().mockRejectedValue(
      new AdminApiRequestError(409, {
        code: "LAST_ACTIVE_ADMIN",
        message: "Nie można usunąć uprawnień ostatniemu aktywnemu administratorowi."
      })
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const host = document.createElement("div");
    const view = new AccountManagerView(host, api({ updateAccountAccess }));
    await view.show();

    expect(host.textContent).toContain("OwczyAdmin");
    const demote = host.querySelector<HTMLButtonElement>(
      "[data-account-action='demote'][data-account-id='admin-1']"
    );
    if (!demote) throw new Error("Demote action missing");
    demote.click();
    await flush();

    expect(host.textContent).toContain("OwczyAdmin");
    expect(host.querySelector("[data-account-error]")?.textContent).toContain("ostatniemu");
  });
});
