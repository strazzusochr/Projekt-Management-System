# Projektanforderungen (Originalauftrag, verbindlich)

> Dieses Dokument enthält den vollständigen Originalauftrag. Es ist die verbindliche Quelle für
> Planung, Implementierung und Abnahme. Nichts davon darf "vereinfacht" werden, ohne es im
> Abschlussbericht als Einschränkung zu dokumentieren.

Dein Ziel ist NICHT, eine Idee, einen Prototypen oder eine Demo zu erklären.
Das Ziel ist, eine tatsächlich spielbare, hochwertige browserbasierte 3D-Puzzle-Spielwelt zu bauen, zu testen, visuell zu kontrollieren und iterativ zu perfektionieren.
Arbeite wie ein kleines professionelles Game-Studio. Nicht nach der ersten funktionierenden Version zufrieden geben.

## project_goal

Baue ein echtes 3D-Rätselspiel auf Basis der Familie der klassischen Flussüberquerungsrätsel.
Das Spiel muss sich wie ein eigenständiges kleines hochwertiges 3D-Spiel anfühlen und nicht wie eine technische Three.js-Demo.

Mindestumfang:
* mindestens 5 vollständig ausgearbeitete Welten/Level
* jede Welt besitzt ein vollkommen anderes Art- und Environment-Design
* jede Welt besitzt einen eigenen visuellen Charakter
* jede Welt besitzt andere Rätselmechaniken bzw. andere Regelstrukturen
* jede Welt besitzt eigene Figuren
* insgesamt deutlich mehr Figuren als nur die klassischen drei Rätselobjekte
* echte 3D-Geometrie, echte Beleuchtung, echte Materialien
* animierte Figuren, animierte Umgebung
* animiertes Wasser bzw. passende Flüssigkeits-/Umwelteffekte
* Partikel, atmosphärische Effekte, Kamerafahrten
* hochwertiges UI
* komplett mit der Maus spielbar
* Rätsel müssen logisch korrekt und tatsächlich lösbar sein
* der Spieler muss unmittelbar verstehen können, was er tun darf
* Hinweise müssen aus der tatsächlichen Rätsellogik entstehen
* keine fest verdrahteten Fake-Lösungen
* Fortschritt muss gespeichert werden

## important_quality_rule

"AAA" bedeutet: innerhalb der technisch sinnvollen Grenzen eines Browser-3D-Spiels sichtbar hochwertig, detailliert, atmosphärisch, konsistent und professionell.
Keine grauen Platzhalter. Keine einfachen Würfel als Figuren. Keine flachen 2D-Karten, die nur so tun als seien sie 3D.
Keine generische Standard-Three.js-Szene. Keine fünf fast identischen Level. Keine UI-Template-Optik.
Keine lieblosen Primitive als Endzustand. Primitive/prozedurale Geometrie darf für Details verwendet werden, aber das Endergebnis muss bewusst designed wirken.

Bevorzugt: TypeScript, Vite, aktuelle stabile three.js-Version, WebGPU als bevorzugter Renderer, WebGL2-Fallback,
glTF 2.0 für 3D-Assets, Draco/KTX2/Meshopt wenn sinnvoll, moderne three.js Material-/Node-/TSL-Techniken wo sie echten Vorteil liefern,
modulare Architektur, datengetriebene Leveldefinitionen, keine unnötigen Frameworks.
Aktuelle Bibliotheksversionen prüfen, keine veralteten APIs/Patterns.

WebGPU: zuerst versuchen; WebGL2 als robuster Fallback; bei fehlendem WebGPU keine Fehlermeldung als Sackgasse; Spiel muss trotzdem funktionieren. Architektur muss Renderer-Abstraktion berücksichtigen.

## asset_policy

Ausschließlich selbst erstellte/prozedurale Assets oder Assets mit eindeutig geklärter Lizenz (CC0 bevorzugt).
Keine ripped assets, keine Modelle aus kommerziellen Spielen, keine geschützten Franchise-Charaktere.
Externe Assets: Quelle und Lizenz im Projekt dokumentieren.

## Architektur (mindestens logisch getrennt)

