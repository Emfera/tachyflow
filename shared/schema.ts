import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Gemessene Punkte
export const points = sqliteTable("points", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  pid: text("pid").notNull(),
  e: real("e").notNull(),
  n: real("n").notNull(),
  h: real("h").notNull(),
  timestamp: text("timestamp").notNull(),
  source: text("source").notNull().default("geocom_gsi"),
});

// Collector-Session (Verbindungsstatus)
export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  port: text("port").notNull().default("tcp://localhost:4444"),
  db_format: integer("db_format", { mode: "boolean" }).notNull().default(true),
  csv_format: integer("csv_format", { mode: "boolean" }).notNull().default(false),
  gsi_format: integer("gsi_format", { mode: "boolean" }).notNull().default(false),
  geojson_format: integer("geojson_format", { mode: "boolean" }).notNull().default(false),
  filename: text("filename").notNull().default("aufnahme"),
  status: text("status").notNull().default("stopped"), // stopped | running | error
  started_at: text("started_at"),
  error_msg: text("error_msg"),
});

export const insertPointSchema = createInsertSchema(points).omit({ id: true });
export type InsertPoint = z.infer<typeof insertPointSchema>;
export type Point = typeof points.$inferSelect;

export const insertSessionSchema = createInsertSchema(sessions).omit({ id: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessions.$inferSelect;
