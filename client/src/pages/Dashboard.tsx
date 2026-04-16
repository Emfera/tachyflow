import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useEffect, useRef, useState, useCallback } from "react";
import { Trash2, Play, Square, Settings, Crosshair, Wifi, WifiOff, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: any; cls: string }> = {
    running:      { label: "Verbunden",    icon: Wifi,        cls: "bg-green-100 text-green-800 border-green-200" },
    stopped:      { label: "Gestoppt",     icon: WifiOff,     cls: "bg-slate-100 text-slate-600 border-slate-200" },
    error:        { label: "Fehler",       icon: AlertCircle, cls: "bg-red-100 text-red-700 border-red-200" },
    reconnecting: { label: "Reconnect…",  icon: RefreshCw,   cls: "bg-amber-100 text-amber-700 border-amber-200" },
  };
  const s = map[status] ?? map.stopped;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm font-medium ${s.cls}`}>
      <Icon size={13} className={status === "reconnecting" ? "animate-spin" : ""} />
      {s.label}
    </span>
  );
}

// ── 2D Karte ─────────────────────────────────────────────────────────────────

function PointMap({ points }: { points: Point[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Hintergrund
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, W, H);

    if (points.length === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px General Sans, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Noch keine Punkte", W / 2, H / 2);
      return;
    }

    // Extent berechnen
    const xs = points.map((p) => p.e);
    const ys = points.map((p) => p.n);
    let minX = Math.min(...xs), maxX = Math.max(...xs);
    let minY = Math.min(...ys), maxY = Math.max(...ys);

    const pad = 40;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scaleX = (W - 2 * pad) / rangeX;
    const scaleY = (H - 2 * pad) / rangeY;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = pad + ((W - 2 * pad) - rangeX * scale) / 2;
    const offsetY = pad + ((H - 2 * pad) - rangeY * scale) / 2;

    const toCanvas = (x: number, y: number) => ({
      cx: offsetX + (x - minX) * scale,
      cy: H - (offsetY + (y - minY) * scale), // Y invertieren
    });

    // Verbindungslinien
    ctx.strokeStyle = "#bfdbfe";
    ctx.lineWidth = 1;
    ctx.beginPath();
    points.forEach((p, i) => {
      const { cx, cy } = toCanvas(p.e, p.n);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    });
    ctx.stroke();

    // Punkte
    points.forEach((p, i) => {
      const { cx, cy } = toCanvas(p.e, p.n);
      const isLast = i === points.length - 1;

      // Punkt-Kreis
      ctx.beginPath();
      ctx.arc(cx, cy, isLast ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isLast ? "#1d4ed8" : "#3b82f6";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // PID-Label (nur letzter Punkt)
      if (isLast) {
        ctx.fillStyle = "#1e293b";
        ctx.font = "bold 11px General Sans, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(p.pid, cx, cy - 10);
      }
    });
  }, [points]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Canvas-Größe beim Resize anpassen
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
      className="w-full h-full rounded-lg"
      style={{ minHeight: 220 }}
    />
  );
}

// ── Einstellungen Panel ───────────────────────────────────────────────────────

function SettingsPanel({ session, onClose }: { session: Session; onClose: () => void }) {
  const { toast } = useToast();
  const [port, setPort] = useState(session.port);
  const [filename, setFilename] = useState(session.filename);
  // sql.js speichert booleans als 0/1 — hier ins Frontend-boolean umwandeln
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
    // Zurück zu 0/1 für die API (sql.js SQLite)
    saveMutation.mutate({ port, filename, db_format: dbF ? 1 : 0, csv_format: csvF ? 1 : 0, gsi_format: gsiF ? 1 : 0, geojson_format: geojsonF ? 1 : 0 });
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
        data-testid="settings-panel"
      >
        <h2 className="text-lg font-semibold text-slate-800">Einstellungen</h2>

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
        <div className="space-y-2">
          <p className="text-sm text-slate-600 font-medium">Ausgabeformate</p>
          {[
            { id: "db", label: "SQLite (.db)", checked: dbF, set: setDbF },
            { id: "csv", label: "CSV (Emlid-kompatibel)", checked: csvF, set: setCsvF },
            { id: "gsi", label: "GSI Rohformat", checked: gsiF, set: setGsiF },
            { id: "geojson", label: "GeoJSON", checked: geojsonF, set: setGeojsonF },
          ].map((f) => (
            <div key={f.id} className="flex items-center gap-3">
              <Switch
                id={f.id}
                checked={f.checked}
                onCheckedChange={f.set}
                data-testid={`switch-${f.id}`}
              />
              <Label htmlFor={f.id} className="text-sm cursor-pointer">{f.label}</Label>
            </div>
          ))}
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

  // Daten laden
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
    const wsHost = location.hostname;
    const wsUrl = `${protocol}//${wsHost}:5001`;
    let ws: WebSocket;

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.type === "point") {
          queryClient.invalidateQueries({ queryKey: ["/api/points"] });
        }
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

  // Aktuellen Status anzeigen
  const status = session?.status ?? wsStatus;

  // Collector Start/Stop
  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/collector/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/session"] });
      toast({ title: "Collector gestartet" });
    },
    onError: () => toast({ title: "Fehler beim Starten", variant: "destructive" }),
  });

  const stopMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/collector/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/session"] });
      toast({ title: "Collector gestoppt" });
    },
  });

  // Punkt löschen
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/points/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/points"] });
      setDeleteId(null);
    },
  });

  // Alle löschen
  const clearMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/points"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/points"] });
      setShowClearAll(false);
      toast({ title: "Alle Punkte gelöscht" });
    },
  });

  const isRunning = status === "running";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* Logo */}
          <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-label="tachyflow">
            <circle cx="16" cy="16" r="14" stroke="#1d4ed8" strokeWidth="2"/>
            <circle cx="16" cy="16" r="3" fill="#1d4ed8"/>
            <line x1="16" y1="2" x2="16" y2="8" stroke="#1d4ed8" strokeWidth="2" strokeLinecap="round"/>
            <line x1="24.5" y1="7.5" x2="20.5" y2="11.5" stroke="#1d4ed8" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="16" y1="16" x2="22" y2="10" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <div>
            <span className="font-semibold text-slate-800 text-base leading-none">tachyflow</span>
            <p className="text-xs text-slate-400 leading-none mt-0.5">
              {session?.port ?? "tcp://localhost:4444"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
            data-testid="button-settings"
          >
            <Settings size={18} />
          </Button>
        </div>
      </header>

      {/* Hauptbereich */}
      <main className="flex-1 p-4 space-y-4 max-w-2xl mx-auto w-full">

        {/* Steuerung */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">
              {isRunning ? "Aufnahme läuft" : "Aufnahme gestoppt"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {points.length} Punkt{points.length !== 1 ? "e" : ""} gespeichert
            </p>
          </div>
          <div className="flex gap-2">
            {!isRunning ? (
              <Button
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
                className="gap-1.5"
                data-testid="button-start"
              >
                <Play size={15} />
                Start
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
                className="gap-1.5"
                data-testid="button-stop"
              >
                <Square size={15} />
                Stop
              </Button>
            )}
          </div>
        </div>

        {/* 2D-Karte */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Crosshair size={15} className="text-slate-400" />
            <span className="text-sm font-medium text-slate-600">Lageplan</span>
            {points.length > 0 && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {points.length} Pt.
              </Badge>
            )}
          </div>
          <div style={{ height: 240 }}>
            <PointMap points={[...points].reverse()} />
          </div>
        </div>

        {/* Punktliste */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Messpunkte</span>
            {points.length > 0 && (
              <button
                className="text-xs text-red-500 hover:text-red-700 transition-colors"
                onClick={() => setShowClearAll(true)}
                data-testid="button-clear-all"
              >
                Alle löschen
              </button>
            )}
          </div>

          {points.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              <Crosshair size={24} className="mx-auto mb-2 opacity-30" />
              Noch keine Messungen
            </div>
          ) : (
            <div className="divide-y divide-slate-50 max-h-96 overflow-y-auto">
              {points.map((p, i) => (
                <div
                  key={p.id}
                  className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors group"
                  data-testid={`row-point-${p.id}`}
                >
                  {/* Nr */}
                  <span className="text-xs text-slate-300 tabular w-6 text-right">
                    {points.length - i}
                  </span>

                  {/* PID */}
                  <span className="font-medium text-slate-700 text-sm w-20 truncate">
                    {p.pid}
                  </span>

                  {/* Koordinaten */}
                  <div className="flex-1 grid gap-1 text-xs tabular text-slate-500 min-w-0" style={{gridTemplateColumns: '1fr 1.4fr 0.9fr'}}>
                    <span className="text-right font-mono">{p.e.toFixed(3)}</span>
                    <span className="text-right font-mono">{p.n.toFixed(3)}</span>
                    <span className="text-right font-mono">{p.h.toFixed(3)}</span>
                  </div>

                  {/* Löschen */}
                  <button
                    className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all"
                    onClick={() => setDeleteId(p.id)}
                    data-testid={`button-delete-${p.id}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Koordinaten-Header */}
          {points.length > 0 && (
            <div className="px-4 py-1.5 border-t border-slate-100 bg-slate-50">
              <div className="flex items-center gap-3">
                <span className="w-6" />
                <span className="w-20 text-xs text-slate-400">PID</span>
                <div className="flex-1 grid gap-1 text-xs text-slate-400" style={{gridTemplateColumns: '1fr 1.4fr 0.9fr'}}>
                  <span className="text-right">E (m)</span>
                  <span className="text-right">N (m)</span>
                  <span className="text-right">H (m)</span>
                </div>
                <span className="w-5" />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Einstellungen */}
      {showSettings && session && (
        <SettingsPanel session={session} onClose={() => setShowSettings(false)} />
      )}

      {/* Löschen-Dialog (einzeln) */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Punkt löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Punkt #{deleteId} wird dauerhaft gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Alle löschen */}
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
