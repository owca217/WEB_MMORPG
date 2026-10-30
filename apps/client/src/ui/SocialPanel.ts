import type {
  InventoryItem,
  InventorySnapshot,
  SocialAction,
  SocialActionResult,
  SocialPlayer,
  SocialSnapshot,
  TradeOfferEntry,
  TradeParticipant,
  TradeSnapshot
} from "@web-mmorpg/shared";
import "./SocialPanel.css";
import { itemQualityText } from "./ItemQualityFrame";

interface SocialPanelHandlers {
  onAction: (action: SocialAction) => Promise<SocialActionResult>;
  onOpen?: () => void;
}

type ConnectionState = "connected" | "connecting" | "disconnected";
type SocialTab = "party" | "friends" | "trade";
const TABS: SocialTab[] = ["party", "friends", "trade"];
const TAB_LABELS: Record<SocialTab, string> = { party: "Drużyna", friends: "Znajomi", trade: "Handel" };
let nextPanelId = 0;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.textContent = text;
  if (className) result.className = className;
  return result;
}

function sameOffer(left: readonly TradeOfferEntry[], right: readonly TradeOfferEntry[]): boolean {
  return left.length === right.length && left.every((entry) => right.some((other) => other.instanceId === entry.instanceId && other.quantity === entry.quantity));
}

export class SocialPanel {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly content: HTMLElement;
  private readonly feedback: HTMLElement;
  private readonly viewport: VisualViewport | null;
  private snapshot: SocialSnapshot | null = null;
  private inventory: InventorySnapshot = { items: [] };
  private connection: ConnectionState = "connecting";
  private inBattle = false;
  private tab: SocialTab = "party";
  private opened = false;
  private destroyed = false;
  private pending: SocialAction | null = null;
  private error = "";
  private nicknameDraft = "";
  private targetId = "";
  private selectedItemId = "";
  private quantityDraft = "1";
  private draftKey = "";
  private offerDraft: TradeOfferEntry[] = [];

