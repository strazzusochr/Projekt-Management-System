# QA-Plan „Riverbound“

> Gepflegt vom Test-Agenten. Grundlage: docs/REQUIREMENTS.md (Anforderungen), docs/QA-CONTRACT.md (Schnittstelle),
> docs/QA-ENVIRONMENT.md (Browser/Renderer/Messwerte). Status wird nach jedem Teilschritt aktualisiert.

## Status (Phase 1)

| Baustein | Stand |
|---|---|
| GPU-/Renderer-Probe | fertig, siehe QA-ENVIRONMENT.md (WebGPU läuft headless mit Flag-Set `WEBGPU`) |
| Orakel `tests/oracle/` + `tests/unit/oracle.test.ts` | fertig, 28 Tests grün (2 Läufe) |
| Gegenprobe Orakel ↔ Engine `tests/unit/oracle-crosscheck.test.ts` | fertig, 5/5 grün (2 Läufe) |
| `playwright.config.ts`, E2E-Helfer, E2E-Specs | in Arbeit |

## Orakel (unabhängige Löser)

Eigene Implementierung (Dijkstra nach Kosten, dann Fahrten) ohne Imports aus `src/`, Regeln wörtlich aus dem
Auftrag. Zustand = Figurenseiten × Bootseite (2^(n+1) Konfigurationen). „Verboten“ = mindestens ein Ufer verletzt
eine Regel. „Erreichbar“ = vom Start über regelkonforme Überfahrten (ohne Zeitlimit).

| Level | Optimum | Fahrten | optimale Lösungen | Zustände | gültig | verboten | erreichbar |
|---|---|---|---|---|---|---|---|
| L1 forest – Wolf/Ziege/Kohl, Hüterin einzige Pilotin, 1 Passagier | 7 | 7 | 2 | 32 | 20 | 12 | 10 |
| L2 temple – 3 Wächter + 3 Chaoswesen, Boot 1–2 | 11 | 11 | 8100 | 128 | 68 | 60 | 64 |
| L3 neon – 1/2/5/8 Min, max. 2, Limit 15 | **15 Min** | 5 | 2 | 32 | 32 | 0 | 30 (26 im Limit) |
| L4 harbor – 3 Paare, Ufer **und** Boot | 11 | 11 | 486 | 128 | 44 | 84 | 40 |
| L4 Variante nur Ufer | 11 | 11 | 486 | 128 | 44 | 84 | 40 |
| L5 ice – 2×100 kg, 2×50 kg, ≤100 kg, ≤3 Figuren, + Hund 25 kg (steuert nicht) | 11 | 11 | 96 | 64 | 64 | 0 | 60 |
| L5 Variante ohne Hund | 9 | 9 | 8 | 32 | 32 | 0 | 30 |

Beispiel-Sequenzen (vollständig in `qa-output/oracle/summary.txt`):
- L1: [H+Ziege]→ [H]← [H+Wolf]→ [H+Ziege]← [H+Kohl]→ [H]← [H+Ziege]→
- L3: [A+B]→2 [A]←1 [C+D]→8 [B]←2 [A+B]→2 = 15 Min
- L5 mit Hund: … 9 Fahrten wie ohne Hund, dann [Kind]← [Kind+Hund]→ (75 kg)

Von Hand gegengeprüft: L1 (6 verbotene Figurenmasken × 2 Bootseiten = 12; Zustandsgraph 10 Knoten/10 Kanten,
2 optimale Wege), L2 (34 gültige Masken × 2 = 68; unerreichbar sind nur 4: alle links/Boot rechts, alle
rechts/Boot links, 3 Chaos rechts/Boot links, 3 Wächter rechts/Boot rechts), L4 (gültige Masken 8 + 8 + 3 + 3 = 22).

**Befund L4:** Bei Bootskapazität 2 ist die Boot-Prüfung logisch redundant. Sitzen Companion *i* und ein fremder
Captain *j* im Boot, kann Captain *i* nicht dabei sein. Captain *i* steht dann entweder am Abfahrtsufer (dann war
der Ausgangszustand schon verboten) oder am Ankunftsufer fehlt er (dann ist der Folgezustand verboten). Beide
Varianten haben deshalb identische Zustandsräume. Für den Spieler ist die Boot-Erklärung trotzdem sinnvoll:
Sie greift schon beim Einsteigen, bevor eine Überfahrt versucht wird.

**Gegenprobe gegen die Engine** (`tests/unit/oracle-crosscheck.test.ts`): Für alle 5 Level stimmen überein:
Optimum, Fahrtenzahl, Anzahl optimaler Lösungen, Zustände gesamt/gültig/verboten/erreichbar und das Histogramm
„optimale Restkosten → Anzahl erreichbarer Zustände“. Das Histogramm ist unabhängig von der Benennung der Figuren
und würde falsch formulierte Regeln auch dann aufdecken, wenn das Optimum zufällig stimmt.
