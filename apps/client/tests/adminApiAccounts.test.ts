import { describe, expect, it, vi } from "vitest";
import { AdminApi } from "../src/net/AdminApi";

describe("AdminApi account administration", () => {
  it("calls fetch with the global receiver", async () => {
    let receiver: unknown;
    const fetcher = vi.fn(function (this: unknown) {
      receiver = this;
      return Promise.resolve(
        new Response(
          JSON.stringify({ accounts: [], total: 0, page: 1, pageSize: 25 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    });
    const api = new AdminApi(
      "https://game.example.test",
      () => "admin-session",
      fetcher as unknown as typeof fetch
    );

    await api.listAccounts();

    expect(receiver).toBe(globalThis);
  });

  it("lists accounts with search/pagination under the current bearer token", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accounts: [],
          total: 0,
          page: 2,
          pageSize: 25
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const api = new AdminApi("https://game.example.test/", () => "admin-session", fetcher);

    const page = await api.listAccounts({ search: "owczy", page: 2, pageSize: 25 });

    expect(page).toMatchObject({ total: 0, page: 2, pageSize: 25 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain("/api/admin/accounts?");
    expect(String(url)).toContain("search=owczy");
    expect(String(url)).toContain("page=2");
    expect(String(url)).toContain("pageSize=25");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer admin-session");
  });

  it("updates role/status through the persistent account access endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "account-1",
          username: "player-one",
          role: "ADMIN",
          status: "active",
          createdAt: "2026-10-09T00:00:00.000Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const api = new AdminApi("https://game.example.test", () => "admin-session", fetcher);

    await api.updateAccountAccess("account-1", { role: "ADMIN", status: "active" });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://game.example.test/api/admin/accounts/account-1/access");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ role: "ADMIN", status: "active" });
  });
});
