export const MAX_ITEM_ICON_BYTES = 2 * 1024 * 1024;
export const ITEM_ICON_MIME_TYPES = ["image/png", "image/webp"] as const;

export type ItemIconMimeType = (typeof ITEM_ICON_MIME_TYPES)[number];

export interface IconUploadInput {
  bytes: Buffer;
  mimeType: ItemIconMimeType;
  originalName: string;
}

export interface RawIconUploadInput {
  bytes: Buffer;
  mimeType: string;
  originalName: string;
}

export interface StoredIcon {
  key: string;
  url: string;
}

export interface IconStorage {
  putIcon(input: IconUploadInput): Promise<StoredIcon>;
}

export class IconUploadValidationError extends Error {
  constructor(
    public readonly code:
      | "INVALID_ICON_MIME"
      | "ICON_TOO_LARGE"
      | "INVALID_ICON_FILENAME"
  ) {
    super(code);
    this.name = "IconUploadValidationError";
  }
}

export function validateIconUpload(input: RawIconUploadInput): IconUploadInput {
  if (!ITEM_ICON_MIME_TYPES.includes(input.mimeType as ItemIconMimeType)) {
    throw new IconUploadValidationError("INVALID_ICON_MIME");
  }

  if (input.bytes.length > MAX_ITEM_ICON_BYTES) {
    throw new IconUploadValidationError("ICON_TOO_LARGE");
  }

  const name = input.originalName.trim();
  if (
    name.length === 0 ||
    name.length > 255 ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..")
  ) {
    throw new IconUploadValidationError("INVALID_ICON_FILENAME");
  }

  return {
    bytes: input.bytes,
    mimeType: input.mimeType as ItemIconMimeType,
    originalName: name
  };
}

export async function storeValidatedIcon(
  storage: IconStorage,
  input: RawIconUploadInput
): Promise<StoredIcon> {
  return storage.putIcon(validateIconUpload(input));
}
