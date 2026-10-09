export type CloseAccountConnection = (reason: string) => void;

interface ActiveConnection {
  connectionId: string;
  close: CloseAccountConnection;
}

export class ActiveConnectionRegistry {
  private readonly byAccount = new Map<string, Map<string, ActiveConnection>>();

  register(
    accountId: string,
    connectionId: string,
    close: CloseAccountConnection
  ): () => void {
    let connections = this.byAccount.get(accountId);
    if (!connections) {
      connections = new Map();
      this.byAccount.set(accountId, connections);
    }
    connections.set(connectionId, { connectionId, close });

    return () => {
      const current = this.byAccount.get(accountId);
      current?.delete(connectionId);
      if (current?.size === 0) this.byAccount.delete(accountId);
    };
  }

  closeAccount(accountId: string, reason: string, exceptConnectionId?: string): void {
    const connections = this.byAccount.get(accountId);
    if (!connections) return;

    for (const connection of [...connections.values()]) {
      if (connection.connectionId === exceptConnectionId) continue;
      connection.close(reason);
    }
  }

  activeCount(accountId: string): number {
    return this.byAccount.get(accountId)?.size ?? 0;
  }
}