App/Core, Renderer, Scene/World, Camera, Input, Characters, Boats/Vehicles, Puzzle Engine, Puzzle Solver,
Level Definitions, UI, Audio, Save/Progress, Effects, Asset Loading, Performance, QA/Test Utilities.
Leveldaten möglichst deklarativ. Neues Level später hinzufügbar ohne Puzzle-Engine umzuschreiben.

## core_gameplay

Vollständig mausbedienbar. Benötigt: Linksklick auf Figuren, Hover-Highlight, Drag & Drop oder klar verständliches Anklicken,
Figuren ins Boot/auf Plattform setzen, wieder herausnehmen, Boot starten, Zielufer auswählen, Kamera drehen/zoomen/verschieben,
UI bedienen, Hinweise öffnen, Rätsel zurücksetzen, letzten Zug rückgängig machen, Level verlassen, Level auswählen, Pause öffnen.
Tastatur optional, nie notwendig.

Feedback: hover → leichtes Highlight; click → Auswahlstatus; gültige Aktion → positive visuelle Rückmeldung;
ungültige Aktion → kurze klare Rückmeldung + Erklärung; erfolgreicher Transport → Animation + Sound + aktualisierter Zustand;
Level abgeschlossen → sichtbare Belohnungs-/Abschlussinszenierung.

## puzzle_engine

Generische Puzzle Engine. Jeder Zustand mathematisch/programmatisch repräsentierbar.
Sauber trennen: State, Action, Validity, Transition, Goal, Cost, Solver, Hint generation.
Echter Zustandsraum-Solver (BFS / Dijkstra / A* / exakte Suche). Solver kennt die tatsächliche Spielregel.
Niemals Lösung nur optisch vortäuschen oder ausschließlich als Hardcoded-Sequenz hinterlegen.
Beim Laden eines Levels prüfen: 1. Startzustand gültig? 2. Ziel definiert? 3. Mindestens eine Lösung? 4. Optimale Lösung nach Levelmetrik?
5. Anzahl Zustände? 6. Legale Aktionen? 7. Verbotene Zustände?
Nicht lösbares Level: als Fehler markieren, nicht als fertig akzeptieren.

## level_design

### LEVEL 1 – THE WHISPERING FOREST
Magischer, uralter Wald bei warmem Morgenlicht. Visuell: riesige uralte Bäume, moosige Felsen, Nebel über dem Fluss, Holzsteg,
kleine Wasserfälle, leuchtende Pilze, Pflanzenbewegung, Vögel, Glühwürmchen, dichtes Unterholz, handgebaute hölzerne Bootsanlegestellen,
warme Sonnenstrahlen durch die Baumkronen.
Figuren: junge Waldhüterin als Spielfigur, Wolf, Ziege, Kohlkopf, zusätzlicher Fuchs als NPC, mehrere kleine Waldtiere als Ambient Life,
mindestens eine beobachtende Waldfigur.
Rätsel: klassisches Wolf-Ziege-Kohl. Spielfigur steuert das Boot; max. eine zusätzliche Einheit; Wolf nicht unbeaufsichtigt mit Ziege;
Ziege nicht unbeaufsichtigt mit Kohl; Rückfahrten erlaubt. Engine bestimmt Mindestanzahl der Überfahrten selbst.
Spieler NICHT sofort mit der Lösung konfrontieren; er soll über Aktionen das System erkennen.

### LEVEL 2 – THE SUNKEN TEMPLE
Versunkene Tempelanlage in tropisch-grüner Schlucht bei Abenddämmerung. Visuell: gewaltige Steinruinen, Wasserbecken, Tempelstatuen,
Fackeln, Wasserfälle, hängende Brücken, Kletterpflanzen, farbige Kristalle, Nebel, schimmernde Partikel, riesige Fische unter Wasser,
entfernte Gewitterwolken.
Figuren: Tempelwächter, drei Wächter, drei Trickster-/Chaoswesen, Tempelgeist, mehrere kleine Tempelwesen.
Rätsel: mathematische Variante Missionare-und-Kannibalen – NICHT menschenfressend inszenieren, originale Fantasy-Interpretation.
Regel: sobald Wächter auf einem Ufer vorhanden sind, dürfen Chaoswesen sie dort nicht zahlenmäßig übertreffen.
Boot: max. zwei Figuren, darf nicht leer fahren. Validierung prüft beide Ufer gleichzeitig.

