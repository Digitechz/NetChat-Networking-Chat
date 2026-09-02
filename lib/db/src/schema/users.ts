import { boolean, serial, text, timestamp, varchar, pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 24 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: varchar("display_name", { length: 40 }).notNull(),
  online: boolean("online").notNull().default(false),
  lastSeen: timestamp("last_seen", { withTimezone: true }),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;