import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Trash2, Play, Square, Settings, Crosshair,
  Wifi, WifiOff, AlertCircle, RefreshCw, MapPin, ChevronDown, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Point, Session } from "@shared/schema";

// ── Hilfsfunktion: Zeitstempel formatieren ────────────────────────────────────

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    const day = d.getDate().toString().padStart(2, "0");
    const months = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
    const mon = months[d.getMonth()];
    const yr = d.getFullYear();
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    return `${day}. ${mon} ${yr} · ${hh}:${mm}`;
  } catch {
    return ts;
  }
}

// ── Status Badge (pulsierender grüner Punkt bei "Verbunden") ──────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: any; dot: string; cls: string }> = {
    running:      { label: "Verbunden",   icon: Wifi,        dot: "bg-green-500",  cls: "bg-green-50 text-green-800 border-green-200" },
    stopped:      { label: "Gestoppt",    icon: WifiOff,     dot: "bg-slate-400",  cls: "bg-slate-100 text-slate-600 border-slate-200" },
    error:        { label: "Fehler",      icon: AlertCircle, dot: "bg-red-500",    cls: "bg-red-50 text-red-700 border-red-200" },
    reconnecting: { label: "Reconnect…", icon: RefreshCw,   dot: "bg-amber-500",  cls: "bg-amber-50 text-amber-700 border-amber-200" },
  };
  const s = map[status] ?? map.stopped;
  const Icon = s.icon;
  const pulsing = status === "running";
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium ${s.cls}`}>
      {/* pulsierender Punkt statt Icon */}
      <span className="relative flex h-2.5 w-2.5">
        {pulsing && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${s.dot} opacity-60`} />
        )}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${s.dot}`} />
      </span>
      {s.label}
    </span>
  );
}

// ── 2D Lageplan mit Zoom/Pan ──────────────────────────────────────────────────

function PointMap({ points }: { points: Point[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Zoom/Pan State
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number; lastDist: number }>(
    { active: false, lastX: 0, lastY: 0, lastDist: 0 }
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Hintergrund
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, W, H);

    if (points.length === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Noch keine Punkte", W / 2, H / 2 - 8);
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#cbd5e1";
      ctx.fillText("TS07 verbinden und Start drücken", W / 2, H / 2 + 12);
      return;
    }

    const { zoom, panX, panY } = viewRef.current;

    const xs = points.map((p) => p.e);
    const ys = points.map((p) => p.n);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const pad = 44;
    const rangeX = maxX - minX || 2;
    const rangeY = maxY - minY || 2;
    const baseScaleX = (W - 2 * pad) / rangeX;
    const baseScaleY = (H - 2 * pad) / rangeY;
    const baseScale = Math.min(baseScaleX, baseScaleY);
    const scale = baseScale * zoom;

    const baseOffX = pad + ((W - 2 * pad) - rangeX * scale) / 2;
    const baseOffY = pad + ((H - 2 * pad) - rangeY * scale) / 2;
    const offsetX = baseOffX + panX;
    const offsetY = baseOffY + panY;

    // Gitter (im transformierten Raum)
    const gridStep = Math.pow(10, Math.floor(Math.log10(rangeX / 4)));
    const gx0 = Math.floor(minX / gridStep) * gridStep;
    const gy0 = Math.floor(minY / gridStep) * gridStep;
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    for (let gx = gx0; gx <= maxX + gridStep; gx += gridStep) {
      const cx = offsetX + (gx - minX) * scale;
      if (cx < 0 || cx > W) continue;
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    }
    for (let gy = gy0; gy <= maxY + gridStep; gy += gridStep) {
      const cy = H - (offsetY + (gy - minY) * scale);
      if (cy < 0 || cy > H) continue;
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
    }

    const toCanvas = (x: number, y: number) => ({
      cx: offsetX + (x - minX) * scale,
      cy: H - (offsetY + (y - minY) * scale),
    });

    // Verbindungslinien (gestrichelt)
    ctx.strokeStyle = "#93c5fd";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    points.forEach((p, i) => {
      const { cx, cy } = toCanvas(p.e, p.n);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Punkte zeichnen
    points.forEach((p, i) => {
      const { cx, cy } = toCanvas(p.e, p.n);
      const isLast = i === points.length - 1;

      if (isLast) {
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, isLast ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isLast ? "#1d4ed8" : "#3b82f6";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = isLast ? 2 : 1.5;
      ctx.stroke();

      ctx.fillStyle = isLast ? "#1e293b" : "#64748b";
      ctx.font = `${isLast ? "bold " : ""}11px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(p.pid, cx, cy - 11);
    });

    // Zoom-Anzeige
    if (zoom !== 1) {
      ctx.fillStyle = "rgba(30,41,59,0.55)";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${zoom.toFixed(1)}×`, W - 8, H - 8);
    }
  }, [points]);

  // Zoom zentriert auf Canvas-Mitte
  const applyZoom = useCallback((delta: number, cx: number, cy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const v = viewRef.current;
    const factor = delta > 0 ? 1.2 : 1 / 1.2;
    const newZoom = Math.min(Math.max(v.zoom * factor, 0.2), 20);
    // Zoom um den Cursor-Punkt
    v.panX = cx - (cx - v.panX) * (newZoom / v.zoom);
    v.panY = cy - (cy - v.panY) * (newZoom / v.zoom);
    v.zoom = newZoom;
    draw();
  }, [draw]);

  // Maus-Wheel Zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(-e.deltaY, e.offsetX, e.offsetY);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  // Maus Pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onDown = (e: MouseEvent) => {
      dragRef.current.active = true;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    };
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      viewRef.current.panX += e.clientX - dragRef.current.lastX;
      viewRef.current.panY += e.clientY - dragRef.current.lastY;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      draw();
    };
    const onUp = () => { dragRef.current.active = false; };
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draw]);

  // Touch: Pan + Pinch-Zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        dragRef.current.active = true;
        dragRef.current.lastX = e.touches[0].clientX;
        dragRef.current.lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        dragRef.current.active = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        dragRef.current.lastDist = Math.hypot(dx, dy);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && dragRef.current.active) {
        viewRef.current.panX += e.touches[0].clientX - dragRef.current.lastX;
        viewRef.current.panY += e.touches[0].clientY - dragRef.current.lastY;
        dragRef.current.lastX = e.touches[0].clientX;
        dragRef.current.lastY = e.touches[0].clientY;
        draw();
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = canvas.getBoundingClientRect();
        applyZoom(dist - dragRef.current.lastDist, midX - rect.left, midY - rect.top);
        dragRef.current.lastDist = dist;
      }
    };
    const onTouchEnd = () => { dragRef.current.active = false; };
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [applyZoom, draw]);

  // Doppelklick/Doppeltap: Reset
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onDblClick = () => {
      viewRef.current = { zoom: 1, panX: 0, panY: 0 };
      draw();
    };
    canvas.addEventListener("dblclick", onDblClick);
    return () => canvas.removeEventListener("dblclick", onDblClick);
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      draw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full rounded-b-xl"
      style={{ minHeight: 220, cursor: "grab", touchAction: "none" }}
    />
  );
}

// ── Letzter Punkt – Detail-Karte (inspiriert von Emlid "Punkt-Detail") ────────

function LastPointCard({ point }: { point: Point }) {
  const ts = formatTimestamp(point.timestamp);
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Kopfzeile */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <MapPin size={15} className="text-blue-600 shrink-0" />
          <span className="font-semibold text-slate-800 text-base truncate">{point.pid}</span>
        </div>
        <span className="text-xs text-slate-400 shrink-0">{ts}</span>
      </div>

      {/* Koordinaten */}
      <div className="px-4 py-3">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2.5">
          Koordinaten
        </p>
        <div className="grid grid-cols-3 gap-3">
          {/* Easting */}
          <div className="bg-slate-50 rounded-lg px-3 py-2.5">
            <p className="text-xs text-slate-400 mb-1">E</p>
            <p className="font-mono font-semibold text-slate-800 text-sm tabular">
              {point.e.toFixed(3)}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">m</p>
          </div>
          {/* Northing */}
          <div className="bg-slate-50 rounded-lg px-3 py-2.5">
            <p className="text-xs text-slate-400 mb-1">N</p>
            <p className="font-mono font-semibold text-slate-800 text-sm tabular">
              {point.n.toFixed(3)}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">m</p>
          </div>
          {/* Height */}
          <div className="bg-slate-50 rounded-lg px-3 py-2.5">
            <p className="text-xs text-slate-400 mb-1">H</p>
            <p className="font-mono font-semibold text-slate-800 text-sm tabular">
              {point.h.toFixed(3)}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">m</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Punktliste (mit Zeitstempel, wie Emlid "Objekte") ─────────────────────────

function PointList({
  points,
  onDelete,
  onClearAll,
}: {
  points: Point[];
  onDelete: (id: number) => void;
  onClearAll: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Kopfzeile */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <button
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          onClick={() => setExpanded((v) => !v)}
          data-testid="button-toggle-list"
        >
          <span className="text-sm font-semibold text-slate-700">Messpunkte</span>
          {/* Zähler-Badge */}
          <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">
            {points.length}
          </span>
          {expanded ? (
            <ChevronUp size={15} className="text-slate-400 ml-auto" />
          ) : (
            <ChevronDown size={15} className="text-slate-400 ml-auto" />
          )}
        </button>
        {points.length > 0 && (
          <button
            className="text-xs text-red-400 hover:text-red-600 transition-colors shrink-0"
            onClick={onClearAll}
            data-testid="button-clear-all"
          >
            Alle löschen
          </button>
        )}
      </div>

      {/* Liste */}
      {expanded && (
        <>
          {points.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Crosshair size={28} className="mx-auto mb-2 text-slate-200" />
              <p className="text-sm text-slate-400">Noch keine Messungen</p>
              <p className="text-xs text-slate-300 mt-1">Punkte erscheinen hier nach der Messung</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
              {/* Spalten-Header */}
              <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-100">
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span className="w-6 shrink-0" />
                  <span className="w-20 shrink-0">PID</span>
                  <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: "1fr 1.4fr 0.9fr" }}>
                    <span className="text-right">E (m)</span>
                    <span className="text-right">N (m)</span>
                    <span className="text-right">H (m)</span>
                  </div>
                  <span className="w-5 shrink-0" />
                </div>
              </div>

              {points.map((p, i) => (
                <div
                  key={p.id}
                  className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors group"
                  data-testid={`row-point-${p.id}`}
                >
                  {/* Nummer */}
                  <span className="text-xs text-slate-300 tabular w-6 text-right shrink-0">
                    {points.length - i}
                  </span>

                  {/* PID + Zeitstempel (vertikal) */}
                  <div className="w-20 shrink-0 min-w-0">
                    <p className="font-medium text-slate-700 text-sm truncate">{p.pid}</p>
                    <p className="text-xs text-slate-400 truncate">{formatTimestamp(p.timestamp)}</p>
                  </div>

                  {/* Koordinaten */}
                  <div
                    className="flex-1 grid gap-1 text-xs tabular text-slate-500 min-w-0"
                    style={{ gridTemplateColumns: "1fr 1.4fr 0.9fr" }}
                  >
                    <span className="text-right font-mono">{p.e.toFixed(3)}</span>
                    <span className="text-right font-mono">{p.n.toFixed(3)}</span>
                    <span className="text-right font-mono">{p.h.toFixed(3)}</span>
                  </div>

                  {/* Löschen */}
                  <button
                    className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all shrink-0"
                    onClick={() => onDelete(p.id)}
                    data-testid={`button-delete-${p.id}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Einstellungen Panel ───────────────────────────────────────────────────────

function SettingsPanel({ session, onClose }: { session: Session; onClose: () => void }) {
  const { toast } = useToast();
  const [port, setPort] = useState(session.port);
  const [filename, setFilename] = useState(session.filename);
  const [dbF, setDbF] = useState(Boolean(session.db_format));
  const [csvF, setCsvF] = useState(Boolean(session.csv_format));
  const [gsiF, setGsiF] = useState(Boolean(session.gsi_format));
  const [geojsonF, setGeojsonF] = useState(Boolean(session.geojson_format));

  const saveMutation = useMutation({
    mutationFn: (data: Partial<Session>) => apiRequest("PATCH", "/api/session", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/session"] });
      toast({ title: "Einstellungen gespeichert" });
      onClose();
    },
  });

  const handleSave = () => {
    if (!dbF && !csvF && !gsiF && !geojsonF) {
      toast({ title: "Mindestens ein Format wählen", variant: "destructive" });
      return;
    }
    saveMutation.mutate({
      port,
      filename,
      db_format: dbF ? 1 : 0,
      csv_format: csvF ? 1 : 0,
      gsi_format: gsiF ? 1 : 0,
      geojson_format: geojsonF ? 1 : 0,
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
        data-testid="settings-panel"
      >
        {/* Kopf */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">Einstellungen</h2>
          <button
            className="text-slate-400 hover:text-slate-600 transition-colors"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Port */}
        <div className="space-y-1.5">
          <Label htmlFor="port" className="text-sm text-slate-600">TCP-Port (BT/TCP Bridge)</Label>
          <Input
            id="port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="tcp://localhost:4444"
            className="font-mono text-sm"
            data-testid="input-port"
          />
        </div>

        {/* Dateiname */}
        <div className="space-y-1.5">
          <Label htmlFor="filename" className="text-sm text-slate-600">Dateiname (ohne Endung)</Label>
          <Input
            id="filename"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="aufnahme"
            data-testid="input-filename"
          />
        </div>

        {/* Ausgabeformate */}
        <div className="space-y-3">
          <p className="text-sm text-slate-600 font-medium">Ausgabeformate</p>
          <div className="bg-slate-50 rounded-lg p-3 space-y-3">
            {[
              { id: "db",      label: "SQLite (.db)",          sub: "Vollständige Datenbank",    checked: dbF,      set: setDbF },
              { id: "csv",     label: "CSV",                   sub: "Emlid-kompatibel",           checked: csvF,     set: setCsvF },
              { id: "gsi",     label: "GSI Rohformat",         sub: "Original Leica-Format",      checked: gsiF,     set: setGsiF },
              { id: "geojson", label: "GeoJSON",               sub: "Für GIS-Software",           checked: geojsonF, set: setGeojsonF },
            ].map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 font-medium">{f.label}</p>
                  <p className="text-xs text-slate-400">{f.sub}</p>
                </div>
                <Switch
                  id={f.id}
                  checked={f.checked}
                  onCheckedChange={f.set}
                  data-testid={`switch-${f.id}`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="flex-1"
            data-testid="button-save-settings"
          >
            Speichern
          </Button>
          <Button variant="outline" onClick={onClose} className="flex-1">
            Abbrechen
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Haupt-Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { toast } = useToast();
  const [showSettings, setShowSettings] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showClearAll, setShowClearAll] = useState(false);
  const [wsStatus, setWsStatus] = useState<string>("stopped");

  const { data: points = [] } = useQuery<Point[]>({
    queryKey: ["/api/points"],
    refetchInterval: 5000,
  });

  const { data: session } = useQuery<Session>({
    queryKey: ["/api/session"],
  });

  // WebSocket für Live-Updates
  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.hostname}:5001`;
    let ws: WebSocket;

    function connect() {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.type === "point") queryClient.invalidateQueries({ queryKey: ["/api/points"] });
        if (msg.type === "status") {
          setWsStatus(msg.status);
          queryClient.invalidateQueries({ queryKey: ["/api/session"] });
        }
      };
      ws.onclose = () => setTimeout(connect, 2000);
    }

    connect();
    return () => ws?.close();
  }, []);

  const status = session?.status ?? wsStatus;
  const isRunning = status === "running";

  // API gibt Punkte DESC zurück (neuester zuerst) → points[0] ist der neueste
  const lastPoint = points.length > 0 ? points[0] : null;

  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/collector/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/session"] });
      toast({ title: "Aufnahme gestartet" });
    },
    onError: () => toast({ title: "Fehler beim Starten", variant: "destructive" }),
  });

  const stopMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/collector/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/session"] });
      toast({ title: "Aufnahme gestoppt" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/points/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/points"] });
      setDeleteId(null);
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/points"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/points"] });
      setShowClearAll(false);
      toast({ title: "Alle Punkte gelöscht" });
    },
  });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          {/* Logo: Theodolit-artig */}
          <svg viewBox="0 0 32 32" width="30" height="30" fill="none" aria-label="tachyflow">
            <circle cx="16" cy="16" r="13" stroke="#1d4ed8" strokeWidth="2" />
            <circle cx="16" cy="16" r="3.5" fill="#1d4ed8" />
            <line x1="16" y1="3" x2="16" y2="9" stroke="#1d4ed8" strokeWidth="2" strokeLinecap="round" />
            <line x1="16" y1="16" x2="23" y2="9" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="23" cy="9" r="2" fill="#60a5fa" />
          </svg>
          <div>
            <span className="font-semibold text-slate-800 text-base leading-none tracking-tight">
              tachyflow
            </span>
            <p className="text-xs text-slate-400 leading-none mt-0.5">
              {session?.port ?? "tcp://localhost:4444"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          <button
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
            onClick={() => setShowSettings(true)}
            data-testid="button-settings"
            title="Einstellungen"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* ── Hauptbereich ── */}
      <main className="flex-1 flex flex-col gap-0 max-w-2xl mx-auto w-full">

        {/* Lageplan — oben, größer */}
        <div className="bg-white border-b border-slate-200 overflow-hidden">
          {/* Kartenheader */}
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Crosshair size={14} className="text-slate-400" />
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Lageplan</span>
            {points.length > 0 && (
              <span className="ml-auto text-xs text-slate-400">{points.length} Pt.</span>
            )}
          </div>
          <div style={{ height: 280 }}>
            <PointMap points={points} />
          </div>
        </div>

        {/* Padding-Bereich für die Karten darunter */}
        <div className="p-4 space-y-3">

          {/* Steuerleiste: Start/Stop + Zähler */}
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-700">
                {isRunning ? "Aufnahme läuft" : "Aufnahme gestoppt"}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {points.length === 0
                  ? "Noch keine Messungen"
                  : `${points.length} Punkt${points.length !== 1 ? "e" : ""} gespeichert`}
              </p>
            </div>
            {!isRunning ? (
              <Button
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
                className="gap-2 px-5"
                data-testid="button-start"
              >
                <Play size={14} />
                Start
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
                className="gap-2 px-5"
                data-testid="button-stop"
              >
                <Square size={14} />
                Stop
              </Button>
            )}
          </div>

          {/* Letzter Punkt – Detail */}
          {lastPoint && <LastPointCard point={lastPoint} />}

          {/* Punktliste */}
          <PointList
            points={points}
            onDelete={(id) => setDeleteId(id)}
            onClearAll={() => setShowClearAll(true)}
          />

        </div>
      </main>

      {/* ── Einstellungen ── */}
      {showSettings && session && (
        <SettingsPanel session={session} onClose={() => setShowSettings(false)} />
      )}

      {/* ── Löschen-Dialoge ── */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Punkt löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dieser Punkt wird dauerhaft gelöscht und kann nicht wiederhergestellt werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showClearAll} onOpenChange={setShowClearAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alle Punkte löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle {points.length} Punkte werden dauerhaft gelöscht. Dies kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clearMutation.mutate()}
              className="bg-red-600 hover:bg-red-700"
            >
              Alle löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
