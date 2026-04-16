import type { Express } from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { storage } from "./storage";
import { startCollector, stopCollector, setWsServer } from "./collector";

export function registerRoutes(httpServer: ReturnType<typeof createServer>, app: Express) {
  // WebSocket auf separatem Port 5001 (kein Konflikt mit Vite)
  const wss = new WebSocketServer({ port: 5001 });
  setWsServer(wss);
  console.log("[tachyflow] WebSocket auf Port 5001");

  // ── Punkte ────────────────────────────────────────────────────────────────

  // Alle Punkte abrufen
  app.get("/api/points", (_req, res) => {
    const pts = storage.getAllPoints();
    res.json(pts);
  });

  // Punkt löschen
  app.delete("/api/points/:id", (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Ungültige ID" });
    storage.deletePoint(id);
    res.json({ ok: true });
  });

  // Alle Punkte löschen
  app.delete("/api/points", (_req, res) => {
    storage.clearPoints();
    res.json({ ok: true });
  });

  // ── Session / Einstellungen ───────────────────────────────────────────────

  app.get("/api/session", (_req, res) => {
    res.json(storage.getSession());
  });

  app.patch("/api/session", (req, res) => {
    const { port, db_format, csv_format, gsi_format, geojson_format, filename } = req.body;
    const updated = storage.updateSession({
      ...(port !== undefined && { port }),
      ...(db_format !== undefined && { db_format }),
      ...(csv_format !== undefined && { csv_format }),
      ...(gsi_format !== undefined && { gsi_format }),
      ...(geojson_format !== undefined && { geojson_format }),
      ...(filename !== undefined && { filename }),
    });
    res.json(updated);
  });

  // ── Collector Start/Stop ──────────────────────────────────────────────────

  app.post("/api/collector/start", (_req, res) => {
    const session = storage.getSession();
    startCollector(session.port);
    res.json({ ok: true, status: "running" });
  });

  app.post("/api/collector/stop", (_req, res) => {
    stopCollector();
    res.json({ ok: true, status: "stopped" });
  });

  return httpServer;
}
