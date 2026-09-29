# QA-Vertrag zwischen Spielcode (`src/`) und Tests (`tests/e2e/`)

Dieser Vertrag ist verbindlich. Der Spielcode implementiert ihn, die E2E-Tests nutzen ausschließlich ihn
(plus echte Maus-/Tastatur-Events über Playwright). Tests dürfen **niemals** den Spielzustand direkt
manipulieren, um Züge auszuführen — Züge laufen immer über echte Mausklicks auf Canvas/UI.

## URL-Parameter

| Parameter | Wirkung |
|---|---|
| `?renderer=webgl` | erzwingt das WebGL2-Backend (`forceWebGL`), sonst WebGPU mit automatischem Fallback |
| `?quality=low\|medium\|high\|ultra` | überschreibt die gespeicherte Qualitätsstufe (nicht persistiert) |
| `?debug=1` | zeigt FPS-/Performance-Monitor (nur Debug) |
| `?qa=1` | aktiviert QA-Hilfsfunktionen (`unlockAll`, `resetProgress`), kürzt Intro-Kamerafahrten auf 0,3 s |
| `?level=<id>` | startet direkt in Level `<id>` (nur wenn freigeschaltet oder `qa=1`) |

Level-IDs: `forest`, `temple`, `neon`, `harbor`, `ice`.

## `window.__RIVERBOUND_QA__` (immer vorhanden, sobald die App gebootet hat)

```ts
interface ScreenPos { x: number; y: number; visible: boolean } // CSS-Pixel relativ zum Viewport

interface QaApi {
  version: 1;
  /** true, sobald der aktuelle Bildschirm interaktiv ist (keine Lade-/Übergangsphase). */
  isReady(): boolean;
  screen(): 'boot' | 'map' | 'level' | 'loading';
  rendererInfo(): { backend: 'webgpu' | 'webgl2'; quality: 'low' | 'medium' | 'high' | 'ultra'; fps: number; drawCalls: number; triangles: number; geometries: number; textures: number };
  levels(): Array<{ id: string; name: string; unlocked: boolean; completed: boolean; valid: boolean;
                     optimalCost: number; metric: 'crossings' | 'time'; bestCost: number | null }>;
  currentLevel(): null | {
    id: string;
    moves: number;              // Anzahl ausgeführter Überfahrten
    cost: number;               // Levelmetrik (Überfahrten bzw. Minuten)
    boatSide: 'left' | 'right';
    boatLoad: string[];         // IDs der aktuell im Boot sitzenden Figuren (vor Abfahrt)
    entities: Array<{ id: string; name: string; location: 'left' | 'right' | 'boat' }>;
    won: boolean;
    failed: boolean;            // z.B. Zeitlimit überschritten
    busy: boolean;              // Animation/Überfahrt läuft
  };
  /** Bildschirmposition des klickbaren Zentrums einer Figur. */
  entityScreenPos(id: string): ScreenPos | null;
  boatScreenPos(): ScreenPos | null;
  /** Bildschirmposition eines Punktes auf dem Ufer (zum Absetzen per Drag & Drop). */
  bankScreenPos(side: 'left' | 'right'): ScreenPos | null;
  /** Bildschirmposition einer Welt-Insel auf der 3D-Weltkarte. */
  mapNodeScreenPos(levelId: string): ScreenPos | null;
  /** Optimale Restlösung ab aktuellem Zustand, berechnet vom Engine-Solver. Jede Aktion = Liste der Figuren-IDs einer Überfahrt. */
  solveFromCurrent(): { actions: string[][]; cost: number } | null;
  /** Resolved, sobald keine Animation/Überfahrt/Kamerafahrt mehr läuft. */
  waitIdle(timeoutMs?: number): Promise<void>;
  /** nur mit ?qa=1 */
  unlockAll(): void;
  /** nur mit ?qa=1 – löscht gespeicherten Fortschritt */
  resetProgress(): void;
  /** gesammelte Laufzeitfehler (console.error / window.onerror) */
  errors(): string[];
}
```

## `data-testid`s im DOM

| testid | Element |
|---|---|
| `btn-sail` | Überfahrt starten |
| `btn-undo` / `btn-reset` / `btn-hint` / `btn-pause` | HUD-Aktionen |
| `hud-moves` / `hud-cost` / `hud-capacity` / `hud-time` | HUD-Anzeigen (`hud-time` nur in Zeit-Leveln) |
| `hint-panel` / `hint-text` / `btn-hint-more` | Hinweis-Panel, Text, nächste Hinweisstufe |
| `toast` | Rückmeldung (gültig/ungültig) – Attribut `data-kind="valid|invalid|info"` |
| `pause-menu` / `btn-resume` / `btn-restart` / `btn-to-map` / `btn-settings` | Pause-Menü |
| `settings-panel` / `select-quality` / `range-music` / `range-sfx` / `toggle-mute` / `btn-settings-close` | Einstellungen |
| `win-dialog` / `btn-next-level` / `btn-replay` / `btn-win-map` | Abschlussdialog |
| `map-card` / `btn-start-level` | Weltkarten-Infokarte / Reise starten |
| `btn-skip-intro` | Intro-Kamerafahrt überspringen |

## Interaktionsmodell (Maus)

* Hover über Figur → Highlight + Tooltip (Name + Eigenschaft).
* Linksklick auf Figur am Ufer (Bootsseite) → steigt ins Boot. Linksklick auf Figur im Boot → steigt aus.
* Drag & Drop: Figur auf Boot ziehen → einsteigen; aus dem Boot aufs Ufer ziehen → aussteigen.
* Linksklick auf Boot oder `btn-sail` → Überfahrt (wenn gültig), sonst Erklärung im `toast` (`data-kind="invalid"`).
* Linksziehen auf freier Fläche → Kamera drehen; Rechtsziehen → verschieben; Mausrad → Zoom.
