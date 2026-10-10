import type {
  AdminAccountQuery,
  ItemCatalogQuery,
  ItemDraftInput,
  UpdateAccountAccessInput
} from "@web-mmorpg/shared";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { AdminAuditRepository } from "../audit/AdminAuditRepository";
import type { AuthService } from "../auth/AuthService";
import { ItemCatalogService } from "../items/ItemCatalogService";
import { ItemMetadataRepository } from "../items/ItemMetadataRepository";
import {
  ItemConflictError,
  ItemNotFoundError,
  ItemValidationError
} from "../items/itemValidation";
import { AccountAdminError, type AccountAdminService } from "./AccountAdminService";
import { AdminAuthError, requireAdminSession, type AdminSession } from "./AdminAuth";
import {
  IconUploadValidationError,
  MAX_ITEM_ICON_BYTES,
  storeValidatedIcon,
  type IconStorage
} from "./IconStorage";

export interface AdminRouterDependencies {
  authService: AuthService;
  accountAdmin: AccountAdminService;
  metadata: ItemMetadataRepository;
  catalog: ItemCatalogService;
  audit: AdminAuditRepository;
  iconStorage: IconStorage;
}

interface DatabaseError {
  code?: string;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ITEM_ICON_BYTES, files: 1 }
});

export function createAdminRouter(deps: AdminRouterDependencies): Router {
  const router = Router();

  router.use((req, res, next) => {
    void requireAdminSession(deps.authService, req.header("authorization"))
      .then((adminSession) => {
        res.locals.adminSession = adminSession;
        next();
      })
      .catch(next);
  });

  router.get("/accounts", async (req, res) => {
    res.json(await deps.accountAdmin.listAccounts(parseAccountQuery(req)));
  });

  router.put("/accounts/:accountId/access", async (req, res) => {
    const input = req.body as UpdateAccountAccessInput;
    res.json(
      await deps.accountAdmin.updateAccess(
        session(res).accountId,
        req.params.accountId,
        {
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.status === undefined ? {} : { status: input.status })
        }
      )
    );
  });

  router.get("/item-metadata", async (_req, res) => {
    res.json(await deps.metadata.listMetadata());
  });

  router.get("/items", async (req, res) => {
    res.json(await deps.catalog.listItems(parseCatalogQuery(req)));
  });

  router.post("/items", async (req, res) => {
    const created = await deps.catalog.createDraft(
      req.body as ItemDraftInput,
      session(res).accountId
    );
    res.status(201).json(created);
  });

  router.get("/items/:itemId", async (req, res) => {
    res.json(await deps.catalog.getItem(req.params.itemId));
  });

  router.put("/items/:itemId/draft", async (req, res) => {
    const body = req.body as {
      expectedRevision?: number;
      draft?: ItemDraftInput;
    };
    if (!body.draft) throw new ItemValidationError("DRAFT_REQUIRED");

    res.json(
      await deps.catalog.updateDraft(
        req.params.itemId,
        body.draft,
        body.expectedRevision as number,
        session(res).accountId
      )
    );
  });

  router.post("/items/:itemId/publish", async (req, res) => {
    const { expectedRevision } = req.body as { expectedRevision?: number };
    res.json(
      await deps.catalog.publish(
        req.params.itemId,
        expectedRevision as number,
        session(res).accountId
      )
    );
  });

  router.post("/items/:itemId/duplicate", async (req, res) => {
    const { newItemId } = req.body as { newItemId?: string };
    if (typeof newItemId !== "string") {
      throw new ItemValidationError("NEW_ITEM_ID_REQUIRED");
    }
    const duplicated = await deps.catalog.duplicate(
      req.params.itemId,
      newItemId,
      session(res).accountId
    );
    res.status(201).json(duplicated);
  });

  router.post("/items/:itemId/archive", async (req, res) => {
    await deps.catalog.archive(req.params.itemId, session(res).accountId);
    res.status(204).end();
  });

  router.get("/items/:itemId/versions", async (req, res) => {
    res.json(await deps.catalog.listVersions(req.params.itemId));
  });

  router.get("/items/:itemId/versions/:versionNo", async (req, res) => {
    res.json(
      await deps.catalog.getVersion(
        req.params.itemId,
        parsePositiveInteger(req.params.versionNo, "INVALID_VERSION_NO")
      )
    );
  });

  router.post("/items/:itemId/versions/:versionNo/restore", async (req, res) => {
    res.json(
      await deps.catalog.restoreVersion(
        req.params.itemId,
        parsePositiveInteger(req.params.versionNo, "INVALID_VERSION_NO"),
        session(res).accountId
      )
    );
  });

  router.post("/categories", async (req, res) => {
    const input = req.body as {
      id?: string;
      name?: string;
      allowedStatCodes?: string[];
      allowedSpecialFieldCodes?: string[];
    };
    if (
      typeof input.id !== "string" ||
      typeof input.name !== "string" ||
      !Array.isArray(input.allowedStatCodes) ||
      (input.allowedSpecialFieldCodes !== undefined &&
        !Array.isArray(input.allowedSpecialFieldCodes))
    ) {
      throw new ItemValidationError("INVALID_CATEGORY_INPUT");
    }
    const created = await deps.metadata.createCategory(
      {
        id: input.id,
        name: input.name,
        allowedStatCodes: input.allowedStatCodes,
        allowedSpecialFieldCodes: input.allowedSpecialFieldCodes ?? []
      },
      session(res).accountId
    );
    res.status(201).json(created);
  });

  router.post("/subcategories", async (req, res) => {
    const input = req.body as {
      id?: string;
      categoryId?: string;
      name?: string;
      allowedStatCodes?: string[];
      allowedSpecialFieldCodes?: string[];
    };
    if (
      typeof input.id !== "string" ||
      typeof input.categoryId !== "string" ||
      typeof input.name !== "string" ||
      !Array.isArray(input.allowedStatCodes) ||
      (input.allowedSpecialFieldCodes !== undefined &&
        !Array.isArray(input.allowedSpecialFieldCodes))
    ) {
      throw new ItemValidationError("INVALID_SUBCATEGORY_INPUT");
    }
    const created = await deps.metadata.createSubcategory(
      {
        id: input.id,
        categoryId: input.categoryId,
        name: input.name,
        allowedStatCodes: input.allowedStatCodes,
        allowedSpecialFieldCodes: input.allowedSpecialFieldCodes ?? []
      },
      session(res).accountId
    );
    res.status(201).json(created);
  });

  router.put("/categories/:categoryId/allowed-stats", async (req, res) => {
    const { allowedStatCodes } = req.body as { allowedStatCodes?: string[] };
    if (!Array.isArray(allowedStatCodes)) {
      throw new ItemValidationError("ALLOWED_STAT_CODES_REQUIRED");
    }
    res.json(
      await deps.metadata.updateCategoryAllowedStats(
        req.params.categoryId,
        allowedStatCodes,
        session(res).accountId
      )
    );
  });

  router.put("/categories/:categoryId/allowed-special-fields", async (req, res) => {
    const { allowedSpecialFieldCodes } = req.body as {
      allowedSpecialFieldCodes?: string[];
    };
    if (!Array.isArray(allowedSpecialFieldCodes)) {
      throw new ItemValidationError("ALLOWED_SPECIAL_FIELD_CODES_REQUIRED");
    }
    res.json(
      await deps.metadata.updateCategoryAllowedSpecialFields(
        req.params.categoryId,
        allowedSpecialFieldCodes,
        session(res).accountId
      )
    );
  });

  router.put(
    "/categories/:categoryId/subcategories/:subcategoryId/allowed-special-fields",
    async (req, res) => {
      const { allowedSpecialFieldCodes } = req.body as {
        allowedSpecialFieldCodes?: string[];
      };
      if (!Array.isArray(allowedSpecialFieldCodes)) {
        throw new ItemValidationError("ALLOWED_SPECIAL_FIELD_CODES_REQUIRED");
      }
      res.json(
        await deps.metadata.updateSubcategoryAllowedSpecialFields(
          req.params.categoryId,
          req.params.subcategoryId,
          allowedSpecialFieldCodes,
          session(res).accountId
        )
      );
    }
  );

  router.post("/icons", upload.single("icon"), async (req, res) => {
    if (!req.file) throw new ItemValidationError("ICON_FILE_REQUIRED");

    const stored = await storeValidatedIcon(deps.iconStorage, {
      bytes: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname
    });
    await deps.audit.append({
      actorAccountId: session(res).accountId,
      action: "UPLOAD_ICON",
      objectType: "item_icon",
      objectId: stored.key,
      summary: { url: stored.url, mimeType: req.file.mimetype }
    });
    res.status(201).json(stored);
  });

  router.get("/audit", async (req, res) => {
    const objectType = singleQuery(req.query.objectType);
    const objectId = singleQuery(req.query.objectId);
    if (!objectType || !objectId) {
      throw new ItemValidationError("AUDIT_OBJECT_REQUIRED");
    }
    res.json(await deps.audit.listForObject(objectType, objectId));
  });

  router.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      sendAdminError(error, res);
    }
  );

  return router;
}

