import { Readable } from "node:stream";
import { and, eq, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, messagesTable } from "@workspace/db";
import { getUserFromRequest } from "../lib/auth";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const allowedTypes = new Set(["text/plain", "text/markdown", "text/csv", "application/json", "application/xml", "text/xml", "application/yaml", "text/yaml"]);

router.post("/storage/uploads/request-url", async (req, res): Promise<void> => {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const size = Number(req.body?.size);
  const contentType = typeof req.body?.contentType === "string" ? req.body.contentType : "";
  if (!name || name.length > 160 || !Number.isInteger(size) || size < 1 || size > MAX_FILE_SIZE || !allowedTypes.has(contentType)) {
    res.status(400).json({ error: "Only text files up to 5 MB are supported." });
    return;
  }
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    if (!objectPath) throw new Error("Could not normalize storage path.");
    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  } catch (error) {
    req.log.error({ error }, "Upload URL generation failed");
    res.status(500).json({ error: "File storage is unavailable right now." });
  }
});

router.get("/storage/objects/*path", async (req, res): Promise<void> => {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  const raw = req.params.path;
  const objectPath = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`;
  try {
    const [message] = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.filePath, objectPath),
          or(eq(messagesTable.senderId, user.id), eq(messagesTable.receiverId, user.id)),
        ),
      )
      .limit(1);
    if (!message) {
      res.status(403).json({ error: "You do not have access to this file." });
      return;
    }
    const response = await storage.downloadObject(await storage.getObjectEntityFile(objectPath));
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    req.log.error({ error }, "File download failed");
    res.status(500).json({ error: "File download failed." });
  }
});

export default router;