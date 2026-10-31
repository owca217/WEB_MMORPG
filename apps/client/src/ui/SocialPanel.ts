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
import { getAssignedContainers } from "./PermanentBackpack";
import { FloatingGameWindow } from "./FloatingGameWindow";

interface SocialPanelHandlers {
  onAction: (action: SocialAction) => Promise<SocialActionResult>;
  onOpen?: () => void;
  onStatusChange?: (status: { opened: boolean; notifications: number }) => void;
}

type ConnectionState = "connected" | "connecting" | "disconnected";
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
  private readonly launcher: HTMLButtonElement;
  private content: HTMLElement;
  private readonly friendsContent: HTMLElement;
  private readonly feedback: HTMLElement;
  private readonly partyWindow: FloatingGameWindow;
  private readonly tradeWindow: FloatingGameWindow;
  private readonly partyFeedback: HTMLElement;
  private readonly tradeFeedback: HTMLElement;
  private readonly viewport: VisualViewport | null;
  private snapshot: SocialSnapshot | null = null;
  private inventory: InventorySnapshot = { items: [] };
  private connection: ConnectionState = "connecting";
  private inBattle = false;
  private opened = false;
  private destroyed = false;
  private returnFocus: HTMLElement | null = null;
  private pending: SocialAction | null = null;
  private error = "";
  private nicknameDraft = "";
  private selectedItemId = "";
  private quantityDraft = "1";
  private draftKey = "";
  private offerDraft: TradeOfferEntry[] = [];
  private partyRulesOpen = false;

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
        <header class="social-widget__header"><div><h2 id="${id}-title">Znajomi</h2><span data-social-connection role="status"></span></div><button type="button" data-close aria-label="Zamknij społeczność">×</button></header>
        <div id="${id}-content" class="social-widget__content" data-social-content role="region" aria-label="Znajomi" tabindex="0"></div>
        <p class="social-widget__feedback" data-social-feedback role="status" aria-live="polite"></p>
      </section>`;
    document.body.appendChild(this.root);
    this.panel = this.require("[data-social-panel]");
    this.launcher = this.require<HTMLButtonElement>("[data-social-toggle]");
    this.content = this.require("[data-social-content]");
    this.friendsContent = this.content;
    this.feedback = this.require("[data-social-feedback]");
    this.partyWindow = new FloatingGameWindow({id:`${id}-party`,title:"Drużyna",width:320,onOpen:()=>this.handlers.onOpen?.()});
    this.tradeWindow = new FloatingGameWindow({id:`${id}-trade`,title:"Handel",width:360,onOpen:()=>this.handlers.onOpen?.()});
    this.partyWindow.element.dataset.floatingGameWindow="party";this.tradeWindow.element.dataset.floatingGameWindow="trade";
    this.partyFeedback=node("p","","social-widget__feedback");this.partyFeedback.dataset.partyFeedback="";
    this.tradeFeedback=node("p","","social-widget__feedback");this.tradeFeedback.dataset.tradeFeedback="";
    for(const [window,feedback] of [[this.partyWindow,this.partyFeedback],[this.tradeWindow,this.tradeFeedback]] as const){feedback.setAttribute("role","status");feedback.setAttribute("aria-live","polite");window.element.append(feedback);}
    this.launcher.addEventListener("click", () => this.toggle());
    this.require("[data-close]").addEventListener("click", () => this.close());
    this.panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); }
    });
    this.viewport = window.visualViewport;
    window.addEventListener("resize", this.updateViewport);
    this.viewport?.addEventListener("resize", this.updateViewport);
    this.viewport?.addEventListener("scroll", this.updateViewport);
    document.addEventListener("game-ui-back", this.onBack);
    this.updateViewport();
    this.render();
  }

  get isTyping(): boolean {
    const active = document.activeElement;
    return !this.destroyed && active instanceof HTMLElement && ((this.opened && this.panel.contains(active)) || (this.partyWindow.isOpen && this.partyWindow.element.contains(active)) || (this.tradeWindow.isOpen && this.tradeWindow.element.contains(active)))
      && (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement || !!active.isContentEditable);
  }

  /** Shared by the world menu and the independent battle launcher. */
  toggle(): void {
    if (this.destroyed) return;
    if (this.opened) this.close();
    else this.open();
  }
  openParty():void { if(!this.destroyed)this.partyWindow.show(); }
  openTrade():void { if(!this.destroyed)this.tradeWindow.show(); }
  inviteToParty(playerId:string):void { this.openParty();const player=this.findPlayer(playerId);if(player&&this.canInviteParty(player))void this.perform({type:"inviteParty",playerId}); }
  requestTrade(playerId:string):void { this.openTrade();const player=this.findPlayer(playerId);if(player&&this.canRequestTrade(player))void this.perform({type:"requestTrade",playerId}); }
  private findPlayer(playerId:string):SocialPlayer|undefined {
    if(!playerId.trim()||!this.snapshot)return undefined;
    // A world player may have joined after the last social poll. Preserve known
    // status restrictions; the server validates an exact target absent in cache.
    return this.snapshot.onlinePlayers.find(player=>player.id===playerId)??this.snapshot.friends.find(player=>player.id===playerId)??{id:playerId,nickname:"Gracz",online:true,inBattle:false};
  }

  update(snapshot: SocialSnapshot | null, inventory: InventorySnapshot, connection: ConnectionState, inBattle: boolean): void {
    if (this.destroyed) return;
    const newPartyInvite=snapshot?.partyInvites.some(invite=>!this.snapshot?.partyInvites.some(old=>old.id===invite.id));
    const newTradeInvite=snapshot?.trade?.status==="invited"&&snapshot.trade.initiatorId!==snapshot.selfId&&snapshot.trade.id!==this.snapshot?.trade?.id;
    const newParty=snapshot?.party?.id&&snapshot.party.id!==this.snapshot?.party?.id;
    const activeTrade=snapshot?.trade?.status==="active"&&(snapshot.trade.id!==this.snapshot?.trade?.id||this.snapshot.trade.status!=="active");
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
    if(newPartyInvite||newParty)this.partyWindow.show(false);
    if(newTradeInvite||activeTrade)this.tradeWindow.show(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("resize", this.updateViewport);
    this.viewport?.removeEventListener("resize", this.updateViewport);
    this.viewport?.removeEventListener("scroll", this.updateViewport);
    document.removeEventListener("game-ui-back", this.onBack);
    this.partyWindow.destroy();this.tradeWindow.destroy();
    this.root.remove();
  }

  private open(): void {
    if (this.destroyed) return;
    const active = document.activeElement;
    this.returnFocus = active instanceof HTMLElement && active !== document.body && !this.panel.contains(active) ? active : this.launcher;
    this.opened = true;
    this.panel.classList.remove("is-hidden");
    this.launcher.setAttribute("aria-expanded", "true");
    this.render();
    this.friendsContent.focus({preventScroll:true});
    this.handlers.onOpen?.();
  }

  private close(): void {
    if (this.destroyed) return;
    this.opened = false;
    this.panel.classList.add("is-hidden");
    this.launcher.setAttribute("aria-expanded", "false");
    (this.returnFocus?.isConnected ? this.returnFocus : this.launcher).focus({ preventScroll: true });
    this.renderBadge();
  }

  private get available(): boolean { return this.connection === "connected" && this.snapshot !== null && this.pending === null; }

  private render(): void {
    for(const surface of [
      {content:this.friendsContent,panel:this.panel,feedback:this.feedback,view:"friends"},
      {content:this.partyWindow.content,panel:this.partyWindow.element,feedback:this.partyFeedback,view:"party"},
      {content:this.tradeWindow.content,panel:this.tradeWindow.element,feedback:this.tradeFeedback,view:"trade"}
    ] as const){
    this.content=surface.content;
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement && this.content.contains(active) ? active.dataset.focusKey : undefined;
    const selection = active instanceof HTMLInputElement && active.type !== "number" ? [active.selectionStart, active.selectionEnd] : null;
    const scrollTop = this.content.scrollTop;
    const connection = this.require("[data-social-connection]");
    connection.textContent = this.connection === "connected" ? "Połączono" : this.connection === "connecting" ? "Łączenie…" : "Brak połączenia";
    connection.dataset.connection = this.connection;
    this.content.replaceChildren();
    if (!this.snapshot) this.content.append(node("p", "Ładowanie danych społeczności…", "social-widget__hint"));
    else if (surface.view === "party") this.renderParty(this.snapshot);
    else if (surface.view === "friends") this.renderFriends(this.snapshot);
    else this.renderTrade(this.snapshot);
    surface.feedback.textContent = this.error || (this.pending ? "Oczekiwanie na serwer…" : this.connection !== "connected" ? "Działania będą dostępne po połączeniu." : "");
    surface.feedback.dataset.state = this.error ? "error" : "idle";
    surface.panel.setAttribute("aria-busy", String(this.pending !== null));
    this.content.scrollTop = scrollTop;
    if (focusKey) {
      const replacement = [...this.content.querySelectorAll<HTMLElement>("[data-focus-key]")].find((element) => element.dataset.focusKey === focusKey);
      replacement?.focus({ preventScroll: true });
      if (selection && replacement instanceof HTMLInputElement) replacement.setSelectionRange(selection[0] ?? 0, selection[1] ?? 0);
    }
    }
    this.content=this.friendsContent;this.partyWindow.refreshLayout();this.tradeWindow.refreshLayout();this.renderBadge();
  }

  private renderBadge(): void {
    const snapshot = this.snapshot;
    const count = snapshot ? snapshot.incomingFriendRequests.length + snapshot.partyInvites.length + (snapshot.trade?.status === "invited" && snapshot.trade.initiatorId !== snapshot.selfId ? 1 : 0) : 0;
    const badge = this.require("[data-social-badge]");
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
    this.launcher.setAttribute("aria-label", `${this.opened ? "Zamknij" : "Otwórz"} społeczność${count ? `, oczekujące zaproszenia: ${count}` : ""}`);
    this.handlers.onStatusChange?.({ opened: this.opened, notifications: count });
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
    const rules=node("details","","social-widget__rules");rules.append(node("summary","Zasady drużyny"),node("p", "Maksymalnie 5 osób. Rozpoczęcie walki dołącza dostępnych członków online z tej samej lokacji, niezależnie od odległości. Wspólna walka daje +10% XP za każdego innego uczestnika drużyny, do +40%. Przy walce solo premia wymaga obecności członka drużyny w odległości do 800.", "social-widget__hint"));members.append(rules);
    rules.open=this.partyRulesOpen;rules.addEventListener("toggle",()=>{if(rules.isConnected){this.partyRulesOpen=rules.open;this.partyWindow.refreshLayout();}});
    if (snapshot.partyInvites.length) {
      const invites = this.section("Zaproszenia do drużyny");
      for (const invite of snapshot.partyInvites) {
        const row = this.playerRow(invite.leader, ` · ${invite.membersCount}/5`);
        row.append(this.actions(this.action("Dołącz", { type: "respondParty", inviteId: invite.id, accept: true }, this.inBattle), this.action("Odrzuć", { type: "respondParty", inviteId: invite.id, accept: false })));
        invites.append(row);
      }
    }
    this.renderPlayerHint("party");
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

  private renderPlayerHint(type: "party" | "trade"): void {
    this.content.append(node("p",this.inBattle?"Zapraszanie jest dostępne poza walką.":`Kliknij gracza prawym przyciskiem myszy lub dotknij go, aby zaprosić ${type==="party"?"do drużyny":"do wymiany"}.`,"social-widget__hint"));
  }

  private renderTrade(snapshot: SocialSnapshot): void {
    const trade = snapshot.trade;
    if (!trade) {
      this.section("Bezpieczna wymiana").append(node("p", "Przedmioty zostaną przekazane po zatwierdzeniu tej samej oferty przez obie osoby.", "social-widget__hint"));
      this.renderPlayerHint("trade");
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
    } else this.renderPlayerHint("trade");
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
    const accessibleParents=new Set(getAssignedContainers(this.inventory).map(item=>item.instanceId));
    const nonempty = new Set(this.inventory.items.map((item) => item.containerInstanceId).filter(Boolean));
    return this.inventory.items.filter((item) => (!item.containerInstanceId||accessibleParents.has(item.containerInstanceId)) && !item.equippedSlot && !item.boundToPlayerId && !item.permanentContainer && !equipped.has(item.instanceId) && !nonempty.has(item.instanceId) && item.quantity > 0);
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
    editor.append(node("p", "Do oferty możesz dodać niezałożone przedmioty z plecaka, założonych pojemników i oczekujących oraz puste pojemniki. Serwer sprawdzi możliwość przekazania każdego przedmiotu.", "social-widget__hint"));
  }

  private async perform(action: SocialAction): Promise<void> {
    if (this.destroyed || !this.available) return;
    if ("revision" in action && (this.snapshot?.trade?.id !== action.tradeId || this.snapshot.trade.revision !== action.revision || this.snapshot.trade.status !== "active")) return;
    if(action.type==="inviteParty")this.openParty();if(action.type==="requestTrade")this.openTrade();
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

  private readonly onBack = (event: Event): void => {
    if (!this.opened || this.destroyed || event.defaultPrevented) return;
    // Chat is the higher layer; a single Back must close only one window.
    if (document.querySelector("[data-chat-panel]:not(.is-hidden)")) return;
    if (document.querySelector("[data-floating-game-window]:not(.is-hidden)")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.close();
  };

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const result = this.root.querySelector<T>(selector);
    if (!result) throw new Error(`Social element missing: ${selector}`);
    return result;
  }
}
