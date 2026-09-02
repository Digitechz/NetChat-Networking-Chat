import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";
import { and, asc, eq, or } from "drizzle-orm";
import {
  db,
  messagesTable,
  usersTable,
  type Message,
  type User,
} from "@workspace/db";
import {
  getSessionTokenFromCookieHeader,
  getUserFromSessionToken,
  userForResponse,
} from "./auth";
import { logger } from "./logger";

type Client = { socket: WebSocket; user: User };
type ClientEvent = Record<string, unknown> & { type: string };

const clients = new Map<number, Set<WebSocket>>();

function send(socket: WebSocket, payload: ClientEvent): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcast(payload: ClientEvent, except?: WebSocket): void {
  for (const sockets of clients.values()) {
    for (const socket of sockets) {
      if (socket !== except) {
        send(socket, payload);
      }
    }
  }
}

function sendToUser(userId: number, payload: ClientEvent): void {
  for (const socket of clients.get(userId) ?? []) {
    send(socket, payload);
  }
}

function isOnline(userId: number): boolean {
  return (clients.get(userId)?.size ?? 0) > 0;
}

function toMessageResponse(message: Message) {
  return {
    id: message.id,
    senderId: message.senderId,
    receiverId: message.receiverId,
    message: message.message,
    timestamp: message.timestamp,
    status: message.status,
  };
}

async function conversation(userId: number, otherUserId: number): Promise<Message[]> {
  return db
    .select()
    .from(messagesTable)
    .where(
      or(
        and(
          eq(messagesTable.senderId, userId),
          eq(messagesTable.receiverId, otherUserId),
        ),
        and(
          eq(messagesTable.senderId, otherUserId),
          eq(messagesTable.receiverId, userId),
        ),
      ),
    )
    .orderBy(asc(messagesTable.timestamp));
}

async function handleMessage(client: Client, raw: string): Promise<void> {
  let event: ClientEvent;
  try {
    event = JSON.parse(raw) as ClientEvent;
  } catch {
    send(client.socket, { type: "ERROR", message: "Message must be valid JSON." });
    return;
  }
  const body = (event.payload ?? event) as Record<string, unknown>;

  if (event.type === "SEND_MESSAGE") {
    const receiverId = Number(body.receiverId);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!Number.isInteger(receiverId) || receiverId <= 0 || message.length === 0) {
      send(client.socket, {
        type: "ERROR",
        message: "A recipient and non-empty message are required.",
      });
      return;
    }
    if (message.length > 2000) {
      send(client.socket, {
        type: "ERROR",
        message: "Messages must be 2,000 characters or fewer.",
      });
      return;
    }
    if (receiverId === client.user.id) {
      send(client.socket, { type: "ERROR", message: "You cannot message yourself." });
      return;
    }
    const [receiver] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, receiverId))
      .limit(1);
    if (!receiver) {
      send(client.socket, { type: "ERROR", message: "Recipient not found." });
      return;
    }

    const delivered = isOnline(receiverId);
    const [stored] = await db
      .insert(messagesTable)
      .values({
        senderId: client.user.id,
        receiverId,
        message,
        status: delivered ? "delivered" : "sent",
      })
      .returning();
    if (!stored) {
      send(client.socket, { type: "ERROR", message: "Message could not be stored." });
      return;
    }

    const payload = {
      type: "RECEIVE_MESSAGE",
      message: toMessageResponse(stored),
    };
    send(client.socket, { type: "RECEIVE_MESSAGE", payload: toMessageResponse(stored) });
    if (delivered) {
      sendToUser(receiverId, { type: "RECEIVE_MESSAGE", payload: toMessageResponse(stored) });
      send(client.socket, {
        type: "MESSAGE_DELIVERED",
        payload: {
          messageId: stored.id,
          senderId: stored.senderId,
          receiverId: stored.receiverId,
        },
      });
      logger.info(
        { messageId: stored.id, senderId: client.user.id, receiverId },
        "MESSAGE_DELIVERED",
      );
    }
    logger.info(
      { messageId: stored.id, senderId: client.user.id, receiverId },
      "MESSAGE_STORED",
    );
    return;
  }

  if (event.type === "GET_CHAT_HISTORY") {
    const otherUserId = Number(body.userId);
    if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
      send(client.socket, { type: "ERROR", message: "Invalid conversation." });
      return;
    }
    const messages = await conversation(client.user.id, otherUserId);
    send(client.socket, {
      type: "CHAT_HISTORY",
      payload: { userId: otherUserId, messages: messages.map(toMessageResponse) },
    });
    return;
  }

  if (event.type === "MESSAGE_READ") {
    const messageId = Number(body.messageId);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return;
    }
    const [updated] = await db
      .update(messagesTable)
      .set({ status: "read" })
      .where(
        and(
          eq(messagesTable.id, messageId),
          eq(messagesTable.receiverId, client.user.id),
        ),
      )
      .returning();
    if (updated) {
      sendToUser(updated.senderId, {
        type: "MESSAGE_READ",
        payload: {
          messageId: updated.id,
          senderId: updated.senderId,
          receiverId: updated.receiverId,
        },
      });
    }
    return;
  }

  if (event.type === "TYPING_START" || event.type === "TYPING_STOP") {
    const receiverId = Number(body.receiverId);
    if (Number.isInteger(receiverId) && receiverId > 0) {
      sendToUser(receiverId, {
        type: event.type,
        payload: { senderId: client.user.id },
      });
    }
    return;
  }

  send(client.socket, { type: "ERROR", message: `Unsupported event: ${event.type}` });
}

export async function attachRealtime(socket: WebSocket, request: IncomingMessage): Promise<void> {
  const user = await getUserFromSessionToken(
    getSessionTokenFromCookieHeader(request.headers.cookie),
  );
  if (!user) {
    send(socket, { type: "ERROR", message: "Authentication required." });
    socket.close(1008, "Authentication required");
    return;
  }

  const client: Client = { socket, user };
  const userSockets = clients.get(user.id) ?? new Set<WebSocket>();
  userSockets.add(socket);
  clients.set(user.id, userSockets);
  await db
    .update(usersTable)
    .set({ online: true })
    .where(eq(usersTable.id, user.id));

  send(socket, {
    type: "LOGIN",
    payload: { user: userForResponse(user), activeUsers: clients.size },
  });
  broadcast(
    { type: "USER_ONLINE", payload: { userId: user.id, activeUsers: clients.size } },
    socket,
  );
  logger.info({ userId: user.id }, "USER_CONNECTED");

  socket.on("message", (data) => {
    void handleMessage(client, data.toString()).catch((error) => {
      logger.error({ error, userId: user.id }, "WebSocket message handling failed");
      send(socket, { type: "ERROR", message: "The server could not process that event." });
    });
  });

  socket.on("close", () => {
    void (async () => {
      const current = clients.get(user.id);
      current?.delete(socket);
      if (current?.size === 0) {
        clients.delete(user.id);
        await db
          .update(usersTable)
          .set({ online: false, lastSeen: new Date() })
          .where(eq(usersTable.id, user.id));
        broadcast({
          type: "USER_OFFLINE",
          payload: { userId: user.id, activeUsers: clients.size },
        });
      }
      logger.info({ userId: user.id }, "USER_DISCONNECTED");
    })().catch((error) => logger.error({ error }, "Disconnect handling failed"));
  });
}

export function activeUserCount(): number {
  return clients.size;
}