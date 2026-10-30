import type { MerchantOffer, MerchantPurchase, MerchantResult, MerchantSnapshot } from "@web-mmorpg/shared";
import "./ShopPanel.css";
import { itemQualityText } from "./ItemQualityFrame";

interface MerchantPanelHandlers {
  onPurchase: (payload: MerchantPurchase) => Promise<MerchantResult>;
  onPurchased?: (result: Extract<MerchantResult, { ok: true }>) => void;
  onTypingChange?: () => void;
}

interface OfferView {
  offer: MerchantOffer;
  quantity: HTMLInputElement;
  total: HTMLElement;
  buy: HTMLButtonElement;
}

let nextMerchantPanelId = 0;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

export class MerchantPanel {
  private readonly root = node("div", "", "merchant-widget");
  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly gold: HTMLElement;
  private readonly offers: HTMLElement;
  private readonly feedback: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly viewport: VisualViewport | null;
  private readonly offerViews = new Map<string, OfferView>();
  private shop: MerchantSnapshot | null = null;
  private opened = false;
  private destroyed = false;
  private pending = false;
  private uncertain: MerchantPurchase | null = null;
  private epoch = 0;
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly handlers: MerchantPanelHandlers) {
    const id = `game-merchant-${++nextMerchantPanelId}`;
    this.root.innerHTML = `
      <section class="game-panel merchant-panel is-hidden" data-merchant-panel role="dialog" aria-modal="false" aria-labelledby="${id}-title">
        <header class="merchant-panel__header"><div><span class="merchant-panel__eyebrow">Kupiec · zaopatrzenie podróżnika</span><h2 id="${id}-title" data-merchant-title></h2></div><button type="button" data-close aria-label="Zamknij sklep">×</button></header>
        <p class="merchant-panel__wallet">Twoje złoto: <strong data-merchant-gold></strong></p>
        <p class="merchant-panel__hint">Wybierz ilość i kup przedmiot. Zakupy trafiają do twojego ekwipunku. Worek możesz umieścić w jednym z czterech slotów pojemników.</p>
        <div class="merchant-panel__offers" data-merchant-offers role="list" aria-label="Towary kupca"></div>
        <footer class="merchant-panel__footer"><p class="merchant-panel__feedback" data-merchant-feedback role="status" aria-live="polite"></p><button type="button" data-merchant-retry hidden>Ponów sprawdzenie zakupu</button></footer>
      </section>`;
    document.body.appendChild(this.root);
    this.panel = this.require("[data-merchant-panel]");
    this.title = this.require("[data-merchant-title]");
    this.gold = this.require("[data-merchant-gold]");
    this.offers = this.require("[data-merchant-offers]");
    this.feedback = this.require("[data-merchant-feedback]");
    this.retry = this.require<HTMLButtonElement>("[data-merchant-retry]");
    this.require<HTMLButtonElement>("[data-close]").addEventListener("click", () => this.hide());
    this.retry.addEventListener("click", () => { if (this.uncertain && !this.pending) void this.purchase(this.uncertain); });
    this.panel.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.hide(); }
    });
    this.panel.addEventListener("focusin", this.onFocusChange);
    this.panel.addEventListener("focusout", this.onFocusOut);
    this.viewport = window.visualViewport;
    window.addEventListener("resize", this.updateViewport);
    this.viewport?.addEventListener("resize", this.updateViewport);
    this.viewport?.addEventListener("scroll", this.updateViewport);
    this.updateViewport();
  }

  get isTyping(): boolean {
    const active = document.activeElement;
    return !this.destroyed && this.opened && this.panel.contains(active)
      && (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement);
  }

  show(shop: MerchantSnapshot): void {
    if (this.destroyed) return;
    if (!this.opened) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.epoch += 1;
    this.pending = false;
    this.uncertain = null;
    this.shop = structuredClone(shop);
    this.opened = true;
    this.panel.classList.remove("is-hidden");
    this.title.textContent = `${shop.npcName} · sklep`;
    this.setFeedback("");
    this.renderOffers();
    this.updateControls();
    this.require<HTMLButtonElement>("[data-close]").focus();
  }

  updateGold(gold: number): void {
    if (this.destroyed || !this.shop || !Number.isSafeInteger(gold) || gold < 0) return;
    this.shop.gold = gold;
    this.updateControls();
  }

  hide(): void {
    if (this.destroyed) return;
    this.epoch += 1;
    this.opened = false;
    this.pending = false;
    this.uncertain = null;
    this.panel.classList.add("is-hidden");
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
    else if (document.activeElement instanceof HTMLElement && this.panel.contains(document.activeElement)) document.activeElement.blur();
    this.returnFocus = null;
    this.handlers.onTypingChange?.();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.hide();
    this.destroyed = true;
    window.removeEventListener("resize", this.updateViewport);
    this.viewport?.removeEventListener("resize", this.updateViewport);
    this.viewport?.removeEventListener("scroll", this.updateViewport);
    this.panel.removeEventListener("focusin", this.onFocusChange);
    this.panel.removeEventListener("focusout", this.onFocusOut);
    this.root.remove();
  }

  private readonly onFocusChange = (): void => { if (!this.destroyed) this.handlers.onTypingChange?.(); };
  private readonly onFocusOut = (): void => { queueMicrotask(this.onFocusChange); };
  private readonly updateViewport = (): void => {
    this.root.style.setProperty("--merchant-viewport-top", `${this.viewport?.offsetTop ?? 0}px`);
    this.root.style.setProperty("--merchant-viewport-height", `${this.viewport?.height ?? window.innerHeight}px`);
  };

  private renderOffers(): void {
    this.offerViews.clear();
    this.offers.replaceChildren();
    for (const offer of this.shop?.offers ?? []) {
      const card = node("section", "", "merchant-panel__offer");
      card.setAttribute("role", "listitem");
      card.appendChild(node("h3", offer.name));
      card.appendChild(node("p", offer.description, "merchant-panel__description"));
      const details: string[] = [];
      if (offer.healHp) details.push(`Leczy ${offer.healHp} HP`);
      if (offer.restoreAp) details.push(`Przywraca ${offer.restoreAp} PA`);
      if (offer.capacity) details.push(`${offer.capacity} miejsc`);
      if (!details.length) details.push(offer.categoryId === "weapon" ? "Broń" : offer.categoryId === "armor" ? "Uzbrojenie" : offer.categoryId === "container" ? "Pojemnik" : "Przedmiot użytkowy");
      details.push(itemQualityText(offer));
      card.appendChild(node("p", details.join(" · "), "merchant-panel__effect"));
      card.appendChild(node("p", `${offer.unitPrice} złota / szt.`, "merchant-panel__price"));
      const actions = node("div", "", "merchant-panel__actions");
      const label = node("label", `Ilość: ${offer.name}`);
      const quantity = node("input");
      quantity.type = "number";
      quantity.min = "1";
      quantity.max = String(offer.maxQuantity);
      quantity.step = "1";
      quantity.inputMode = "numeric";
      quantity.value = "1";
      quantity.dataset.merchantQuantity = offer.itemId;
      label.appendChild(quantity);
      const total = node("span", "", "merchant-panel__total");
      total.dataset.merchantTotal = offer.itemId;
      const buy = node("button", "Kup");
      buy.type = "button";
      buy.dataset.merchantBuy = offer.itemId;
      buy.setAttribute("aria-label", `Kup: ${offer.name}`);
      const view = { offer, quantity, total, buy };
      quantity.addEventListener("input", () => this.updateControls());
      buy.addEventListener("click", () => {
        const count = this.validQuantity(view);
        if (!this.shop || count === null || buy.disabled || this.pending || this.uncertain) return;
        void this.purchase({ npcId: this.shop.npcId, requestId: crypto.randomUUID(), itemId: offer.itemId, quantity: count });
      });
      actions.append(label, total, buy);
      card.appendChild(actions);
      this.offers.appendChild(card);
      this.offerViews.set(offer.itemId, view);
    }
    if (!this.shop?.offers.length) this.offers.appendChild(node("p", "Kupiec nie ma teraz dostępnych towarów."));
  }

  private validQuantity(view: OfferView): number | null {
    const value = Number(view.quantity.value);
    return Number.isInteger(value) && value >= 1 && value <= view.offer.maxQuantity ? value : null;
  }

  private updateControls(): void {
    this.gold.textContent = `${this.shop?.gold ?? 0}`;
    const blocked = this.pending || this.uncertain !== null;
    for (const view of this.offerViews.values()) {
      const quantity = this.validQuantity(view);
      const cost = quantity === null ? null : quantity * view.offer.unitPrice;
      const affordable = cost !== null && cost <= (this.shop?.gold ?? 0);
      view.quantity.disabled = blocked;
      view.buy.disabled = !this.opened || blocked || !affordable;
      view.total.textContent = cost === null ? `Ilość: 1–${view.offer.maxQuantity}` : `Razem: ${cost} złota${affordable ? "" : " · za mało złota"}`;
      view.total.dataset.affordable = String(affordable);
    }
    this.retry.hidden = this.uncertain === null;
    this.retry.disabled = this.pending;
  }

  private async purchase(payload: MerchantPurchase): Promise<void> {
    if (this.destroyed || !this.opened || this.pending) return;
    const epoch = this.epoch;
    this.pending = true;
    this.setFeedback("Sprawdzanie zakupu…");
    this.updateControls();
    let result: MerchantResult;
    try { result = await this.handlers.onPurchase(payload); }
    catch { result = { ok: false, code: "MERCHANT_REQUEST_UNCERTAIN", message: "Nie otrzymano potwierdzenia zakupu. Ponów sprawdzenie, aby uniknąć podwójnej zapłaty." }; }
    if (this.destroyed || !this.opened || this.epoch !== epoch) return;
    this.pending = false;
    if (result.ok) {
      this.uncertain = null;
      this.shop = structuredClone(result.shop);
      this.renderOffers();
      this.setFeedback("Zakup zakończony. Przedmioty dodano do ekwipunku.");
      this.handlers.onPurchased?.(result);
    } else {
      this.uncertain = result.code === "MERCHANT_REQUEST_UNCERTAIN" ? payload : null;
      this.setFeedback(result.message, true);
    }
    this.updateControls();
    this.handlers.onTypingChange?.();
  }

  private setFeedback(message: string, error = false): void {
    this.feedback.textContent = message;
    this.feedback.dataset.state = error ? "error" : "status";
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Merchant panel element missing: ${selector}`);
    return element;
  }
}
