import type {
  PartyInvitePayload,
  PartySnapshot,
  PlayerId,
  WorldPlayerSnapshot
} from "@web-mmorpg/shared";

interface PartyPanelHandlers {
  onInvite: (targetPlayerId: PlayerId) => void;
  onRespond: (inviteId: string, accept: boolean) => void;
  onLeave: () => void;
}

export class PartyPanel {
  private readonly root: HTMLDivElement;
  private readonly members: HTMLDivElement;
  private contextMenu: HTMLDivElement | undefined;
  private inviteDialog: HTMLDivElement | undefined;
  private inviteTimer: number | undefined;

  constructor(private readonly handlers: PartyPanelHandlers) {
    this.root = document.createElement("div");
    this.root.className = "party-panel";
    this.root.hidden = true;

    const header = document.createElement("div");
    header.className = "party-panel__header";

    const title = document.createElement("strong");
    title.textContent = "Drużyna";

    const leave = document.createElement("button");
    leave.type = "button";
    leave.textContent = "Opuść";
    leave.addEventListener("click", () => this.handlers.onLeave());

    header.append(title, leave);
    this.members = document.createElement("div");
    this.members.className = "party-panel__members";
    this.root.append(header, this.members);
    document.body.appendChild(this.root);
  }

  update(snapshot: PartySnapshot | null): void {
    this.members.replaceChildren();
    if (!snapshot) {
      this.root.hidden = true;
      return;
    }

    this.root.hidden = false;
    for (const member of snapshot.members) {
      const row = document.createElement("div");
      row.className = "party-panel__member";

      const name = document.createElement("span");
      name.textContent = member.nickname;

      const role = document.createElement("span");
      role.className = "party-panel__leader";
      role.textContent = member.leader ? "Lider" : "";

      row.append(name, role);
      this.members.appendChild(row);
    }
  }

  showPlayerMenu(
    player: WorldPlayerSnapshot,
    x: number,
    y: number
  ): void {
    this.hidePlayerMenu();

    const menu = document.createElement("div");
    menu.className = "player-context-menu";

    const name = document.createElement("strong");
    name.textContent = player.nickname;

    const invite = document.createElement("button");
    invite.type = "button";
    invite.textContent = "Zaproś do drużyny";
    invite.addEventListener("click", () => {
      this.handlers.onInvite(player.id);
      this.hidePlayerMenu();
    });

    menu.append(name, invite);
    document.body.appendChild(menu);

    const margin = 8;
    const left = Math.min(
      Math.max(margin, x),
      Math.max(margin, window.innerWidth - menu.offsetWidth - margin)
    );
    const top = Math.min(
      Math.max(margin, y),
      Math.max(margin, window.innerHeight - menu.offsetHeight - margin)
    );
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    this.contextMenu = menu;
  }

  hidePlayerMenu(): void {
    this.contextMenu?.remove();
    this.contextMenu = undefined;
  }

  showInvite(invite: PartyInvitePayload): void {
    this.inviteDialog?.remove();
    if (this.inviteTimer !== undefined) {
      window.clearTimeout(this.inviteTimer);
      this.inviteTimer = undefined;
    }

    const dialog = document.createElement("div");
    dialog.className = "party-invite-dialog";

    const message = document.createElement("p");
    message.textContent = `${invite.inviterNickname} zaprasza Cię do drużyny.`;

    const actions = document.createElement("div");
    actions.className = "party-invite-dialog__actions";

    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = "Akceptuj";

    const decline = document.createElement("button");
    decline.type = "button";
    decline.dataset.decline = "";
    decline.textContent = "Odrzuć";

    const respond = (accepted: boolean) => {
      this.handlers.onRespond(invite.inviteId, accepted);
      dialog.remove();
      if (this.inviteDialog === dialog) this.inviteDialog = undefined;
      if (this.inviteTimer !== undefined) {
        window.clearTimeout(this.inviteTimer);
        this.inviteTimer = undefined;
      }
    };

    accept.addEventListener("click", () => respond(true));
    decline.addEventListener("click", () => respond(false));

    actions.append(accept, decline);
    dialog.append(message, actions);
    document.body.appendChild(dialog);
    this.inviteDialog = dialog;

    const delay = Math.max(0, invite.expiresAt - Date.now());
    this.inviteTimer = window.setTimeout(() => {
      dialog.remove();
      if (this.inviteDialog === dialog) this.inviteDialog = undefined;
      this.inviteTimer = undefined;
    }, delay);
  }

  destroy(): void {
    if (this.inviteTimer !== undefined) window.clearTimeout(this.inviteTimer);
    this.root.remove();
    this.contextMenu?.remove();
    this.inviteDialog?.remove();
    this.contextMenu = undefined;
    this.inviteDialog = undefined;
    this.inviteTimer = undefined;
  }
}
