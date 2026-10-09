import { describe, expect, it, vi } from "vitest";
import { logoutSession } from "../src/state/logoutSession";

describe("logoutSession", () => {
  it("always disconnects the socket, clears local session and routes out even if REST logout fails", async () => {
    const logout = vi.fn().mockRejectedValue(new Error("network down"));
    const disconnect = vi.fn();
    const reset = vi.fn();
    const routed = vi.fn();

    await logoutSession({
      token: "session-token",
      logout,
      disconnect,
      reset,
      onFinished: routed
    });

    expect(logout).toHaveBeenCalledWith("session-token");
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(routed).toHaveBeenCalledTimes(1);
  });

  it("cleans up locally without calling REST when no token exists", async () => {
    const logout = vi.fn();
    const disconnect = vi.fn();
    const reset = vi.fn();
    const routed = vi.fn();

    await logoutSession({ token: null, logout, disconnect, reset, onFinished: routed });

    expect(logout).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(routed).toHaveBeenCalledTimes(1);
  });
});
