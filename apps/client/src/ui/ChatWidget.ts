import {
  CHAT_MAX_MESSAGE_LENGTH,
  type ChatChannel,
  type ChatMessage,
  type ChatSendResult
} from "@web-mmorpg/shared";
import "./ChatWidget.css";

interface ChatWidgetHandlers {
  onSend: (channel: ChatChannel, text: string) => Promise<ChatSendResult>;
  onOpen?: () => void;
}

type ConnectionState = "connected" | "connecting" | "disconnected";

interface ChannelState {
  draft: string;
  revision: number;
  pending: boolean;
  error: string;
  unread: number;
  initialized: boolean;
  followNext: boolean;
  scrollTop: number;
}

const CHANNELS: ChatChannel[] = ["nearby", "global"];
const CHANNEL_LABELS: Record<ChatChannel, string> = { nearby: "W pobliżu", global: "Ogólny" };
let nextWidgetId = 0;

function channelState(): ChannelState {
  return { draft: "", revision: 0, pending: false, error: "", unread: 0, initialized: false, followNext: false, scrollTop: 0 };
}

export class ChatWidget {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly transcript: HTMLDivElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly description: HTMLElement;
  private readonly feedback: HTMLElement;
  private readonly connectionLabel: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly viewport: VisualViewport | null;
  private readonly states: Record<ChatChannel, ChannelState> = { nearby: channelState(), global: channelState() };
  private readonly seenIds = new Set<string>();
  private messages: readonly ChatMessage[] = [];
  private channel: ChatChannel = "nearby";
  private renderedChannel: ChatChannel | null = null;
  private renderedIds: string[] = [];
  private connection: ConnectionState = "connecting";
  private nearbyAvailable = true;
  private receivedUpdate = false;
  private opened = false;
  private destroyed = false;

