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

  // GSI-Format: WWUUU+VVVVVVVVVVVVVVVV
  // WW = Wort-Index (2 Ziffern), UUU = Einheit (z.B. .06, .032)
  // Unit-Code bestimmt den Divisor: 06 = /10000 (0.1mm), 03 = /1000 (mm)
  const wordRe = /\b(\d{2})([.\d]{0,4})([+-][\w.]+)/g;
  const words: Record<number, { unit: number; val: string }> = {};
  let m;
  while ((m = wordRe.exec(gsiLine)) !== null) {
    const idx = parseInt(m[1]);
    if (idx >= 11 && idx <= 99) {
      // Unit aus Prefix: '81.06' → unit=6, '22.032' → unit=2
      const unitMatch = m[2].match(/\.(\d{1,2})$/);
      const unit = unitMatch ? parseInt(unitMatch[1]) : 3;
      words[idx] = { unit, val: m[3] };
    }
  }

  // PID (Index 11)
  const pidEntry = words[11];
  if (!pidEntry) return null;
  const pid = pidEntry.val.replace(/^[+0]+/, "").replace(/[^A-Za-z0-9]/g, "") || "0";

  // Koordinaten: WI81=Ost, WI82=Nord, WI83=Höhe (Maske 2+3)
  const eEntry = words[81];
  const nEntry = words[82];
  const hEntry = words[83];

  if (!eEntry || !nEntry || !hEntry) return null;

  // GSI Unit-Code → Divisor
  // Unit 06 = /10000 (0.1mm, GSI16), Unit 03 = /1000 (mm, GSI8)
  const GSI_DIVISOR: Record<number, number> = {
    0: 1, 1: 10, 2: 100, 3: 1000, 4: 10000,
    5: 100000, 6: 10000, 7: 100000, 8: 100000,
  };

  function toMeters(entry: { unit: number; val: string }): number | null {
    try {
      const divisor = GSI_DIVISOR[entry.unit] ?? 1000;
      const sign = entry.val.startsWith('-') ? -1 : 1;
      const raw = entry.val.replace(/^[+-]0*/, '') || '0';
      return sign * parseInt(raw) / divisor;
    } catch { return null; }
  }

  const e = toMeters(eEntry);
  const n = toMeters(nEntry);
  const h = toMeters(hEntry);

  if (e === null || n === null || h === null) return null;

  return { pid, e, n, h };
}

// Letzte rohe GSI-Zeilen für Debug-Zwecke speichern
export const rawLog: string[] = [];
const RAW_LOG_MAX = 20;

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

        // Rohe Zeile für Debug-Endpunkt speichern
        rawLog.push(trimmed);
        if (rawLog.length > RAW_LOG_MAX) rawLog.shift();

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
