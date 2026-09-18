export type CloseReason =
  | "sessionReplaced"
  | "logout"
  | "credentialsChanged"
  | "characterDeletion";

export interface ActiveConnection {
  close(reason: CloseReason): Promise<void>;
}

export class ActiveConnectionRegistry {
  private readonly connections = new Map<string, ActiveConnection>();

  attach(accountId: string, connection: ActiveConnection): void {
    this.connections.set(accountId, connection);
  }

  detach(accountId: string, connection: ActiveConnection): void {
    if (this.connections.get(accountId) === connection) {
      this.connections.delete(accountId);
    }
  }

  async closeAccount(accountId: string, reason: CloseReason): Promise<void> {
    const existing = this.connections.get(accountId);
    if (!existing) return;

    await existing.close(reason);
    if (this.connections.get(accountId) === existing) {
      this.connections.delete(accountId);
    }
  }

  has(accountId: string): boolean {
    return this.connections.has(accountId);
  }
}
