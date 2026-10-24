# tachyflow

**Web-UI für tachylog – Echtzeit-Feldkontrolle für Leica Flexline Totalstationen**

> [!NOTE]
> **Proof of Concept, wird nicht weiterentwickelt.** Weiterentwicklung in [Emfera/OASP](https://github.com/Emfera/OASP).

> [!WARNING]
> Die EPSG-Codes sind hier falsch beschriftet. Richtig: 31254 = GK M28, 31255 = GK M31, 31256 = GK M34. Der Standardwert 31256 ist also M34, nicht M31. Die Koordinaten sind nicht betroffen, nur die EPSG-Angabe in den Exporten.

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
