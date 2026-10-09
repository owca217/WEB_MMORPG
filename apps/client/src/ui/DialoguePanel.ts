import type { NpcInteractionPayload } from "@web-mmorpg/shared";

interface DialoguePanelHandlers {
  onHeal: (npcId: string) => void;
}

export class DialoguePanel {
  private readonly root: HTMLDivElement;
  private readonly name: HTMLElement;
  private readonly title: HTMLElement;
  private readonly lines: HTMLDivElement;
  private readonly healButton: HTMLButtonElement;
  private currentNpcId: string | null = null;

  constructor(handlers: DialoguePanelHandlers) {
    this.root = document.createElement("div");
    this.root.className = "dialogue-panel is-hidden";
    this.root.innerHTML = `
      <div class="dialogue-panel__header">
        <div>
          <strong data-name>NPC</strong>
          <span data-title></span>
        </div>
        <button type="button" data-close aria-label="Zamknij">×</button>
      </div>
      <div class="dialogue-panel__lines" data-lines></div>
      <div class="dialogue-panel__actions">
        <button type="button" data-heal>Opatrz rany</button>
      </div>
    `;
    document.body.appendChild(this.root);

    this.name = this.require("[data-name]");
    this.title = this.require("[data-title]");
    this.lines = this.require<HTMLDivElement>("[data-lines]");
    this.healButton = this.require<HTMLButtonElement>("[data-heal]");

    this.require<HTMLButtonElement>("[data-close]").addEventListener("click", () => this.hide());
    this.healButton.addEventListener("click", () => {
      if (this.currentNpcId) handlers.onHeal(this.currentNpcId);
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

    this.healButton.hidden = !payload.canHeal;
    this.root.classList.remove("is-hidden");
  }

  hide(): void {
    this.root.classList.add("is-hidden");
    this.currentNpcId = null;
  }

  destroy(): void {
    this.root.remove();
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Dialogue panel element missing: ${selector}`);
    return element;
  }
}