### LEVEL 3 – NEON RIVER / MIDNIGHT CIRCUIT
Futuristische Megacity bei Nacht, Fluss = beleuchteter Kanal. Boot ersetzt durch schwebende Transportplattform/Wartungs-Shuttle.
Visuell: Neonreklamen, holografische Anzeigen, reflektierende nasse Straßen, riesige Wolkenkratzer, Drohnen, fliegender Verkehr,
digitale Werbetafeln, animierte Maschinen, Regen, Pfützen, volumetrische Lichtstrahlen, bewegliche Skyline, große Brückenstruktur über dem Wasser.
Figuren: vier Courier-/Techniker-Figuren, jede mit eigener Kleidung, Geschwindigkeit, Animationen, Lichtakzent, Namen.
Rätsel: Bridge-and-Torch. A=1, B=2, C=5, D=8 Minuten. Limit 15 Minuten. Max. zwei Personen. Langsamere Person bestimmt Dauer.
Energie-/Lichtquelle muss korrekt transportiert werden. Metrik = Gesamtzeit, nicht Zuganzahl. UI zeigt Zeit-/Energieanzeige.
Zeit läuft logisch entsprechend ausgeführter Aktionen. Zug nur akzeptiert wenn regelkonform.

### LEVEL 4 – THE CELESTIAL HARBOR
Fantasy-Hafen auf schwebenden Inseln über Wolkenmeer. Visuell: schwebende Felsen, riesige Luftschiffe, Wolkenmeer, goldene Tempelbauten,
Windsegel, Hängebrücken, Sonnenuntergang, gigantische Statue im Hintergrund, fliegende Vögel, kleine Luftschiffe, Wind-Partikel,
Lichtreflexe, leuchtende Hafenlaternen.
Figuren: drei Captain-/Companion-Paare, jede Figur mit Namen, eigenem Gesicht, Kleidung, Körperproportionen, Idle-Animation,
Reaktion auf gültige/ungültige Aktionen.
Rätsel: Jealous-Husbands-Variante als Fantasy-Regel: Eine Companion-Figur darf nicht gemeinsam mit einer fremden Captain-Figur
auf einem Ufer zurückbleiben, solange ihre eigene Captain-Figur nicht ebenfalls dort ist. Boot max. zwei Personen.
Formal prüfen, keine ungültigen Paarzustände. Spieler muss durch visuelles Feedback verstehen, warum eine Konstellation unzulässig ist.

### LEVEL 5 – AURORA ICEBOUND
Arktische Eiswelt unter detailliertem Polarlicht. Visuell: Eisberge, Gletscher, Risse im Eis, Schneestürme, Polarlicht, Eispartikel,
gefrorene Wasserflächen, Forschungscamp, beheizte Metallplattformen, kleine Forschungsdrohnen, Eishöhlen, Licht im Eis, Schneewehungen, entfernte Berge.
Figuren: zwei erwachsene Forscher, zwei Kinder, Forschungsdrohne, Polarhund, Lagerroboter, Expeditionsleiter als NPC.
Rätsel: gewichtsbasiert (historische Variante 2 Erwachsene + 2 Kinder). Erwachsener=100, Kind=50, Kapazität max. 100.
Alle vier Menschen dürfen steuern. Nicht die verbotenen Zustände von Level 1 kopieren; zentrale Schwierigkeit = Gewichtskapazität.
Engine berechnet minimale Lösung selbst. Gewichtsanzeige direkt am Boot/Transportmittel.

## minimum_character_quality

Jede zentrale Figur echte 3D-Figur. Keine Kapseln, keine einfachen geometrischen Menschen.
Mindestens: Kopf, Körper, Arme, Hände, Beine, Schuhe, Haare bzw. Kopfbedeckung, Kleidung, Accessoires.
Animationen je wichtiger Figur: Idle, Auswahlreaktion, Gehbewegung, Einsteigen, Aussteigen, Transportanimation, Erfolg, Fehlerreaktion.
Nebenfiguren einfacher, aber räumlich überzeugend.

