import type {
  AdminAccountPage,
  AdminAccountSummary,
  UpdateAccountAccessInput
} from "@web-mmorpg/shared";
import { AdminApi, AdminApiRequestError } from "../../net/AdminApi";

export class AccountManagerView {
  private search = "";
  private page = 1;
  private readonly pageSize = 20;
  private current: AdminAccountPage | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: AdminApi
  ) {}

  async show(): Promise<void> {
    if (!this.host.querySelector("[data-account-manager]")) {
      this.renderShell();
    }
    await this.load();
  }

  destroy(): void {
    this.host.replaceChildren();
  }

  private renderShell(): void {
    this.host.innerHTML = `
      <section class="account-manager" data-account-manager>
        <div class="account-manager__header">
          <div>
            <h3>Konta</h3>
            <p>Zarządzaj rolami oraz blokadami kont graczy.</p>
          </div>
        </div>
        <form class="account-manager__search" data-account-search-form>
          <input type="search" data-account-search placeholder="Szukaj po nazwie konta" autocomplete="off" />
          <button type="submit">Szukaj</button>
        </form>
        <p class="form-error" data-account-error></p>
        <div class="account-manager__list" data-account-list></div>
        <div class="account-manager__pager" data-account-pager></div>
      </section>
    `;

    this.require<HTMLFormElement>("[data-account-search-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      this.search = this.require<HTMLInputElement>("[data-account-search]").value.trim();
      this.page = 1;
      void this.load();
    });
  }

  private async load(): Promise<void> {
    const error = this.require<HTMLElement>("[data-account-error]");
    error.textContent = "";
    try {
      const page = await this.api.listAccounts({
        search: this.search,
        page: this.page,
        pageSize: this.pageSize
      });
      this.current = page;
      this.renderPage(page);
    } catch (requestError) {
      error.textContent = this.message(requestError, "Nie udało się pobrać listy kont.");
    }
  }

  private renderPage(page: AdminAccountPage): void {
    const list = this.require<HTMLElement>("[data-account-list]");
    const pager = this.require<HTMLElement>("[data-account-pager]");
    list.replaceChildren();
    pager.replaceChildren();

    if (page.accounts.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "Brak kont pasujących do wyszukiwania.";
      list.appendChild(empty);
    } else {
      for (const account of page.accounts) list.appendChild(this.accountRow(account));
    }

    const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "← Poprzednia";
    previous.disabled = page.page <= 1;
    previous.addEventListener("click", () => {
      this.page = Math.max(1, page.page - 1);
      void this.load();
    });

    const label = document.createElement("span");
    label.textContent = `Strona ${page.page} z ${pages}`;

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Następna →";
    next.disabled = page.page >= pages;
    next.addEventListener("click", () => {
      this.page = Math.min(pages, page.page + 1);
      void this.load();
    });

    pager.append(previous, label, next);
  }

  private accountRow(account: AdminAccountSummary): HTMLElement {
    const row = document.createElement("article");
    row.className = "account-manager__row";
    row.dataset.accountId = account.id;

    const info = document.createElement("div");
    info.className = "account-manager__info";
    const name = document.createElement("strong");
    name.textContent = account.username;
    const meta = document.createElement("span");
    meta.textContent = `${account.role} • ${account.status === "active" ? "aktywne" : "zablokowane"}`;
    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "account-manager__actions";

    if (account.role === "PLAYER") {
      actions.appendChild(
        this.actionButton(account, "promote", "Nadaj ADMIN", { role: "ADMIN" })
      );
    } else {
      actions.appendChild(
        this.actionButton(account, "demote", "Odbierz ADMIN", { role: "PLAYER" })
      );
    }

    if (account.status === "active") {
      actions.appendChild(
        this.actionButton(account, "ban", "Zablokuj", { status: "banned" })
      );
    } else {
      actions.appendChild(
        this.actionButton(account, "unban", "Odblokuj", { status: "active" })
      );
    }

    row.append(info, actions);
    return row;
  }

  private actionButton(
    account: AdminAccountSummary,
    action: "promote" | "demote" | "ban" | "unban",
    label: string,
    input: UpdateAccountAccessInput
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.accountAction = action;
    button.dataset.accountId = account.id;
    button.addEventListener("click", () => {
      const description = this.confirmationText(account, action);
      if (!window.confirm(description)) return;
      void this.apply(account.id, input);
    });
    return button;
  }

  private confirmationText(
    account: AdminAccountSummary,
    action: "promote" | "demote" | "ban" | "unban"
  ): string {
    const verbs = {
      promote: "nadać rolę ADMIN kontu",
      demote: "odebrać rolę ADMIN kontu",
      ban: "zablokować konto",
      unban: "odblokować konto"
    } as const;
    return `Czy na pewno chcesz ${verbs[action]} „${account.username}”?`;
  }

  private async apply(accountId: string, input: UpdateAccountAccessInput): Promise<void> {
    const error = this.require<HTMLElement>("[data-account-error]");
    error.textContent = "";
    try {
      await this.api.updateAccountAccess(accountId, input);
      await this.load();
    } catch (requestError) {
      error.textContent = this.message(requestError, "Nie udało się zmienić dostępu do konta.");
      if (this.current) this.renderPage(this.current);
    }
  }

  private message(error: unknown, fallback: string): string {
    if (error instanceof AdminApiRequestError || error instanceof Error) return error.message;
    return fallback;
  }

  private require<T extends HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Account manager element missing: ${selector}`);
    return element;
  }
}
