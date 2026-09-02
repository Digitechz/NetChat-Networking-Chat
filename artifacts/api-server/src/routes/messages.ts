import { Router, type IRouter } from "express";
import { and, asc, eq, or } from "drizzle-orm";
import { db, messagesTable } from "@workspace/db";
import { GetChatHistoryParams, GetChatHistoryResponse } from "@workspace/api-zod";
import { getUserFromRequest } from "../lib/auth";

const router: IRouter = Router();

router.get("/users/:userId/messages", async (req, res): Promise<void> => {
  const currentUser = await getUserFromRequest(req);
  if (!currentUser) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  const params = GetChatHistoryParams.safeParse({
    userId: Number(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId),
  });
  if (!params.success || !Number.isInteger(params.data.userId) || params.data.userId <= 0) {
    res.status(400).json({ error: "Invalid user id." });
    return;
  }
  const messages = await db
    .select()
    .from(messagesTable)
    .where(
      or(
        and(eq(messagesTable.senderId, currentUser.id), eq(messagesTable.receiverId, params.data.userId)),
        and(eq(messagesTable.senderId, params.data.userId), eq(messagesTable.receiverId, currentUser.id)),
      ),
    )
    .orderBy(asc(messagesTable.timestamp));
  res.json(GetChatHistoryResponse.parse(messages));
});

export default router;