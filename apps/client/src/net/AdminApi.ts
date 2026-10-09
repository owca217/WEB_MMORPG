import type {
  AdminApiError,
  ItemCatalogPage,
  ItemCatalogQuery,
  ItemCategoryDefinition,
  ItemCreatorMetadata,
  ItemDetails,
  ItemDraftInput,
  ItemSubcategoryDefinition,
  ItemVersion,
  ItemVersionSummary
} from "@web-mmorpg/shared";

export interface StoredIconResponse {
  key: string;
  url: string;
}

export interface AdminAuditEntry {
  id: string;
  actorPlayerId: string;
  action: string;
  objectType: string;
  objectId: string;
  fromVersion?: number;
  toVersion?: number;
  summary: Record<string, unknown>;
  createdAt: string;
}

export class AdminApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(status: number, payload: AdminApiError) {
    super(payload.message);
    this.name = "AdminApiRequestError";
    this.status = status;
    this.code = payload.code;
    if (payload.fieldErrors) this.fieldErrors = payload.fieldErrors;
  }
}

export class AdminApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly getSessionToken: () => string | null,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  getMetadata(): Promise<ItemCreatorMetadata> {
    return this.request<ItemCreatorMetadata>("/item-metadata");
  }

  listItems(query: ItemCatalogQuery = {}): Promise<ItemCatalogPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<ItemCatalogPage>(`/items${suffix}`);
  }

  getItem(itemId: string): Promise<ItemDetails> {
    return this.request<ItemDetails>(`/items/${encodeURIComponent(itemId)}`);
  }

  createItem(draft: ItemDraftInput): Promise<ItemVersion> {
    return this.request<ItemVersion>("/items", {
      method: "POST",
      body: JSON.stringify(draft)
    });
  }

  saveDraft(
    itemId: string,
    draft: ItemDraftInput,
    expectedRevision: number
  ): Promise<ItemVersion> {
    return this.request<ItemVersion>(`/items/${encodeURIComponent(itemId)}/draft`, {
      method: "PUT",
      body: JSON.stringify({ draft, expectedRevision })
    });
  }

  publishItem(itemId: string, expectedRevision: number): Promise<ItemVersion> {
    return this.request<ItemVersion>(`/items/${encodeURIComponent(itemId)}/publish`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision })
    });
  }

  duplicateItem(itemId: string, newItemId: string): Promise<ItemVersion> {
    return this.request<ItemVersion>(`/items/${encodeURIComponent(itemId)}/duplicate`, {
      method: "POST",
      body: JSON.stringify({ newItemId })
    });
  }

  async archiveItem(itemId: string): Promise<void> {
    await this.request<void>(`/items/${encodeURIComponent(itemId)}/archive`, {
      method: "POST",
      body: JSON.stringify({})
    });
  }

  listVersions(itemId: string): Promise<ItemVersionSummary[]> {
    return this.request<ItemVersionSummary[]>(
      `/items/${encodeURIComponent(itemId)}/versions`
    );
  }

  restoreVersion(itemId: string, versionNo: number): Promise<ItemVersion> {
    return this.request<ItemVersion>(
      `/items/${encodeURIComponent(itemId)}/versions/${versionNo}/restore`,
      { method: "POST", body: JSON.stringify({}) }
    );
  }

  createCategory(input: {
    id: string;
    name: string;
    allowedStatCodes: string[];
  }): Promise<ItemCategoryDefinition> {
    return this.request<ItemCategoryDefinition>("/categories", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  createSubcategory(input: {
    id: string;
    categoryId: string;
    name: string;
    allowedStatCodes: string[];
  }): Promise<ItemSubcategoryDefinition> {
    return this.request<ItemSubcategoryDefinition>("/subcategories", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  updateCategoryAllowedStats(
    categoryId: string,
    allowedStatCodes: string[]
  ): Promise<ItemCategoryDefinition> {
    return this.request<ItemCategoryDefinition>(
      `/categories/${encodeURIComponent(categoryId)}/allowed-stats`,
      {
        method: "PUT",
        body: JSON.stringify({ allowedStatCodes })
      }
    );
  }

  uploadIcon(file: File): Promise<StoredIconResponse> {
    const form = new FormData();
    form.append("icon", file);
    return this.request<StoredIconResponse>("/icons", {
      method: "POST",
      body: form
    });
  }

  getAudit(objectType: string, objectId: string): Promise<AdminAuditEntry[]> {
    const params = new URLSearchParams({ objectType, objectId });
    return this.request<AdminAuditEntry[]>(`/audit?${params.toString()}`);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getSessionToken();
    if (!token) {
      throw new AdminApiRequestError(401, {
        code: "ADMIN_SESSION_REQUIRED",
        message: "Sesja administratora jest wymagana."
      });
    }

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body !== undefined && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    const response = await this.fetcher(`${this.baseUrl}/api/admin${path}`, {
      ...init,
      method: init.method ?? "GET",
      headers
    });

    if (!response.ok) {
      throw await this.toRequestError(response);
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  private async toRequestError(response: Response): Promise<AdminApiRequestError> {
    let payload: AdminApiError = {
      code: `HTTP_${response.status}`,
      message: `Żądanie administratora nie powiodło się (${response.status}).`
    };

    try {
      const parsed = (await response.json()) as Partial<AdminApiError>;
      if (typeof parsed.code === "string" && typeof parsed.message === "string") {
        payload = {
          code: parsed.code,
          message: parsed.message,
          ...(parsed.fieldErrors ? { fieldErrors: parsed.fieldErrors } : {})
        };
      }
    } catch {
      // Keep the normalized fallback when the server did not return JSON.
    }

    return new AdminApiRequestError(response.status, payload);
  }
}
