/**
 * tachyflow — Storage-Schicht
 *
 * Verwendet sql.js (reines JavaScript-SQLite, keine nativen Kompilate nötig).
 * Die Datenbank wird als Datei auf der Festplatte gespeichert und bei jeder
 * Änderung automatisch zurückgeschrieben.
 *
 * Warum sql.js statt better-sqlite3?
 * better-sqlite3 ist ein C++-Addon und braucht beim `npm install` einen
 * nativen Compiler (node-gyp + Android NDK). Das gibt es auf Termux nicht.
 * sql.js ist reines JavaScript — es funktioniert überall.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import type { Point, InsertPoint, Session, InsertSession } from "@shared/schema";

import { join } from "path";
// sql.js über require laden (CommonJS-kompatibel im ESM-Bundle via esbuild)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require("sql.js");

const DB_PATH = "tachyflow.db";

// ─── Typen ──────────────────────────────────────────────────────────────────

// Interne Typen, die sql.js zurückgibt
interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): SqlJsDatabase;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  export(): Uint8Array;
  close(): void;
}

// ─── Singleton-Initialisierung ──────────────────────────────────────────────

let _db: SqlJsDatabase | null = null;

/**
 * Gibt die geöffnete Datenbank zurück.
 * Beim ersten Aufruf wird sql.js geladen und die DB-Datei geöffnet (oder neu erstellt).
 */
async function getDb(): Promise<SqlJsDatabase> {
  if (_db) return _db;

  // locateFile sagt sql.js wo die sql-wasm.wasm Datei liegt.
  // Im Production-Build liegt sie neben dist/index.cjs
  const SQL = await initSqlJs({
    locateFile: () => join(__dirname, "sql-wasm.wasm")
  });

  if (existsSync(DB_PATH)) {
    // Vorhandene Datei laden
    const fileBuffer = readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer) as SqlJsDatabase;
  } else {
    // Neue leere Datenbank anlegen
    _db = new SQL.Database() as SqlJsDatabase;
  }

  // Tabellen anlegen (falls noch nicht vorhanden)
  _db.run(`
    CREATE TABLE IF NOT EXISTS points (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      pid       TEXT    NOT NULL,
      e         REAL    NOT NULL,
      n         REAL    NOT NULL,
      h         REAL    NOT NULL,
      timestamp TEXT    NOT NULL,
      source    TEXT    NOT NULL DEFAULT 'geocom_gsi'
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      port          TEXT    NOT NULL DEFAULT 'tcp://localhost:4444',
      db_format     INTEGER NOT NULL DEFAULT 1,
      csv_format    INTEGER NOT NULL DEFAULT 0,
      gsi_format    INTEGER NOT NULL DEFAULT 0,
      geojson_format INTEGER NOT NULL DEFAULT 0,
      filename      TEXT    NOT NULL DEFAULT 'aufnahme',
      epsg_code     INTEGER NOT NULL DEFAULT 31256,
      status        TEXT    NOT NULL DEFAULT 'stopped',
      started_at    TEXT,
      error_msg     TEXT
    );
  `);

  // Migration: epsg_code-Spalte zu bestehenden Datenbanken hinzufügen (idempotent)
  try {
    _db.run("ALTER TABLE sessions ADD COLUMN epsg_code INTEGER NOT NULL DEFAULT 31256");
  } catch {
    // Spalte existiert bereits — kein Fehler
  }

  // Einmalig auf Platte schreiben (damit die Datei existiert)
  _save();

  return _db as SqlJsDatabase;
}

/** Schreibt den aktuellen DB-Inhalt auf die Festplatte. */
function _save(): void {
  if (_db === null) return;
  const data = (_db as SqlJsDatabase).export();
  writeFileSync(DB_PATH, Buffer.from(data));
}

/**
 * Liest alle Zeilen einer SELECT-Abfrage und gibt sie als Array von Objekten zurück.
 * sql.js liefert { columns: string[], values: unknown[][] } — das wandeln wir um.
 */
function _queryAll<T>(db: SqlJsDatabase, sql: string, params: unknown[] = []): T[] {
  // sql.js: run() für Schreib-Ops, exec() für Lese-Ops
  // Für parametrisierte Queries nutzen wir run() mit RETURNING oder exec()
  // Hier: einfaches exec() für SELECTs ohne Parameter
  const result = db.exec(sql);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj as T;
  });
}

/**
 * Führt eine parametrisierte Query aus und gibt den letzten eingefügten
 * Datensatz zurück (für INSERT ... RETURNING-ähnliches Verhalten).
 */
function _runAndGetLast<T>(db: SqlJsDatabase, insertSql: string, params: unknown[], selectSql: string): T {
  db.run(insertSql, params);
  _save();
  const rows = _queryAll<T>(db, selectSql);
  return rows[rows.length - 1];
}

// ─── Interface ──────────────────────────────────────────────────────────────

export interface IStorage {
  // Punkte
  getAllPoints(): Promise<Point[]>;
  addPoint(point: InsertPoint): Promise<Point>;
  deletePoint(id: number): Promise<void>;
  clearPoints(): Promise<void>;

  // Session
  getSession(): Promise<Session>;
  updateSession(data: Partial<InsertSession>): Promise<Session>;
}

// ─── Implementierung ─────────────────────────────────────────────────────────

export class Storage implements IStorage {

  async getAllPoints(): Promise<Point[]> {
    const db = await getDb();
    return _queryAll<Point>(db, "SELECT * FROM points ORDER BY id DESC");
  }

  async addPoint(point: InsertPoint): Promise<Point> {
    const db = await getDb();
    const ts = point.timestamp ?? new Date().toISOString();
    const src = point.source ?? "geocom_gsi";
    return _runAndGetLast<Point>(
      db,
      "INSERT INTO points (pid, e, n, h, timestamp, source) VALUES (?, ?, ?, ?, ?, ?)",
      [point.pid, point.e, point.n, point.h, ts, src],
      "SELECT * FROM points ORDER BY id DESC LIMIT 1"
    );
  }

  async deletePoint(id: number): Promise<void> {
    const db = await getDb();
    db.run("DELETE FROM points WHERE id = ?", [id]);
    _save();
  }

  async clearPoints(): Promise<void> {
    const db = await getDb();
    db.run("DELETE FROM points");
    _save();
  }

  async getSession(): Promise<Session> {
    const db = await getDb();
    const rows = _queryAll<Session>(db, "SELECT * FROM sessions LIMIT 1");
    if (rows.length > 0) return rows[0];

    // Neue Default-Session anlegen
    return _runAndGetLast<Session>(
      db,
      `INSERT INTO sessions (port, db_format, csv_format, gsi_format, geojson_format, filename, epsg_code, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["tcp://localhost:4444", 1, 0, 0, 0, "aufnahme", 31256, "stopped"],
      "SELECT * FROM sessions LIMIT 1"
    );
  }

  async updateSession(data: Partial<InsertSession>): Promise<Session> {
    await this.getSession(); // sicherstellen dass eine Session existiert

    const db = await getDb();

    // Nur übergebene Felder aktualisieren
    const entries = Object.entries(data).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.getSession();

    const setClauses = entries.map(([k]) => `${k} = ?`).join(", ");
    const values = entries.map(([, v]) => v);

    db.run(`UPDATE sessions SET ${setClauses}`, values);
    _save();

    const rows = _queryAll<Session>(db, "SELECT * FROM sessions LIMIT 1");
    return rows[0];
  }
}

export const storage = new Storage();
