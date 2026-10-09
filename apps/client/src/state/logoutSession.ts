interface LogoutSessionDependencies {
  token: string | null;
  logout: (token: string) => Promise<void>;
  disconnect: () => void;
  reset: () => void;
  onFinished: () => void;
}

export async function logoutSession({
  token,
  logout,
  disconnect,
  reset,
  onFinished
}: LogoutSessionDependencies): Promise<void> {
  try {
    if (token) await logout(token);
  } catch {
    // Local logout must still finish if the network/server request fails.
  } finally {
    disconnect();
    reset();
    onFinished();
  }
}
