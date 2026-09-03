import { integer, pgEnum, serial, text, timestamp, pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const messageStatusEnum = pgEnum("message_status", ["sent", "delivered", "read"]);
export const messageTypeEnum = pgEnum("message_type", ["text", "file"]);

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  receiverId: integer("receiver_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  messageType: messageTypeEnum("message_type").notNull().default("text"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  fileContentType: text("file_content_type"),
  filePath: text("file_path"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  status: messageStatusEnum("status").notNull().default("sent"),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, timestamp: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;