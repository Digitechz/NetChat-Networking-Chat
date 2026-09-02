import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable, type User } from "@workspace/db";

const SESSION_COOKIE = "netchat_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET ?? "netchat-development-secret";

function sessionHash(token: string): string {
  return createHash("sha256")
    .update(`${SESSION_SECRET}:${token}`)
    .digest("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) {
    return false;
  }
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    expectedBuffer.length === actual.length &&
    timingSafeEqual(actual, expectedBuffer)
  );
}

function getCookie(req: Request): string | null {
  const cookies = req.headers.cookie?.split(";") ?? [];
  const session = cookies
    .map((cookie) => cookie.trim().split("="))
    .find(([name]) => name === SESSION_COOKIE);
  return session?.[1] ? decodeURIComponent(session[1]) : null;
}

export async function getUserFromSessionToken(
  token: string | null,
): Promise<User | null> {
  if (!token) {
    return null;
  }
  const [session] = await db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(sessionsTable.tokenHash, sessionHash(token)),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return session?.user ?? null;
}

export function getUserFromRequest(req: Request): Promise<User | null> {
  return getUserFromSessionToken(getCookie(req));
}

export async function createSession(userId: number, res: Response): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessionsTable).values({
    tokenHash: sessionHash(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION_MS,
    path: "/",
  });
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  const token = getCookie(req);
  if (token) {
    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.tokenHash, sessionHash(token)));
  }
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
}

export function userForResponse(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    online: user.online,
    lastSeen: user.lastSeen,
  };
}

export function getSessionTokenFromCookieHeader(
  cookieHeader: string | undefined,
): string | null {
  const session = (cookieHeader?.split(";") ?? [])
    .map((cookie) => cookie.trim().split("="))
    .find(([name]) => name === SESSION_COOKIE);
  return session?.[1] ? decodeURIComponent(session[1]) : null;
}