function session(res: Response): AdminSession {
  return res.locals.adminSession as AdminSession;
}

function parseAccountQuery(req: Request): AdminAccountQuery {
  const query: AdminAccountQuery = {};
  const search = singleQuery(req.query.search);
  const page = optionalPositiveInteger(req.query.page, "INVALID_PAGE");
  const pageSize = optionalPositiveInteger(req.query.pageSize, "INVALID_PAGE_SIZE");
  if (search !== undefined) query.search = search;
  if (page !== undefined) query.page = page;
  if (pageSize !== undefined) query.pageSize = pageSize;
  return query;
}

function parseCatalogQuery(req: Request): ItemCatalogQuery {
  const query: ItemCatalogQuery = {};
  const search = singleQuery(req.query.search);
  const itemId = singleQuery(req.query.itemId);
  const categoryId = singleQuery(req.query.categoryId);
  const subcategoryId = singleQuery(req.query.subcategoryId);
  const rarity = singleQuery(req.query.rarity);
  const status = singleQuery(req.query.status);
  const minimumLevel = optionalInteger(req.query.minimumLevel, "INVALID_MINIMUM_LEVEL");
  const maximumLevel = optionalInteger(req.query.maximumLevel, "INVALID_MAXIMUM_LEVEL");
  const page = optionalInteger(req.query.page, "INVALID_PAGE");
  const pageSize = optionalInteger(req.query.pageSize, "INVALID_PAGE_SIZE");

  if (search) query.search = search;
  if (itemId) query.itemId = itemId;
  if (categoryId) query.categoryId = categoryId;
  if (subcategoryId) query.subcategoryId = subcategoryId;
  if (rarity) query.rarity = rarity as NonNullable<ItemCatalogQuery["rarity"]>;
  if (status) query.status = status as NonNullable<ItemCatalogQuery["status"]>;
  if (minimumLevel !== undefined) query.minimumLevel = minimumLevel;
  if (maximumLevel !== undefined) query.maximumLevel = maximumLevel;
  if (page !== undefined) query.page = page;
  if (pageSize !== undefined) query.pageSize = pageSize;
  return query;
}

