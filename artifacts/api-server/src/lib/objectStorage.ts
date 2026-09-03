import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Storage, type File } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
  }
}

export class ObjectStorageService {
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR;
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
    return dir;
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const { bucketName, objectName } = parseObjectPath(
      `${privateObjectDir}/uploads/${objectId}`,
    );
    const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method: "PUT",
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Failed to sign object URL (${response.status}).`);
    }
    const body = (await response.json()) as { signed_url?: string };
    if (!body.signed_url) throw new Error("Storage did not return an upload URL.");
    return body.signed_url;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;
    const privateDir = `${this.getPrivateObjectDir().replace(/\/+$/, "")}/`;
    const pathname = new URL(rawPath).pathname;
    if (!pathname.startsWith(privateDir)) return "";
    return `/objects/${pathname.slice(privateDir.length)}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId || entityId.includes("..")) throw new ObjectNotFoundError();
    const { bucketName, objectName } = parseObjectPath(
      `${this.getPrivateObjectDir().replace(/\/+$/, "")}/${entityId}`,
    );
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }

  async downloadObject(file: File): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const stream = Readable.toWeb(file.createReadStream()) as ReadableStream;
    const headers = new Headers({
      "Content-Type": String(metadata.contentType || "application/octet-stream"),
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "attachment",
    });
    if (metadata.size) headers.set("Content-Length", String(metadata.size));
    return new Response(stream, { headers });
  }
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) {
    throw new Error("Invalid object storage path.");
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}