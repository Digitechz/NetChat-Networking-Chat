import app from "./app";
import { logger } from "./lib/logger";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { attachRealtime } from "./lib/realtime";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "./lib/auth";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function seedDemoUsers(): Promise<void> {
  await db.update(usersTable).set({ online: false });
  const demos = [
    { username: "alice", displayName: "Alice Chen" },
    { username: "bob", displayName: "Bob Martinez" },
    { username: "charlie", displayName: "Charlie Okafor" },
  ];
  for (const demo of demos) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, demo.username))
      .limit(1);
    if (!existing) {
      await db.insert(usersTable).values({
        ...demo,
        passwordHash: hashPassword("password123"),
      });
      logger.info({ username: demo.username }, "DEMO_USER_SEEDED");
    }
  }
}

const server = createServer(app);
const websocketServer = new WebSocketServer({ server, path: "/ws" });
websocketServer.on("connection", (socket, request) => {
  void attachRealtime(socket, request);
});

void seedDemoUsers()
  .then(() => {
    server.listen(port, () => {
      logger.info({ port, websocketPath: "/ws" }, "Server listening");
    });
  })
  .catch((error) => {
    logger.error({ error }, "Unable to seed demo users");
    process.exit(1);
  });
