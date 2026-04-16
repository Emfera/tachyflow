/**
 * tachyflow Collector
 *
 * TCP-Client der sich mit der BT/TCP Bridge verbindet,
 * GSI-Zeilen liest und Punkte in die DB speichert.
 * Läuft als Singleton im Express-Prozess.
 */

import * as net from "net";
import { storage } from "./storage";
import { type Server as WsServer } from "ws";

// GeoCOM Request
const GEOCOM_GET_LAST_GSI = "%R1Q,2115:\r\n";

// GSI Word-Indizes
function parseGSI(line: string): { pid: string; e: number; n: number; h: number } | null {
  // Entferne GeoCOM-Wrapper: %R1P,0,0:0,*... → *...
  const gsiLine = line.includes("%R1P") && line.includes("*")
    ? line.substring(line.indexOf("*"))
    : line.startsWith("*") ? line : null;

  if (!gsiLine) return null;

  // GSI16-Format: jedes Wort ist WWWUUU+VVVVVVVVVVVVVVVV (16 Zeichen)
  // WWW = 2-stelliger Wort-Index (z.B. 11, 21, 22, 31, 51...)
  // UUU = 3-4 Zeichen Einheit/Info (z.B. .032, ...)
  // +VVVVVVVVVVVVVVVV = Vorzeichen + 16-stelliger Wert
  const wordRe = /\b(\d{2})[.\d]{0,4}([+-][\w.]+)/g;
  const words: Record<number, string> = {};
  let m;
  while ((m = wordRe.exec(gsiLine)) !== null) {
    const idx = parseInt(m[1]);
    // Nur sinnvolle Indizes speichern (nicht z.B. Teile von Koordinatenwerten)
    if (idx >= 11 && idx <= 99) {
      words[idx] = m[2];
    }
  }

  // PID (Index 11)
  const pidRaw = words[11];
  if (!pidRaw) return null;
  const pid = pidRaw.replace(/^[+0]+/, "").replace(/[^A-Za-z0-9]/g, "") || "0";

  // Koordinaten: Maske 2 = 81/82/83 (Ost/Nord/Höhe — bevorzugt)
  // Maske 1 liefert auf 21/22/31 nur Winkel/Distanz — NICHT verwenden
  const eRaw = words[81];
  const nRaw = words[82];
  const hRaw = words[83];

  if (!eRaw || !nRaw || !hRaw) return null;

  function toMeters(val: string): number | null {
    const n = parseFloat(val.replace(",", "."));
    if (isNaN(n)) return null;
    return n / 1000;
  }

  const e = toMeters(eRaw);
  const n = toMeters(nRaw);
  const h = toMeters(hRaw);

  if (e === null || n === null || h === null) return null;

  return { pid, e, n, h };
}

type CollectorState = {
  running: boolean;
  socket: net.Socket | null;
  pollTimer: NodeJS.Timeout | null;
  lastKey: string | null;
  ws: WsServer | null;
};

const state: CollectorState = {
  running: false,
  socket: null,
  pollTimer: null,
  lastKey: null,
  ws: null,
};

export function setWsServer(ws: WsServer) {
  state.ws = ws;
}

function broadcast(msg: object) {
  if (!state.ws) return;
  const data = JSON.stringify(msg);
  state.ws.clients.forEach((c) => {
    if (c.readyState === 1) c.send(data);
  });
}

function measurementKey(pid: string, e: number, n: number, h: number): string {
  return `${pid}|${e.toFixed(3)}|${n.toFixed(3)}|${h.toFixed(3)}`;
}

export function startCollector(port: string) {
  if (state.running) return;
  state.running = true;

  const [host, tcpPort] = port.replace("tcp://", "").split(":");

  function connect() {
    if (!state.running) return;

    const sock = new net.Socket();
    state.socket = sock;
    let buf = "";

    sock.connect(parseInt(tcpPort), host, () => {
      // async IIFE für Storage-Aufrufe in synchronem Callback
      void storage.updateSession({ status: "running", error_msg: null });
      broadcast({ type: "status", status: "running" });

      // Polling starten
      function poll() {
        if (!state.running || sock.destroyed) return;
        sock.write(GEOCOM_GET_LAST_GSI);
        state.pollTimer = setTimeout(poll, 500);
      }
      poll();
    });

    sock.on("data", (data) => {
      buf += data.toString("ascii");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const measurement = parseGSI(trimmed);
        if (!measurement) continue;

        const key = measurementKey(measurement.pid, measurement.e, measurement.n, measurement.h);
        if (key === state.lastKey) continue;
        state.lastKey = key;

        // async IIFE: Punkt speichern und dann broadcasten
        void (async () => {
          const point = await storage.addPoint({
            pid: measurement.pid,
            e: measurement.e,
            n: measurement.n,
            h: measurement.h,
            timestamp: new Date().toISOString(),
            source: "geocom_gsi",
          });
          broadcast({ type: "point", point });
        })();
      }
    });

    sock.on("error", (err) => {
      void storage.updateSession({ status: "error", error_msg: err.message });
      broadcast({ type: "status", status: "error", message: err.message });
    });

    sock.on("close", () => {
      if (!state.running) return;
      // Stillen Reconnect nach 3s
      broadcast({ type: "status", status: "reconnecting" });
      setTimeout(connect, 3000);
    });
  }

  connect();
}

export function stopCollector() {
  state.running = false;
  if (state.pollTimer) clearTimeout(state.pollTimer);
  if (state.socket) {
    state.socket.destroy();
    state.socket = null;
  }
  void storage.updateSession({ status: "stopped", error_msg: null });
  broadcast({ type: "status", status: "stopped" });
}
