/**
 * tachyflow — Datentypen und Validierung
 *
 * Kein drizzle-orm mehr — reine TypeScript-Interfaces und Zod-Schemas.
 * sql.js speichert booleans als 0/1 in SQLite.
 */

import { z } from "zod";

// ─── Point ───────────────────────────────────────────────────────────────────

export interface Point {
  id: number;
  pid: string;
  e: number;
  n: number;
  h: number;
  timestamp: string;
  source: string;
}

export const insertPointSchema = z.object({
  pid: z.string(),
  e: z.number(),
  n: z.number(),
  h: z.number(),
  timestamp: z.string().optional(),
  source: z.string().optional(),
});

export type InsertPoint = z.infer<typeof insertPointSchema>;

// ─── Session ─────────────────────────────────────────────────────────────────

export interface Session {
  id: number;
  port: string;
  db_format: number;       // 0 | 1 (SQLite speichert boolean als Integer)
  csv_format: number;
  gsi_format: number;
  geojson_format: number;
  filename: string;
  epsg_code: number;       // EPSG-Code des Koordinatensystems (nur Metadaten, keine Transformation)
                           // Österreich: 31256 = MGI/GK M31 (Standard), 31255 = M28, 31257 = M34
  status: string;          // "stopped" | "running" | "error" | "reconnecting"
  started_at: string | null;
  error_msg: string | null;
}

export const insertSessionSchema = z.object({
  port: z.string().optional(),
  db_format: z.number().optional(),
  csv_format: z.number().optional(),
  gsi_format: z.number().optional(),
  geojson_format: z.number().optional(),
  filename: z.string().optional(),
  epsg_code: z.number().optional(),
  status: z.string().optional(),
  started_at: z.string().nullable().optional(),
  error_msg: z.string().nullable().optional(),
});

export type InsertSession = z.infer<typeof insertSessionSchema>;
