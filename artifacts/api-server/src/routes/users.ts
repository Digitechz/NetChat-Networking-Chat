import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { ListUsersResponse } from "@workspace/api-zod";
import { getUserFromRequest, userForResponse } from "../lib/auth";

const router: IRouter = Router();

router.get("/users", async (req, res): Promise<void> => {
  const currentUser = await getUserFromRequest(req);
  if (!currentUser) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  const allUsers = await db.select().from(usersTable).orderBy(asc(usersTable.displayName));
  res.json(ListUsersResponse.parse(allUsers.filter((user) => user.id !== currentUser.id).map(userForResponse)));
});

export default router;