  constructor(private readonly handlers: SocialPanelHandlers) {
    const id = `game-social-${++nextPanelId}`;
    this.root = node("div", "", "social-widget");
    this.root.dataset.socialWidget = "";
    this.root.innerHTML = `
      <button type="button" class="social-widget__toggle" data-social-toggle aria-label="Otwórz społeczność" aria-controls="${id}" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M17 13a5 5 0 0 1 4 5v3"/></svg>
        <span class="social-widget__badge" data-social-badge hidden aria-hidden="true"></span>
      </button>
      <section id="${id}" class="game-panel social-widget__panel is-hidden" data-social-panel role="dialog" aria-modal="false" aria-labelledby="${id}-title">
        <header class="social-widget__header"><div><h2 id="${id}-title">Społeczność</h2><span data-social-connection role="status"></span></div><button type="button" data-close aria-label="Zamknij społeczność">×</button></header>
        <div class="social-widget__tabs" role="tablist" aria-label="Społeczność">
          ${TABS.map((tab) => `<button type="button" data-social-tab="${tab}" id="${id}-${tab}" role="tab" aria-controls="${id}-content" aria-selected="${tab === "party"}" tabindex="${tab === "party" ? 0 : -1}">${TAB_LABELS[tab]}</button>`).join("")}
        </div>
        <div id="${id}-content" class="social-widget__content" data-social-content role="tabpanel" tabindex="0"></div>
        <p class="social-widget__feedback" data-social-feedback role="status" aria-live="polite"></p>
      </section>`;
    document.body.appendChild(this.root);
    this.panel = this.require("[data-social-panel]");
    this.toggle = this.require<HTMLButtonElement>("[data-social-toggle]");
    this.content = this.require("[data-social-content]");
    this.feedback = this.require("[data-social-feedback]");
    this.toggle.addEventListener("click", () => this.opened ? this.close() : this.open());
    this.require("[data-close]").addEventListener("click", () => this.close());
    for (const tab of TABS) this.require(`[data-social-tab="${tab}"]`).addEventListener("click", () => this.selectTab(tab));
    this.require("[role=tablist]").addEventListener("keydown", (event) => this.onTabKey(event));
    this.panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); }
    });
    this.viewport = window.visualViewport;
    window.addEventListener("resize", this.updateViewport);
    this.viewport?.addEventListener("resize", this.updateViewport);
    this.viewport?.addEventListener("scroll", this.updateViewport);
    this.updateViewport();
    this.render();
  }

  get isTyping(): boolean {
    const active = document.activeElement;
    return !this.destroyed && this.opened && active instanceof HTMLElement && this.panel.contains(active)
      && (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement || active.isContentEditable);
  }

  update(snapshot: SocialSnapshot | null, inventory: InventorySnapshot, connection: ConnectionState, inBattle: boolean): void {
    if (this.destroyed) return;
    this.snapshot = snapshot;
    this.inventory = inventory;
    this.connection = connection;
    this.inBattle = inBattle;
    const trade = snapshot?.trade;
    const key = trade ? `${snapshot.selfId}:${trade.id}:${trade.revision}` : "";
    if (key !== this.draftKey) {
      this.draftKey = key;
      this.offerDraft = trade?.participants.find((participant) => participant.player.id === snapshot?.selfId)?.offer.map(({ instanceId, quantity }) => ({ instanceId, quantity })) ?? [];
      this.selectedItemId = "";
      this.quantityDraft = "1";
    }
    this.render();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("resize", this.updateViewport);
    this.viewport?.removeEventListener("resize", this.updateViewport);
    this.viewport?.removeEventListener("scroll", this.updateViewport);
    this.root.remove();
  }

  private open(): void {
    if (this.destroyed) return;
    this.opened = true;
    this.panel.classList.remove("is-hidden");
    this.toggle.setAttribute("aria-expanded", "true");
    this.render();
    this.require<HTMLButtonElement>(`[data-social-tab="${this.tab}"]`).focus();
    this.handlers.onOpen?.();
  }

  private close(): void {
    if (this.destroyed) return;
    this.opened = false;
    this.panel.classList.add("is-hidden");
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.focus();
    this.renderBadge();
  }

  private selectTab(tab: SocialTab): void {
    if (this.destroyed || this.tab === tab) return;
    this.tab = tab;
    this.content.scrollTop = 0;
    this.render();
  }

  private onTabKey(event: KeyboardEvent): void {
    if (!(event.target instanceof HTMLElement) || !event.target.closest("[data-social-tab]")) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.indexOf(this.tab);
    const tab = event.key === "Home" ? TABS[0] : event.key === "End" ? TABS.at(-1) : TABS[(index + (event.key === "ArrowRight" ? 1 : 2)) % TABS.length];
    if (tab) { this.selectTab(tab); this.require<HTMLButtonElement>(`[data-social-tab="${tab}"]`).focus(); }
  }

  private get available(): boolean { return this.connection === "connected" && this.snapshot !== null && this.pending === null; }

  private render(): void {
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement && this.content.contains(active) ? active.dataset.focusKey : undefined;
    const selection = active instanceof HTMLInputElement && active.type !== "number" ? [active.selectionStart, active.selectionEnd] : null;
    const scrollTop = this.content.scrollTop;
    for (const tab of TABS) {
      const button = this.require<HTMLButtonElement>(`[data-social-tab="${tab}"]`);
      button.setAttribute("aria-selected", String(tab === this.tab));
      button.tabIndex = tab === this.tab ? 0 : -1;
      if (tab === this.tab) this.content.setAttribute("aria-labelledby", button.id);
    }
    const connection = this.require("[data-social-connection]");
    connection.textContent = this.connection === "connected" ? "Połączono" : this.connection === "connecting" ? "Łączenie…" : "Brak połączenia";
    connection.dataset.connection = this.connection;
    this.content.replaceChildren();
    if (!this.snapshot) this.content.append(node("p", "Ładowanie danych społeczności…", "social-widget__hint"));
    else if (this.tab === "party") this.renderParty(this.snapshot);
    else if (this.tab === "friends") this.renderFriends(this.snapshot);
    else this.renderTrade(this.snapshot);
    this.feedback.textContent = this.error || (this.pending ? "Oczekiwanie na serwer…" : this.connection !== "connected" ? "Działania będą dostępne po połączeniu." : "");
    this.feedback.dataset.state = this.error ? "error" : "idle";
    this.panel.setAttribute("aria-busy", String(this.pending !== null));
    this.renderBadge();
    this.content.scrollTop = scrollTop;
    if (focusKey) {
      const replacement = [...this.content.querySelectorAll<HTMLElement>("[data-focus-key]")].find((element) => element.dataset.focusKey === focusKey);
      replacement?.focus({ preventScroll: true });
      if (selection && replacement instanceof HTMLInputElement) replacement.setSelectionRange(selection[0] ?? 0, selection[1] ?? 0);
    }
  }

  private renderBadge(): void {
    const snapshot = this.snapshot;
    const count = snapshot ? snapshot.incomingFriendRequests.length + snapshot.partyInvites.length + (snapshot.trade?.status === "invited" && snapshot.trade.initiatorId !== snapshot.selfId ? 1 : 0) : 0;
    const badge = this.require("[data-social-badge]");
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
    this.toggle.setAttribute("aria-label", `${this.opened ? "Zamknij" : "Otwórz"} społeczność${count ? `, oczekujące zaproszenia: ${count}` : ""}`);
  }

  private section(title: string): HTMLElement {
    const result = node("section", "", "social-widget__section");
    result.append(node("h3", title));
    this.content.append(result);
    return result;
  }

  private playerRow(player: SocialPlayer, suffix = ""): HTMLElement {
    const result = node("div", "", "social-widget__row");
    const info = node("div", "", "social-widget__player");
    info.append(node("strong", `${player.nickname}${suffix}`), node("small", player.unavailable ? "Konto nieaktywne" : `${player.online ? "Online" : "Offline"}${player.inBattle ? " · w walce" : ""}${player.level === undefined ? "" : ` · poziom ${player.level}`}`));
    result.append(info);
    return result;
  }

  private action(label: string, action: SocialAction, disabled = false): HTMLButtonElement {
    const result = node("button", label);
    result.type = "button";
    result.dataset.socialAction = action.type;
    if ("accept" in action) result.dataset.accept = String(action.accept);
    result.disabled = !this.available || disabled;
    result.addEventListener("click", () => { if (!result.disabled) void this.perform(action); });
    return result;
  }

  private actions(...buttons: HTMLButtonElement[]): HTMLElement {
    const result = node("div", "", "social-widget__actions");
    result.append(...buttons);
    return result;
  }

  private canInviteParty(player: SocialPlayer): boolean {
    const party = this.snapshot?.party;
    return !this.inBattle && !player.unavailable && player.online && !player.inBattle && player.id !== this.snapshot?.selfId
      && (!party || party.leaderId === this.snapshot?.selfId && party.members.length < 5 && !party.members.some((member) => member.id === player.id));
  }

  private canRequestTrade(player: SocialPlayer): boolean {
    const trade = this.snapshot?.trade;
    return !this.inBattle && !player.unavailable && player.online && !player.inBattle && player.id !== this.snapshot?.selfId && (!trade || trade.status === "cancelled" || trade.status === "completed");
  }

  private renderParty(snapshot: SocialSnapshot): void {
    const party = snapshot.party;
    const members = this.section(party ? `Drużyna · ${party.members.length}/5` : "Twoja drużyna");
    if (party) {
      members.append(node("p", `Premia drużyny: do +${party.experienceBonusPercent}% XP`, "social-widget__bonus"));
      for (const player of party.members) {
        const row = this.playerRow(player, player.id === party.leaderId ? " · lider" : "");
        if (party.leaderId === snapshot.selfId && player.id !== snapshot.selfId) row.append(this.action("Usuń", { type: "kickParty", playerId: player.id }));
        members.append(row);
      }
      members.append(this.action("Opuść drużynę", { type: "leaveParty" }));
    } else members.append(node("p", "Nie należysz jeszcze do drużyny.", "social-widget__hint"));
    members.append(node("p", "Maksymalnie 5 osób. Rozpoczęcie walki dołącza dostępnych członków online z tej samej lokacji, niezależnie od odległości. Wspólna walka daje +10% XP za każdego innego uczestnika drużyny, do +40%. Przy walce solo premia wymaga obecności członka drużyny w odległości do 800.", "social-widget__hint"));
    if (snapshot.partyInvites.length) {
      const invites = this.section("Zaproszenia do drużyny");
      for (const invite of snapshot.partyInvites) {
        const row = this.playerRow(invite.leader, ` · ${invite.membersCount}/5`);
        row.append(this.actions(this.action("Dołącz", { type: "respondParty", inviteId: invite.id, accept: true }, this.inBattle), this.action("Odrzuć", { type: "respondParty", inviteId: invite.id, accept: false })));
        invites.append(row);
      }
    }
    this.renderTarget(snapshot, "party");
  }

  private renderFriends(snapshot: SocialSnapshot): void {
    const request = this.section("Dodaj znajomego");
    const form = node("form", "", "social-widget__form");
    const label = node("label", "Nick postaci");
    const input = node("input");
    input.type = "text";
    input.maxLength = 40;
    input.autocomplete = "off";
    input.placeholder = "Wpisz nick";
    input.value = this.nicknameDraft;
    input.dataset.friendNickname = "";
    input.dataset.focusKey = "friend-nickname";
    input.addEventListener("input", () => { this.nicknameDraft = input.value; this.render(); });
    label.append(input);
    const send = this.action("Wyślij zaproszenie", { type: "requestFriend", nickname: this.nicknameDraft.trim() }, !this.nicknameDraft.trim());
    form.addEventListener("submit", (event) => { event.preventDefault(); if (!send.disabled) send.click(); });
    form.append(label, send);
    request.append(form);
    if (snapshot.incomingFriendRequests.length) {
      const incoming = this.section("Otrzymane zaproszenia");
      for (const player of snapshot.incomingFriendRequests) {
        const row = this.playerRow(player);
        row.append(this.actions(this.action("Akceptuj", { type: "respondFriend", playerId: player.id, accept: true }, Boolean(player.unavailable)), this.action("Odrzuć", { type: "respondFriend", playerId: player.id, accept: false })));
        incoming.append(row);
      }
    }
    if (snapshot.outgoingFriendRequests.length) {
      const outgoing = this.section("Wysłane zaproszenia");
      for (const player of snapshot.outgoingFriendRequests) {
        const row = this.playerRow(player, " · oczekuje");
        row.append(this.action("Anuluj zaproszenie", { type: "removeFriend", playerId: player.id }));
        outgoing.append(row);
      }
    }
    const accepted = this.section(`Znajomi · ${snapshot.friends.length}`);
    if (!snapshot.friends.length) accepted.append(node("p", "Lista znajomych jest pusta.", "social-widget__hint"));
    for (const player of snapshot.friends) {
      const row = this.playerRow(player);
      row.append(this.actions(this.action("Do drużyny", { type: "inviteParty", playerId: player.id }, !this.canInviteParty(player)), this.action("Handel", { type: "requestTrade", playerId: player.id }, !this.canRequestTrade(player)), this.action("Usuń", { type: "removeFriend", playerId: player.id })));
      accepted.append(row);
    }
  }

  private renderTarget(snapshot: SocialSnapshot, type: "party" | "trade"): void {
    const section = this.section("Gracze online");
    const players = snapshot.onlinePlayers.filter((player) => player.id !== snapshot.selfId && player.online);
    if (!players.length) { section.append(node("p", "Brak innych graczy online.", "social-widget__hint")); return; }
    if (!players.some((player) => player.id === this.targetId)) this.targetId = players[0]?.id ?? "";
    const label = node("label", "Wybierz gracza");
    const select = node("select");
    select.dataset.socialTarget = "";
    select.dataset.focusKey = "social-target";
    for (const player of players) { const option = node("option", `${player.nickname}${player.inBattle ? " · w walce" : ""}`); option.value = player.id; select.append(option); }
    select.value = this.targetId;
    select.addEventListener("change", () => { this.targetId = select.value; this.render(); });
    label.append(select);
    const player = players.find((player) => player.id === this.targetId);
    const action: SocialAction = type === "party" ? { type: "inviteParty", playerId: this.targetId } : { type: "requestTrade", playerId: this.targetId };
    section.append(label, this.action(type === "party" ? "Zaproś do drużyny" : "Zaproś do wymiany", action, !player || !(type === "party" ? this.canInviteParty(player) : this.canRequestTrade(player))));
    if (this.inBattle) section.append(node("p", "Zapraszanie jest dostępne poza walką.", "social-widget__hint"));
  }

  private renderTrade(snapshot: SocialSnapshot): void {
    const trade = snapshot.trade;
    if (!trade) {
      this.section("Bezpieczna wymiana").append(node("p", "Zaproś gracza i poczekaj na jego zgodę. Przedmioty zostaną przekazane dopiero po zatwierdzeniu tej samej oferty przez obie osoby.", "social-widget__hint"));
      this.renderTarget(snapshot, "trade");
      return;
    }
    const partner = trade.participants.find((participant) => participant.player.id !== snapshot.selfId);
    if (trade.status === "invited") {
      const invitation = this.section(trade.initiatorId === snapshot.selfId ? "Wysłano zaproszenie do wymiany" : "Zaproszenie do wymiany");
      invitation.append(node("p", partner?.player.nickname ?? "Gracz"));
      if (trade.initiatorId !== snapshot.selfId) invitation.append(this.actions(this.action("Akceptuj", { type: "respondTrade", tradeId: trade.id, accept: true }, this.inBattle || Boolean(partner?.player.inBattle) || !partner?.player.online), this.action("Odrzuć", { type: "respondTrade", tradeId: trade.id, accept: false })));
      else invitation.append(this.action("Anuluj zaproszenie", { type: "cancelTrade", tradeId: trade.id }));
      return;
    }
    const self = trade.participants.find((participant) => participant.player.id === snapshot.selfId);
    const review = this.section(trade.status === "completed" ? "Wymiana zakończona" : trade.status === "cancelled" ? "Wymiana anulowana" : "Oferty wymiany");
    if (trade.status === "completed") review.append(node("p", "Przedmioty zostały przekazane obu graczom.", "social-widget__bonus"));
    if (trade.cancelReason) review.append(node("p", trade.cancelReason, "social-widget__hint"));
    for (const participant of trade.participants) this.renderOffer(review, participant, participant.player.id === snapshot.selfId);
    if (trade.status === "active" && self) {
      review.append(node("p", "Każda zmiana oferty usuwa oba zatwierdzenia. Sprawdź obie strony i zatwierdź aktualną wersję wymiany.", "social-widget__hint"));
      this.renderOfferEditor(trade, self);
    } else this.renderTarget(snapshot, "trade");
  }

  private renderOffer(parent: HTMLElement, participant: TradeParticipant, own: boolean): void {
    const offer = node("article", "", "social-widget__offer");
    offer.append(node("h4", own ? `Twoja oferta · ${participant.player.nickname}` : `Oferta · ${participant.player.nickname}`));
    offer.append(node("p", participant.confirmed ? "Zatwierdzono" : "Oczekuje na zatwierdzenie", participant.confirmed ? "social-widget__confirmed" : "social-widget__hint"));
    if (!participant.offer.length) offer.append(node("p", "Brak przedmiotów", "social-widget__hint"));
    else { const list = node("ul"); for (const item of participant.offer) list.append(node("li", `${item.name} ×${item.quantity} · ${itemQualityText(item)}`)); offer.append(list); }
    parent.append(offer);
  }

  private eligibleItems(): InventoryItem[] {
    const equipped = new Set(this.inventory.containerSlots?.filter((id) => id !== null));
    const nonempty = new Set(this.inventory.items.map((item) => item.containerInstanceId).filter(Boolean));
    return this.inventory.items.filter((item) => !item.containerInstanceId && !item.boundToPlayerId && !item.permanentContainer && !equipped.has(item.instanceId) && !nonempty.has(item.instanceId) && item.quantity > 0);
  }

  private renderOfferEditor(trade: TradeSnapshot, self: TradeParticipant): void {
    const editor = this.section("Edytuj swoją ofertę");
    const eligible = this.eligibleItems();
    if (!eligible.some((item) => item.instanceId === this.selectedItemId)) this.selectedItemId = eligible[0]?.instanceId ?? "";
    const selected = eligible.find((item) => item.instanceId === this.selectedItemId);
    const builder = node("div", "", "social-widget__offer-builder");
    const itemLabel = node("label", "Przedmiot z ekwipunku");
    const select = node("select");
    select.dataset.tradeItem = "";
    select.dataset.focusKey = "trade-item";
    select.disabled = !this.available || !eligible.length;
    for (const item of eligible) { const option = node("option", `${item.name} · ${itemQualityText(item)} · posiadasz ${item.quantity}`); option.value = item.instanceId; select.append(option); }
    if (!eligible.length) select.append(node("option", "Brak dostępnych przedmiotów"));
    select.value = this.selectedItemId;
    select.addEventListener("change", () => { this.selectedItemId = select.value; this.quantityDraft = "1"; this.render(); });
    itemLabel.append(select);
    const quantityLabel = node("label", "Ilość");
    const quantity = node("input");
    quantity.type = "number";
    quantity.inputMode = "numeric";
    quantity.min = "1";
    quantity.max = String(selected?.quantity ?? 1);
    quantity.step = "1";
    quantity.value = this.quantityDraft;
    quantity.dataset.tradeQuantity = "";
    quantity.dataset.focusKey = "trade-quantity";
    quantity.disabled = !this.available || !selected;
    quantity.addEventListener("input", () => { this.quantityDraft = quantity.value; this.render(); });
    quantityLabel.append(quantity);
    const count = Number(this.quantityDraft);
    const validQuantity = Boolean(selected) && Number.isSafeInteger(count) && count >= 1 && count <= (selected?.quantity ?? 0);
    const add = node("button", "Dodaj / zmień");
    add.type = "button";
    add.dataset.tradeAdd = "";
    add.disabled = !this.available || !validQuantity || this.inBattle;
    add.addEventListener("click", () => {
      if (add.disabled || !selected || this.snapshot?.trade?.id !== trade.id || this.snapshot.trade.revision !== trade.revision) return;
      this.offerDraft = [...this.offerDraft.filter((item) => item.instanceId !== selected.instanceId), { instanceId: selected.instanceId, quantity: count }];
      this.error = "";
      this.render();
    });
    builder.append(itemLabel, quantityLabel, add);
    editor.append(builder);
    const draft = node("div", "", "social-widget__draft");
    draft.dataset.tradeDraft = "";
    draft.append(node("h4", "Twoja oferta do zapisania"));
    if (!this.offerDraft.length) draft.append(node("p", "Brak przedmiotów", "social-widget__hint"));
    for (const item of this.offerDraft) {
      const identity = this.inventory.items.find((owned) => owned.instanceId === item.instanceId) ?? self.offer.find((offered) => offered.instanceId === item.instanceId);
      const name = identity?.name ?? "Przedmiot";
      const row = node("div", "", "social-widget__row");
      const remove = node("button", "Usuń z oferty");
      remove.type = "button";
      remove.dataset.tradeRemove = "";
      remove.disabled = !this.available;
      remove.addEventListener("click", () => { if (!remove.disabled) { this.offerDraft = this.offerDraft.filter((entry) => entry.instanceId !== item.instanceId); this.render(); } });
      row.append(node("span", `${name} ×${item.quantity} · ${itemQualityText(identity??{})}`), remove);
      draft.append(row);
    }
    editor.append(draft);
    const dirty = !sameOffer(this.offerDraft, self.offer);
    const save = this.action("Zapisz ofertę", { type: "setTradeOffer", tradeId: trade.id, revision: trade.revision, items: this.offerDraft.map((entry) => ({ ...entry })) }, !dirty || this.inBattle);
    save.dataset.tradeSave = "";
    const confirm = this.action("Zatwierdź wymianę", { type: "confirmTrade", tradeId: trade.id, revision: trade.revision }, dirty || self.confirmed || this.inBattle || trade.participants.some((participant) => !participant.player.online || participant.player.inBattle));
    confirm.dataset.tradeConfirm = "";
    editor.append(node("p", dirty ? "Masz niezapisane zmiany. Zapisz ofertę przed zatwierdzeniem." : `Aktualna oferta · wersja ${trade.revision}`, "social-widget__hint"), this.actions(save, confirm, this.action("Anuluj wymianę", { type: "cancelTrade", tradeId: trade.id })));
    editor.append(node("p", "Do oferty możesz dodać niezałożone przedmioty z głównego ekwipunku i puste pojemniki. Serwer sprawdzi możliwość przekazania każdego przedmiotu.", "social-widget__hint"));
  }

  private async perform(action: SocialAction): Promise<void> {
    if (this.destroyed || !this.available) return;
    if ("revision" in action && (this.snapshot?.trade?.id !== action.tradeId || this.snapshot.trade.revision !== action.revision || this.snapshot.trade.status !== "active")) return;
    this.pending = action;
    this.error = "";
    this.render();
    try {
      const result = await this.handlers.onAction(action);
      if (this.destroyed) return;
      if (!result.ok) this.error = result.message;
    } catch {
      if (this.destroyed) return;
      this.error = "Nie udało się wykonać działania. Spróbuj ponownie.";
    } finally {
      if (!this.destroyed) { this.pending = null; this.render(); }
    }
  }

  private readonly updateViewport = (): void => {
    if (this.destroyed) return;
    const height = this.viewport?.height ?? window.innerHeight;
    this.root.style.setProperty("--social-viewport-height", `${height}px`);
    this.root.style.setProperty("--social-viewport-top", `${this.viewport?.offsetTop ?? 0}px`);
    this.root.dataset.compact = String(height <= 330);
  };

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const result = this.root.querySelector<T>(selector);
    if (!result) throw new Error(`Social element missing: ${selector}`);
    return result;
  }
}