## environment_detail

Jede Welt mindestens 20 deutlich erkennbare Environment-Details. Nicht leer. Foreground/Midground/Background-Tiefe.
LOD, Instancing, Geometrie-Wiederverwendung, Texture Compression, sinnvolle Shadow-Auflösung, Frustum Culling, Lazy Loading,
Asset Disposal, effiziente Partikelsysteme.

Wasser: nicht einfach eine blaue Ebene. Je nach Welt Wellen, transparente Oberfläche, Reflexion, leichte Brechung, Gischt,
Flussströmung, Partikel, Uferbewegung, unterschiedliche Wasserfarbe, Tiefenwirkung. Mit der Welt abgestimmt.

Licht je Welt: Key, Fill, Rim (sofern sinnvoll), Umgebungslicht, lokale Lichtquellen, dynamische Akzente, Schatten.
Zusätzlich: HDRI bzw. Environment Lighting, Tonemapping, Exposure Control, Ambient Occlusion o.ä., Bloom kontrolliert,
DOF nur mit Mehrwert, volumetrische Atmosphäre bzw. glaubwürdige Annäherung.

Kamera: stabil, gut lesbar. Intro-Shot bei Levelstart, sanfte Übergänge, Fokus auf ausgewählte Figuren, Fokus auf Boot,
Fokus auf Regelverletzungen, Abschlusskamera, Showcase-Kamera je Level. Spieler kann jederzeit Kontrolle zurückerlangen.
Keine erzwungenen langen Kamerafahrten während des Rätsels.

UI: nicht fünf identische Standard-Panels. Grundfunktionen: Levelname, Levelbeschreibung, Ziel, Zug-/Move-Counter,
optimale Zugzahl sobald sinnvoll, Zeit oder Energie bei entsprechenden Leveln, aktuelle Bootskapazität, aktuelle Belegung,
Hint, Undo, Reset, Pause, Audio, Grafikqualität, Fortschritt.
Hover über Figur: Name + relevante Eigenschaft. Ungültige Aktion: kontextbezogene Erklärung
(z.B. "Diese Konstellation ist nicht zulässig: Der Wolf würde die Ziege fressen."), nicht nur "ERROR".
Hinweise: nicht sofort komplette Lösung. Hint 1 allgemein, Hint 2 nächste sinnvolle Aktion, Hint 3 konkrete nächste Aktion.
Hinweise kommen aus dem Solver.
Levelauswahl: nicht fünf Buttons untereinander, z.B. 3D-Karte/Weltkarte/Reiseübersicht. Jede Welt: Miniaturansicht, Name,
Schwierigkeit, Fortschritt, beste bekannte Lösung, Abschlussstatus, visuelle Vorschau. Klarer Übergang beim Weltwechsel.
Speichern lokal: freigeschaltete Welten, abgeschlossene Levels, beste Ergebnisse, Einstellungen. Reload zerstört Fortschritt nicht.

Audio mindestens: Hintergrundmusik, Wasser-/Umgebungssound, Hover, Click, gültige Aktion, ungültige Aktion, Boot startet,
Boot kommt an, Erfolg, Levelabschluss, UI, Ambient Sounds. Nicht permanent alles übertönen.
Ohne externe Soundassets: Web-Audio-/prozedurale Sounds.

## visual_identity
L1 magisch, organisch, warm, naturverbunden. L2 mystisch, feucht, uralt, monumental. L3 technologisch, neon, urban, regennass.
L4 fantastisch, episch, hell, schwebend. L5 kalt, monumental, polar, wissenschaftlich.
Farben, Materialien, Architektur, Figuren, Licht, Partikel, Musik und UI müssen jeweils zusammenpassen.

