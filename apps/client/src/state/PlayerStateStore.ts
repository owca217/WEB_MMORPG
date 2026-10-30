import { EQUIPMENT_SLOTS, type CharacterEquipment, type InventoryItem, type PlayerStateSnapshot } from "@web-mmorpg/shared";

export type PlayerStateHandler = (state: PlayerStateSnapshot) => void;

function cloneItem(item: InventoryItem): InventoryItem {
  return {
    ...item,
    ...(item.equipment ? { equipment: {
      ...item.equipment,
      modifiers: item.equipment.modifiers.map(modifier => ({ ...modifier }))
    } } : {}),
    ...(item.consumableEffects ? { consumableEffects: { ...item.consumableEffects } } : {})
  };
}

function cloneState(state: PlayerStateSnapshot): PlayerStateSnapshot {
  return {
    ...(state.gold !== undefined ? { gold: state.gold } : {}),
    character: {
      ...state.character,
      ...(state.character.weaponTraining ? { weaponTraining: {
        experience: { ...state.character.weaponTraining.experience },
        loadout: { ...state.character.weaponTraining.loadout }
      } } : {}),
      ...(state.character.equipment ? { equipment: Object.fromEntries(EQUIPMENT_SLOTS.map(slot => {
        const item = state.character.equipment![slot];
        return [slot, item ? cloneItem(item) : null];
      })) as CharacterEquipment } : {}),
      ...(state.character.statistics ? { statistics: { ...state.character.statistics } } : {}),
      injuries: [...state.character.injuries]
    },
    inventory: {
      items: state.inventory.items.map(cloneItem),
      ...(state.inventory.containerSlots ? { containerSlots: [...state.inventory.containerSlots] } : {}),
      ...(state.inventory.equipmentSlots ? { equipmentSlots: { ...state.inventory.equipmentSlots } } : {})
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
