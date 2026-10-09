import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  IconStorage,
  IconUploadInput,
  StoredIcon
} from "./IconStorage";
import { validateIconUpload } from "./IconStorage";

interface S3CommandSender {
  send(command: PutObjectCommand): Promise<unknown>;
}

export interface S3IconStorageOptions {
  bucket: string;
  region: string;
  publicBaseUrl: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  client?: S3CommandSender;
}

export class S3IconStorage implements IconStorage {
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly client: S3CommandSender;

  constructor(options: S3IconStorageOptions) {
    this.bucket = options.bucket;
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, "");

    if (options.client) {
      this.client = options.client;
      return;
    }

    const credentials =
      options.accessKeyId && options.secretAccessKey
        ? {
            accessKeyId: options.accessKeyId,
            secretAccessKey: options.secretAccessKey,
            ...(options.sessionToken ? { sessionToken: options.sessionToken } : {})
          }
        : undefined;

    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint
        ? { endpoint: options.endpoint, forcePathStyle: true }
        : {}),
      ...(credentials ? { credentials } : {})
    });
  }

  static fromEnv(
    env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
  ): S3IconStorage {
    const bucket = requiredEnv(env, "ITEM_ASSET_S3_BUCKET");
    const region = requiredEnv(env, "ITEM_ASSET_S3_REGION");
    const publicBaseUrl = requiredEnv(env, "ITEM_ASSET_PUBLIC_BASE_URL");
    const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();

    if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
      throw new Error(
        "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together"
      );
    }

    return new S3IconStorage({
      bucket,
      region,
      publicBaseUrl,
      ...(env.ITEM_ASSET_S3_ENDPOINT?.trim()
        ? { endpoint: env.ITEM_ASSET_S3_ENDPOINT.trim() }
        : {}),
      ...(accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : {}),
      ...(env.AWS_SESSION_TOKEN?.trim()
        ? { sessionToken: env.AWS_SESSION_TOKEN.trim() }
        : {})
    });
  }

  async putIcon(input: IconUploadInput): Promise<StoredIcon> {
    const safeInput = validateIconUpload(input);
    const extension = safeInput.mimeType === "image/png" ? "png" : "webp";
    const key = `icons/${randomUUID()}.${extension}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: safeInput.bytes,
        ContentType: safeInput.mimeType,
        CacheControl: "public, max-age=31536000, immutable"
      })
    );

    return {
      key,
      url: `${this.publicBaseUrl}/${key}`
    };
  }
}

function requiredEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  name: string
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