  constructor(private readonly handlers: ChatWidgetHandlers) {
    const id = `game-chat-${++nextWidgetId}`;
    this.root = document.createElement("div");
    this.root.className = "chat-widget";
    this.root.dataset.chatWidget = "";
    this.root.innerHTML = `
      <button type="button" class="chat-widget__toggle" data-chat-toggle aria-label="Otwórz czat" aria-controls="${id}" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-5 3V7.5A4.5 4.5 0 0 1 7.5 3h8A4.5 4.5 0 0 1 20 7.5z"/><path d="M7 8h9M7 12h7"/></svg>
        <span class="chat-widget__badge" data-chat-unread-total hidden aria-hidden="true"></span>
      </button>
      <section id="${id}" class="game-panel chat-widget__panel is-hidden" data-chat-panel role="dialog" aria-labelledby="${id}-title" aria-modal="false">
        <header class="chat-widget__header">
          <div class="chat-widget__heading"><h2 id="${id}-title">Czat</h2><span class="chat-widget__connection" data-chat-connection role="status"></span></div>
          <button type="button" data-close aria-label="Zamknij czat">×</button>
        </header>
        <div class="chat-widget__tabs" role="tablist" aria-label="Kanał czatu">
          <button type="button" id="${id}-nearby" class="chat-widget__tab" data-chat-tab="nearby" role="tab" aria-controls="${id}-messages" aria-selected="true">W pobliżu <span class="chat-widget__badge" data-chat-unread="nearby" hidden aria-hidden="true"></span></button>
          <button type="button" id="${id}-global" class="chat-widget__tab" data-chat-tab="global" role="tab" aria-controls="${id}-messages" aria-selected="false" tabindex="-1">Ogólny <span class="chat-widget__badge" data-chat-unread="global" hidden aria-hidden="true"></span></button>
        </div>
        <p class="chat-widget__description" data-chat-description></p>
        <div id="${id}-messages" class="chat-widget__messages" data-chat-messages role="log" aria-label="Wiadomości czatu" aria-live="polite" aria-relevant="additions" tabindex="0"></div>
        <form class="chat-widget__form" data-chat-form>
          <div class="chat-widget__composer">
            <textarea class="chat-widget__input" data-chat-input rows="1" maxlength="${CHAT_MAX_MESSAGE_LENGTH}" aria-label="Wiadomość" enterkeyhint="send" placeholder="Napisz wiadomość…"></textarea>
            <button type="submit" class="chat-widget__send" data-chat-send>Wyślij</button>
          </div>
          <div class="chat-widget__footer"><p class="chat-widget__feedback" data-chat-feedback role="status" aria-live="polite"></p><span class="chat-widget__counter" data-chat-counter></span></div>
        </form>
      </section>
    `;
    document.body.appendChild(this.root);
    this.panel = this.require("[data-chat-panel]");
    this.toggle = this.require<HTMLButtonElement>("[data-chat-toggle]");
    this.transcript = this.require<HTMLDivElement>("[data-chat-messages]");
    this.input = this.require<HTMLTextAreaElement>("[data-chat-input]");
    this.sendButton = this.require<HTMLButtonElement>("[data-chat-send]");
    this.description = this.require("[data-chat-description]");
    this.feedback = this.require("[data-chat-feedback]");
    this.connectionLabel = this.require("[data-chat-connection]");
    this.counter = this.require("[data-chat-counter]");
    this.toggle.addEventListener("click", () => this.opened ? this.close() : this.open());
    this.require("[data-close]").addEventListener("click", () => this.close());
    for (const channel of CHANNELS) {
      this.require<HTMLButtonElement>(`[data-chat-tab="${channel}"]`).addEventListener("click", () => this.selectChannel(channel));
    }
    this.require("[role=tablist]").addEventListener("keydown", (event) => this.onTabKey(event));
    this.input.addEventListener("input", () => {
      const state = this.states[this.channel];
      state.draft = this.input.value;
      state.revision++;
      state.error = "";
      this.renderComposer();
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        void this.send();
      }
    });
    this.require("[data-chat-form]").addEventListener("submit", (event) => { event.preventDefault(); void this.send(); });
    this.panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); }
    });
    this.transcript.addEventListener("scroll", () => { this.states[this.channel].scrollTop = this.transcript.scrollTop; });
    this.viewport = window.visualViewport;
    window.addEventListener("resize", this.updateViewport);
    this.viewport?.addEventListener("resize", this.updateViewport);
    this.viewport?.addEventListener("scroll", this.updateViewport);
    this.updateViewport();
    this.render();
  }

  get isTyping(): boolean {
    return !this.destroyed && this.opened && !this.input.disabled && document.activeElement === this.input;
  }

  update(messages: readonly ChatMessage[], connection: ConnectionState, nearbyAvailable: boolean): void {
    if (this.destroyed) return;
    if (!this.receivedUpdate && !nearbyAvailable) this.channel = "global";
    this.receivedUpdate = true;
    const initialized = { nearby: this.states.nearby.initialized, global: this.states.global.initialized };
    const ids = new Set<string>();
    this.messages = messages.filter((message) => {
      if (ids.has(message.id)) return false;
      ids.add(message.id);
      if (!this.seenIds.has(message.id)) {
        this.seenIds.add(message.id);
        if (initialized[message.channel] && (!this.opened || message.channel !== this.channel)) this.states[message.channel].unread++;
      }
      return true;
    });
    for (const channel of CHANNELS) this.states[channel].initialized = true;
    for (const id of this.seenIds) if (!ids.has(id)) this.seenIds.delete(id);
    this.connection = connection;
    this.nearbyAvailable = nearbyAvailable;
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
    this.states[this.channel].unread = 0;
    this.render();
    this.scrollToBottom();
    if (this.input.disabled) this.require<HTMLButtonElement>(`[data-chat-tab="${this.channel}"]`).focus();
    else this.input.focus();
    this.handlers.onOpen?.();
  }

  private close(): void {
    if (this.destroyed) return;
    this.states[this.channel].scrollTop = this.transcript.scrollTop;
    this.opened = false;
    this.panel.classList.add("is-hidden");
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.focus();
    this.renderBadges();
  }

  private selectChannel(channel: ChatChannel): void {
    if (this.destroyed || this.channel === channel) return;
    this.states[this.channel].scrollTop = this.transcript.scrollTop;
    this.channel = channel;
    this.input.value = this.states[channel].draft;
    if (this.opened) this.states[channel].unread = 0;
    this.render();
  }

  private onTabKey(event: KeyboardEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest("[data-chat-tab]")) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const channel = event.key === "Home" ? "nearby" : event.key === "End" ? "global" : this.channel === "nearby" ? "global" : "nearby";
    this.selectChannel(channel);
    this.require<HTMLButtonElement>(`[data-chat-tab="${channel}"]`).focus();
  }

  private render(): void {
    for (const channel of CHANNELS) {
      const tab = this.require<HTMLButtonElement>(`[data-chat-tab="${channel}"]`);
      tab.setAttribute("aria-selected", String(this.channel === channel));
      tab.tabIndex = this.channel === channel ? 0 : -1;
    }
    this.description.textContent = this.channel === "global"
      ? "Wiadomości dla wszystkich graczy online."
      : this.nearbyAvailable
        ? "Rozmowa z graczami widocznymi na Twoim ekranie świata."
        : "Czat w pobliżu jest niedostępny podczas walki. Możesz pisać na kanale ogólnym.";
    this.connectionLabel.textContent = this.connection === "connected" ? "Połączono" : this.connection === "connecting" ? "Łączenie…" : "Brak połączenia";
    this.connectionLabel.dataset.connection = this.connection;
    this.transcript.setAttribute("aria-label", `Wiadomości — ${CHANNEL_LABELS[this.channel]}`);
    this.renderMessages();
    this.renderComposer();
    this.renderBadges();
  }

  private renderMessages(): void {
    const messages = this.messages.filter((message) => message.channel === this.channel);
    const changedChannel = this.renderedChannel !== this.channel;
    const ids = messages.map((message) => message.id);
    if (!changedChannel && ids.length === this.renderedIds.length && ids.every((id, index) => id === this.renderedIds[index])) return;
    const state = this.states[this.channel];
    const wasAtBottom = this.transcript.scrollHeight - this.transcript.clientHeight - this.transcript.scrollTop <= 32;
    const oldTop = this.transcript.scrollTop;
    const anchor = [...this.transcript.children].find((element) => (element as HTMLElement).offsetTop + (element as HTMLElement).offsetHeight >= oldTop) as HTMLElement | undefined;
    const anchorId = anchor?.dataset.chatMessageId;
    const anchorOffset = anchor ? anchor.offsetTop - oldTop : 0;
    if (changedChannel) this.transcript.replaceChildren();
    const existing = new Map([...this.transcript.querySelectorAll<HTMLElement>("[data-chat-message-id]")].map((element) => [element.dataset.chatMessageId, element]));
    this.transcript.querySelector("[data-chat-empty]")?.remove();
    const wanted = new Set(ids);
    for (const child of [...this.transcript.children]) if (!wanted.has((child as HTMLElement).dataset.chatMessageId ?? "")) child.remove();
    messages.forEach((message, index) => {
      const node = existing.get(message.id) ?? this.messageElement(message);
      const atIndex = this.transcript.children.item(index);
      if (node !== atIndex) this.transcript.insertBefore(node, atIndex);
    });
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "chat-widget__empty";
      empty.dataset.chatEmpty = "";
      empty.textContent = "Brak wiadomości. Rozpocznij rozmowę!";
      this.transcript.appendChild(empty);
    }
    if (state.followNext || (!changedChannel && wasAtBottom)) {
      this.scrollToBottom();
      state.followNext = false;
    } else if (changedChannel) {
      this.transcript.scrollTop = state.scrollTop;
    } else {
      const retainedAnchor = anchorId ? existing.get(anchorId) : undefined;
      this.transcript.scrollTop = retainedAnchor?.isConnected ? retainedAnchor.offsetTop - anchorOffset : oldTop;
    }
    state.scrollTop = this.transcript.scrollTop;
    this.renderedChannel = this.channel;
    this.renderedIds = ids;
  }

  private messageElement(message: ChatMessage): HTMLElement {
    const row = document.createElement("article");
    row.className = "chat-widget__message";
    row.dataset.chatMessageId = message.id;
    const meta = document.createElement("div");
    meta.className = "chat-widget__message-meta";
    const sender = document.createElement("strong");
    sender.className = "chat-widget__sender";
    sender.textContent = message.senderName;
    const time = document.createElement("time");
    const date = new Date(message.sentAt);
    if (Number.isFinite(date.getTime())) {
      time.dateTime = date.toISOString();
      time.textContent = date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
      time.title = date.toLocaleString("pl-PL");
    }
    meta.append(sender, time);
    const text = document.createElement("p");
    text.className = "chat-widget__message-text";
    text.textContent = message.text;
    row.append(meta, text);
    return row;
  }

  private renderComposer(): void {
    const state = this.states[this.channel];
    const unavailable = this.channel === "nearby" && !this.nearbyAvailable;
    this.input.disabled = unavailable;
    this.sendButton.disabled = this.connection !== "connected" || unavailable || state.pending || !state.draft.trim() || state.draft.length > CHAT_MAX_MESSAGE_LENGTH;
    this.sendButton.textContent = state.pending ? "Wysyłanie…" : "Wyślij";
    this.sendButton.setAttribute("aria-busy", String(state.pending));
    this.counter.textContent = `${state.draft.length}/${CHAT_MAX_MESSAGE_LENGTH}`;
    this.counter.dataset.invalid = String(state.draft.length > CHAT_MAX_MESSAGE_LENGTH);
    this.feedback.textContent = state.error || (this.connection !== "connected" ? "Wysyłanie będzie dostępne po połączeniu." : "");
    if (state.error) this.feedback.dataset.state = "error";
    else delete this.feedback.dataset.state;
  }

  private renderBadges(): void {
    let total = 0;
    for (const channel of CHANNELS) {
      const count = this.states[channel].unread;
      total += count;
      const badge = this.require(`[data-chat-unread="${channel}"]`);
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.hidden = count === 0;
      this.require(`[data-chat-tab="${channel}"]`).setAttribute("aria-label", `${CHANNEL_LABELS[channel]}${count ? `, nieprzeczytane: ${count}` : ""}`);
    }
    const badge = this.require("[data-chat-unread-total]");
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.hidden = total === 0;
    this.toggle.setAttribute("aria-label", `${this.opened ? "Zamknij" : "Otwórz"} czat${total ? `, nieprzeczytane: ${total}` : ""}`);
  }

  private async send(): Promise<void> {
    if (this.destroyed) return;
    const channel = this.channel;
    const state = this.states[channel];
    const draft = state.draft;
    const text = draft.trim();
    if (state.pending || !text || draft.length > CHAT_MAX_MESSAGE_LENGTH || this.connection !== "connected" || (channel === "nearby" && !this.nearbyAvailable)) return;
    const revision = state.revision;
    state.pending = true;
    state.error = "";
    state.followNext = true;
    this.scrollToBottom();
    this.renderComposer();
    try {
      const result = await this.handlers.onSend(channel, text);
      if (this.destroyed) return;
      if (result.ok) {
        if (state.revision === revision && state.draft === draft) {
          state.draft = "";
          state.revision++;
          if (this.channel === channel) this.input.value = "";
        }
      } else {
        state.error = result.message;
        state.followNext = false;
      }
    } catch {
      if (this.destroyed) return;
      state.error = "Nie udało się wysłać wiadomości. Spróbuj ponownie.";
      state.followNext = false;
    } finally {
      if (!this.destroyed) {
        state.pending = false;
        if (this.channel === channel) this.renderComposer();
      }
    }
  }

  private scrollToBottom(): void {
    this.transcript.scrollTop = this.transcript.scrollHeight;
    this.states[this.channel].scrollTop = this.transcript.scrollTop;
  }

  private readonly updateViewport = (): void => {
    if (this.destroyed) return;
    const height = this.viewport?.height ?? window.innerHeight;
    this.root.style.setProperty("--chat-viewport-height", `${height}px`);
    this.root.style.setProperty("--chat-viewport-top", `${this.viewport?.offsetTop ?? 0}px`);
    this.root.dataset.compact = String(height <= 330);
  };

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Chat element missing: ${selector}`);
    return element;
  }
}
