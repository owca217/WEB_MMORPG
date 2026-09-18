export interface PositionState {
  locationId: string;
  x: number;
  y: number;
}

export interface PositionPersistenceDeps {
  intervalMs: number;
  readPosition(playerId: string): PositionState | undefined;
  writePosition(playerId: string, state: PositionState): Promise<void>;
}

export class PositionPersistenceCoordinator {
  private readonly dirtyRevision = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(private readonly deps: PositionPersistenceDeps) {}

  markDirty(playerId: string): void {
    this.dirtyRevision.set(
      playerId,
      (this.dirtyRevision.get(playerId) ?? 0) + 1
    );
  }

  async flushPlayer(playerId: string): Promise<void> {
    const revision = this.dirtyRevision.get(playerId);
    if (revision === undefined) return;

    const state = this.deps.readPosition(playerId);
    if (!state) {
      if (this.dirtyRevision.get(playerId) === revision) {
        this.dirtyRevision.delete(playerId);
      }
      return;
    }

    await this.deps.writePosition(playerId, state);
    if (this.dirtyRevision.get(playerId) === revision) {
      this.dirtyRevision.delete(playerId);
    }
  }

  async flushDirty(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;

    try {
      for (const playerId of [...this.dirtyRevision.keys()]) {
        await this.flushPlayer(playerId);
      }
    } finally {
      this.flushing = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flushDirty();
    }, this.deps.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flushDirty();
  }
}
