import { pgTable, date, timestamp, varchar, text, integer } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userName: varchar("user_name", { length: 20 }).notNull().unique(),
  gender: varchar("gender", { length: 10 }).notNull().default("Male"),
  dob: date("dob").notNull().defaultNow(),
  password: text("password").notNull(),
  email: varchar("email", { length: 30 }).notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  status: varchar("status", { length: 15 }).notNull().default("Active"),
});