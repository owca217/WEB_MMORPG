import type { NpcInteractionPayload } from "@web-mmorpg/shared";
import { InterfaceWindowControls } from "./InterfaceWindowControls";
import { getDialogueActions } from "./dialogueViewModel";

interface DialoguePanelHandlers {
  onHeal: (npcId: string) => void;
  onClaimBag: (npcId: string) => void;
}

export class DialoguePanel {
  private readonly root: HTMLDivElement;
  private readonly name: HTMLElement;
  private readonly title: HTMLElement;
  private readonly lines: HTMLDivElement;
  private readonly healButton: HTMLButtonElement;
  private readonly claimBagButton: HTMLButtonElement;
  private readonly rewardState: HTMLElement;
  private readonly windowControls: InterfaceWindowControls;
  private currentNpcId: string | null = null;

  constructor(handlers: DialoguePanelHandlers) {
    this.root = document.createElement("div");
    this.root.className = "dialogue-panel is-hidden";
    this.root.innerHTML = `
      <div class="dialogue-panel__header">
        <h2>Rozmowa</h2>
      </div>
      <div class="dialogue-panel__paper">
        <div class="dialogue-panel__speaker">
          <strong data-name>NPC</strong>
          <span data-title></span>
        </div>
        <div class="dialogue-panel__lines" data-lines></div>
        <p class="dialogue-panel__reward-state" data-reward-state hidden></p>
      </div>
      <div class="dialogue-panel__actions">
        <button type="button" data-heal>Opatrz rany</button>
        <button type="button" data-claim-bag>Odbierz Zwykły worek</button>
      </div>
    `;
    document.body.appendChild(this.root);

    this.name = this.require("[data-name]");
    this.title = this.require("[data-title]");
    this.lines = this.require<HTMLDivElement>("[data-lines]");
    this.healButton = this.require<HTMLButtonElement>("[data-heal]");
    this.claimBagButton = this.require<HTMLButtonElement>("[data-claim-bag]");
    this.rewardState = this.require<HTMLElement>("[data-reward-state]");

    this.windowControls = new InterfaceWindowControls({
      root: this.root,
      header: this.require<HTMLElement>(".dialogue-panel__header"),
      onClose: () => this.hide()
    });
    this.healButton.addEventListener("click", () => {
      if (this.currentNpcId) handlers.onHeal(this.currentNpcId);
    });
    this.claimBagButton.addEventListener("click", () => {
      if (this.currentNpcId) handlers.onClaimBag(this.currentNpcId);
    });
  }

  show(payload: NpcInteractionPayload): void {
    this.currentNpcId = payload.npcId;
    this.name.textContent = payload.npcName;
    this.title.textContent = payload.title;
    this.lines.replaceChildren();

    for (const line of payload.lines) {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      this.lines.appendChild(paragraph);
    }

    const actions = getDialogueActions(payload);
    this.healButton.hidden = !actions.showHeal;
    this.claimBagButton.hidden = !actions.showBagClaim;
    this.rewardState.hidden = !payload.simpleBagRewardClaimed;
    this.rewardState.textContent = payload.simpleBagRewardClaimed
      ? "Odebrałeś już swój Zwykły worek."
      : "";
    this.root.classList.remove("is-hidden");
  }

  hide(): void {
    this.root.classList.add("is-hidden");
    this.currentNpcId = null;
  }

  destroy(): void {
    this.windowControls.destroy();
    this.root.remove();
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Dialogue panel element missing: ${selector}`);
    return element;
  }
}
