import type { PlayerStateSnapshot } from "@web-mmorpg/shared";

export type PlayerStateHandler = (state: PlayerStateSnapshot) => void;

function cloneState(state: PlayerStateSnapshot): PlayerStateSnapshot {
  return {
    ...(state.gold !== undefined ? { gold: state.gold } : {}),
    character: {
      ...state.character,
      injuries: [...state.character.injuries]
    },
    inventory: {
      items: state.inventory.items.map((item) => ({ ...item })),
      ...(state.inventory.containerSlots ? { containerSlots: [...state.inventory.containerSlots] } : {})
    }
  };
}

export class PlayerStateStore {
  private state: PlayerStateSnapshot | null = null;
  private readonly handlers = new Set<PlayerStateHandler>();

  get(): PlayerStateSnapshot | null {
    return this.state ? cloneState(this.state) : null;
  }

  set(state: PlayerStateSnapshot): void {
    this.state = cloneState(state);
    for (const handler of this.handlers) {
      handler(cloneState(this.state));
    }
  }

  subscribe(handler: PlayerStateHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

export const playerStateStore = new PlayerStateStore();
