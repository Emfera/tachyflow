import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { points, sessions, type Point, type InsertPoint, type Session, type InsertSession } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("tachyflow.db");
const db = drizzle(sqlite);

// Tabellen anlegen
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL,
    e REAL NOT NULL,
    n REAL NOT NULL,
    h REAL NOT NULL,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'geocom_gsi'
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    port TEXT NOT NULL DEFAULT 'tcp://localhost:4444',
    db_format INTEGER NOT NULL DEFAULT 1,
    csv_format INTEGER NOT NULL DEFAULT 0,
    gsi_format INTEGER NOT NULL DEFAULT 0,
    geojson_format INTEGER NOT NULL DEFAULT 0,
    filename TEXT NOT NULL DEFAULT 'aufnahme',
    status TEXT NOT NULL DEFAULT 'stopped',
    started_at TEXT,
    error_msg TEXT
  );
`);

export interface IStorage {
  // Punkte
  getAllPoints(): Point[];
  addPoint(point: InsertPoint): Point;
  deletePoint(id: number): void;
  clearPoints(): void;

  // Session
  getSession(): Session;
  updateSession(data: Partial<InsertSession>): Session;
}

export class Storage implements IStorage {
  getAllPoints(): Point[] {
    return db.select().from(points).orderBy(desc(points.id)).all();
  }

  addPoint(point: InsertPoint): Point {
    return db.insert(points).values(point).returning().get();
  }

  deletePoint(id: number): void {
    db.delete(points).where(eq(points.id, id)).run();
  }

  clearPoints(): void {
    sqlite.exec("DELETE FROM points");
  }

  getSession(): Session {
    let session = db.select().from(sessions).get();
    if (!session) {
      db.insert(sessions).values({
        port: "tcp://localhost:4444",
        db_format: true,
        csv_format: false,
        gsi_format: false,
        geojson_format: false,
        filename: "aufnahme",
        status: "stopped",
      }).run();
      session = db.select().from(sessions).get()!;
    }
    return session;
  }

  updateSession(data: Partial<InsertSession>): Session {
    this.getSession(); // ensure exists
    db.update(sessions).set(data).run();
    return db.select().from(sessions).get()!;
  }
}

export const storage = new Storage();
