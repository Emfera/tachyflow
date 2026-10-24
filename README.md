# tachyflow

**Web-UI für tachylog – Echtzeit-Feldkontrolle für Leica Flexline Totalstationen**

> [!NOTE]
> **Status: Proof of Concept – wird nicht weiterentwickelt** (Stand Oktober 2026)
>
> tachyflow war ein Vorläufer von **[OASP](https://github.com/Emfera/OASP)** (Open Archaeological Surveying Pipeline) und bleibt als Dokumentation der Versuche öffentlich. Der Code funktioniert wie beschrieben, wird aber nicht mehr gepflegt. Weiterentwickelt wird in [Emfera/OASP](https://github.com/Emfera/OASP); Experimente und Stand: [emfera.github.io/OASP](https://emfera.github.io/OASP/).

## Einordnung

Web-Oberfläche zu [tachylog](https://github.com/Emfera/tachylog): ein Node/Express-Server mit React-Frontend, der auf dem Handy unter Termux läuft und Messungen live als Karte und Punktliste zeigt. Getestet wurde die Bedienlogik im Stil von Emlid Flow.

**In OASP übernommen:**
- Layout nach Emlid Flow: Karte oben, Karte des letzten Punkts, Punktliste mit Zeit.
- GSI-Auswertung der Einheitenziffer und Reihenfolge der Wörter 81/82/83 vor 21/22/31.
- Sitzung mit EPSG-Code als Metadatum.

**Bewusst nicht übernommen:**
- Server auf dem Handy (Node, SQLite/sql.js, Build unter Termux): OASP läuft als reine Browser-App ohne Server.
- Abhängigkeit von tachylog und der Bridge-App.

**Bekannter Fehler, nicht mehr behoben:** Die EPSG-Codes sind in Code und Doku falsch beschriftet („31256 = M31, 31255 = M28, 31257 = M34“). Richtig ist: **31254 = GK M28, 31255 = GK M31, 31256 = GK M34** (31257–31259 sind die BMN-Varianten mit anderem Rechtswert-Offset). Der Standardwert 31256 ist also M34 (Ostösterreich), nicht M31. Da nur das Metadatum betroffen ist, nicht die Koordinaten, stimmen bestehende Messdaten; die EPSG-Angabe in alten Exporten bitte prüfen.

---

## Aufbau

- `server/` – Express-Server, liest die tachylog-Ausgabe (`collector.ts`) und speichert in SQLite über sql.js (`storage.ts`)
- `client/` – React-Oberfläche (Vite, Tailwind, shadcn/ui), Seite `Dashboard.tsx`
- `shared/` – gemeinsames Datenschema

Start (wie zuletzt getestet, Node unter Termux oder Desktop):

```bash
npm install
npm run build
npm start
```

Gestartet wurde es meist über `start.sh` bzw. `tachyflow-only.sh` aus dem [tachylog](https://github.com/Emfera/tachylog)-Repository.
