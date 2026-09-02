import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  GetCurrentUserResponse,
  LoginBody,
  LoginResponse,
  RegisterBody,
  RegisterResponse,
} from "@workspace/api-zod";
import {
  createSession,
  destroySession,
  getUserFromRequest,
  hashPassword,
  userForResponse,
  verifyPassword,
} from "../lib/auth";

const router: IRouter = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.flatten() }, "Invalid registration");
    res.status(400).json({ error: "Use a username, display name, and password of the required length." });
    return;
  }
  const username = parsed.data.username.trim().toLowerCase();
  const displayName = parsed.data.displayName.trim();
  if (!/^[a-z0-9_]+$/.test(username) || displayName.length === 0) {
    res.status(400).json({ error: "Username may contain letters, numbers, and underscores only." });
    return;
  }
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "That username is already taken." });
    return;
  }
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      displayName,
      passwordHash: hashPassword(parsed.data.password),
    })
    .returning();
  if (!user) {
    res.status(500).json({ error: "Registration failed." });
    return;
  }
  await createSession(user.id, res);
  res.status(201).json(RegisterResponse.parse({ user: userForResponse(user) }));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, parsed.data.username.trim().toLowerCase()))
    .limit(1);
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    req.log.warn({ username: parsed.data.username }, "Invalid login");
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }
  await createSession(user.id, res);
  res.json(LoginResponse.parse({ user: userForResponse(user) }));
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  res.json(GetCurrentUserResponse.parse(userForResponse(user)));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await destroySession(req, res);
  res.sendStatus(204);
});

export default router;