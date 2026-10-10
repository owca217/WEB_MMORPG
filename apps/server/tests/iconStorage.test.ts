import { describe, expect, it } from "vitest";
import type { IconStorage, IconUploadInput } from "../src/admin/IconStorage";
import {
  IconStorageUnavailableError,
  IconUploadValidationError,
  storeValidatedIcon
} from "../src/admin/IconStorage";
import {
  createIconStorageFromEnv,
  UnavailableIconStorage
} from "../src/admin/createIconStorage";
import { S3IconStorage } from "../src/admin/S3IconStorage";

class FakeStorage implements IconStorage {
  readonly writes: IconUploadInput[] = [];

  async putIcon(input: IconUploadInput): Promise<{ key: string; url: string }> {
    this.writes.push(input);
    return {
      key: `icons/fake.${input.mimeType === "image/png" ? "png" : "webp"}`,
      url: "https://assets.example.test/icons/fake"
    };
  }
}

describe("item icon upload validation", () => {
  it.each([
    ["image/png", "sword.png"],
    ["image/webp", "shield.webp"]
  ])("accepts supported %s uploads", async (mimeType, originalName) => {
    const storage = new FakeStorage();

    const result = await storeValidatedIcon(storage, {
      bytes: Buffer.from("valid-image-bytes"),
      mimeType,
      originalName
    });

    expect(storage.writes).toHaveLength(1);
    expect(result.key).toMatch(/^icons\/fake\.(png|webp)$/);
  });

  it.each([
    ["image/jpeg", "photo.jpg"],
    ["application/x-msdownload", "payload.exe"]
  ])("rejects unsupported MIME %s before storage write", async (mimeType, originalName) => {
    const storage = new FakeStorage();

    await expect(
      storeValidatedIcon(storage, {
        bytes: Buffer.from("bad"),
        mimeType,
        originalName
      })
    ).rejects.toBeInstanceOf(IconUploadValidationError);

    expect(storage.writes).toHaveLength(0);
  });

  it("rejects payloads above 2 MiB before storage write", async () => {
    const storage = new FakeStorage();

    await expect(
      storeValidatedIcon(storage, {
        bytes: Buffer.alloc(2 * 1024 * 1024 + 1),
        mimeType: "image/png",
        originalName: "huge.png"
      })
    ).rejects.toThrow("ICON_TOO_LARGE");

    expect(storage.writes).toHaveLength(0);
  });

  it.each(["../../name.png", "..\\name.png", "folder/name.png", "folder\\name.png"])(
    "rejects path-like filename %s before storage write",
    async (originalName) => {
      const storage = new FakeStorage();

      await expect(
        storeValidatedIcon(storage, {
          bytes: Buffer.from("png"),
          mimeType: "image/png",
          originalName
        })
      ).rejects.toThrow("INVALID_ICON_FILENAME");

      expect(storage.writes).toHaveLength(0);
    }
  );
});

describe("S3IconStorage", () => {
  it("uses a UUID object key with a server-controlled extension and public base URL", async () => {
    const sentInputs: unknown[] = [];
    const storage = new S3IconStorage({
      bucket: "web-mmorpg-items",
      region: "eu-central-1",
      publicBaseUrl: "https://cdn.example.test/item-assets/",
      client: {
        async send(command: { input: unknown }) {
          sentInputs.push(command.input);
          return {};
        }
      }
    });

    const result = await storage.putIcon({
      bytes: Buffer.from("png"),
      mimeType: "image/png",
      originalName: "my sword.png"
    });

    expect(result.key).toMatch(
      /^icons\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/
    );
    expect(result.key).not.toContain("my sword");
    expect(result.key).not.toContain("..");
    expect(result.url).toBe(`https://cdn.example.test/item-assets/${result.key}`);
    expect(sentInputs).toHaveLength(1);
  });

  it("loads required production configuration from environment", () => {
    const storage = S3IconStorage.fromEnv({
      ITEM_ASSET_S3_BUCKET: "bucket",
      ITEM_ASSET_S3_REGION: "eu-central-1",
      ITEM_ASSET_PUBLIC_BASE_URL: "https://assets.example.test",
      AWS_ACCESS_KEY_ID: "access",
      AWS_SECRET_ACCESS_KEY: "secret"
    });

    expect(storage).toBeInstanceOf(S3IconStorage);
  });

  it("fails clearly when required environment configuration is missing", () => {
    expect(() => S3IconStorage.fromEnv({})).toThrow("ITEM_ASSET_S3_BUCKET");
  });
});

describe("createIconStorageFromEnv", () => {
  it("keeps server startup alive when S3 is not configured", async () => {
    const storage = createIconStorageFromEnv({});
    expect(storage).toBeInstanceOf(UnavailableIconStorage);
    await expect(
      storage.putIcon({
        bytes: Buffer.from("png"),
        mimeType: "image/png",
        originalName: "item.png"
      })
    ).rejects.toBeInstanceOf(IconStorageUnavailableError);
  });

  it("uses S3 when complete configuration is present", () => {
    const storage = createIconStorageFromEnv({
      ITEM_ASSET_S3_BUCKET: "bucket",
      ITEM_ASSET_S3_REGION: "eu-central-1",
      ITEM_ASSET_PUBLIC_BASE_URL: "https://assets.example.test"
    });
    expect(storage).toBeInstanceOf(S3IconStorage);
  });
});
