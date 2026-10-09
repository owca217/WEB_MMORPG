/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminApi } from "../src/net/AdminApi";
import { AdminPanel } from "../src/ui/AdminPanel";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AdminPanel account navigation", () => {
  it("opens the Konta view and loads accounts", async () => {
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
    const api = { listAccounts } as unknown as AdminApi;
    const panel = new AdminPanel(api);

    const accountsButton = document.querySelector<HTMLButtonElement>("[data-accounts]");
    expect(accountsButton).not.toBeNull();
    accountsButton?.click();
    await flush();

    expect(listAccounts).toHaveBeenCalled();
    expect(document.body.textContent).toContain("PlayerOne");
    panel.destroy();
  });
});