function singleQuery(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalInteger(value: unknown, code: string): number | undefined {
  if (value === undefined) return undefined;
  const raw = singleQuery(value);
  if (!raw) throw new ItemValidationError(code);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ItemValidationError(code);
  }
  return parsed;
}

function optionalPositiveInteger(value: unknown, code: string): number | undefined {
  if (value === undefined) return undefined;
  const raw = singleQuery(value);
  if (!raw) throw new AccountAdminError(code, 400, code);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AccountAdminError(code, 400, code);
  }
  return parsed;
}

function parsePositiveInteger(value: string, code: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ItemValidationError(code);
  }
  return parsed;
}

function sendAdminError(error: unknown, res: Response): void {
  if (error instanceof AdminAuthError) {
    res.status(error.status).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof AccountAdminError) {
    res.status(error.status).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof ItemConflictError) {
    res.status(409).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof ItemNotFoundError) {
    res.status(404).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof ItemValidationError) {
    res.status(400).json({
      code: error.code,
      message: error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {})
    });
    return;
  }
  if (error instanceof IconUploadValidationError) {
    res.status(400).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof multer.MulterError) {
    const code = error.code === "LIMIT_FILE_SIZE" ? "ICON_TOO_LARGE" : "ICON_UPLOAD_INVALID";
    res.status(400).json({ code, message: code });
    return;
  }

  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("CATEGORY_NOT_FOUND:") || message.startsWith("SUBCATEGORY_NOT_FOUND:")) {
    res.status(404).json({ code: "METADATA_NOT_FOUND", message });
    return;
  }
  if (
    message.startsWith("UNKNOWN_STAT_CODE:") ||
    message.startsWith("UNKNOWN_SPECIAL_FIELD_CODE:") ||
    message.startsWith("INVALID_METADATA_")
  ) {
    res.status(400).json({ code: "INVALID_METADATA", message });
    return;
  }
  if (isDatabaseError(error) && error.code === "23505") {
    res.status(409).json({ code: "CONFLICT", message: "Resource already exists." });
    return;
  }

  console.error("Admin API request failed", error);
  res.status(500).json({ code: "INTERNAL_ERROR", message: "Internal server error." });
}

function isDatabaseError(error: unknown): error is DatabaseError {
  return typeof error === "object" && error !== null && "code" in error;
}