## game_feel
Figuren schauen bei Auswahl zum Spieler; Tiere bewegen sich leicht; Wasser bewegt sich permanent; Vegetation reagiert auf Wind;
Lichter flackern subtil; UI animiert; Partikel bewegen sich; erfolgreiche Aktionen werden gefeiert; Fehler verständlich, nicht frustrierend;
Bootsbewegungen besitzen Gewicht und Verzögerung. Eindruck einer kleinen lebendigen Welt.

## Accessibility
Nicht ausschließlich über Farbe kommunizieren: Icons, Symbole, Text, Formunterschiede, Animation, Tooltips. Ausreichende Kontraste.
UI auch bei kleineren Bildschirmen sinnvoll. Desktop zuerst.

## Performance
Adaptive pixel ratio, Quality Presets (LOW/MEDIUM/HIGH/ULTRA), LOD, Instancing, Asset caching, lazy loading, compressed textures
sofern sinnvoll, effiziente Schatten, begrenzte Partikelanzahl, dispose()-Strategien, keine unnötigen Renderpasses, keine Memory Leaks.
ULTRA deutlich besser, LOW/MEDIUM spielbar. FPS-/Performance-Monitor nur im Debug-Modus.

## Testpflicht
Dev-Server starten, im Browser öffnen, jedes Level tatsächlich durchspielen. Mindestens testen: Levelstart, Kamerasteuerung, Auswahl,
Drag/Drop, Ein-/Aussteigen, Bootbewegung, Rückfahrt, ungültige Zustände, Reset, Undo, Hint, Levelabschluss, Speichern,
Browser-Reload, Wechsel zwischen Levels, unterschiedliche Bildschirmgrößen, WebGPU, WebGL2-Fallback.
Screenshots erzeugen und wie ein Art Director beurteilen: leere Flächen, flache Materialien, schlechte Beleuchtung, Clipping,
schwebende Objekte, falsche Schatten, unleserliches UI, zu kleine Figuren, repetitive Assets, schlechte Komposition,
unausgewogene Farbgebung, schwache Animationen, sichtbare Debug-Elemente, offensichtliche Placeholder. Danach verbessern.

## Loops
1 Projekt untersuchen/Architektur · 2 3D-Grundsystem (Renderer, Kamera, Lighting, Input, UI-Gerüst) · 3 Puzzle Engine + Solver + Tests ·
4 Level 1 · 5 Browser-Test/Screenshot/Fix · 6 Level 2 · 7 Test · 8 Level 3 · 9 Test · 10 Level 4 · 11 Test · 12 Level 5 · 13 Test ·
14 Gesamtes Spiel aus Nutzersicht · 15 Lösungen mathematisch neu validieren · 16 Performance messen · 17 Memory Leaks ·
18 UI/UX verbessern · 19 Audio prüfen · 20 visueller Gesamtvergleich · weitere Loops solange echte Mängel existieren.

## anti_shortcut_rules (verboten)
Fünf Level mit derselben Landschaft; fünf Rätsel mit derselben Regel; nur farbliche Änderungen; nur primitive Boxen als Figuren;
Fake-3D; Screenshot statt echter Interaktion; mathematisch falsche Regeln; Hardcoded-Solution-Animation; statische Hint-Antworten;
UI ohne Funktion; nicht funktionierende Buttons; "coming soon"; leere Spielwelt; Debug-Text im finalen UI;
Build als abgeschlossen deklarieren bevor der Browser-Test erfolgreich war.

## final_acceptance / completion_report
Fertig erst wenn: ≥5 spielbare Level, je eigene visuelle Welt, je eigene Puzzlelogik, Engine validiert alle Zustände,
Solver findet korrekte Lösungen, Maussteuerung vollständig, alle Hauptbuttons funktionieren, Save/Load funktioniert,
WebGPU/Fallback getestet, Browser-Test durchgeführt, visuelle QA durchgeführt, gravierende Fehler behoben, keine Placeholder.
Abschlussbericht: 1. implementierte Funktionen 2. Welten 3. Puzzle-Regeln 4. getestete Browser-/Renderer-Modi
5. gefundene und behobene Fehler 6. verbleibende bekannte Einschränkungen. Nichts als fertig behaupten, was nicht implementiert und getestet ist.
