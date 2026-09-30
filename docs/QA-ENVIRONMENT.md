# QA-Umgebung: Browser, Renderer, Messwerte

> Gepflegt vom Test-Agenten. Wird nach jedem Teilschritt aktualisiert (der Container kann neu starten).
> Rohdaten: `qa-output/gpu-probe/*.json` und `*.png` (gitignored). Werkzeuge: `scripts/qa/`.
> Stand: 2026-09-29.

## Kurzfassung

| Frage | Antwort |
|---|---|
| Läuft **WebGPU** in headless Chromium dieses Containers? | **Ja**, mit Flag-Set `WEBGPU` (unten): SwiftShader-Adapter, three r186 rendert sichtbar, Screenshots korrekt. |
| Läuft **WebGL2**? | Ja, ohne Flags (ANGLE → Vulkan → SwiftShader). Auch mit dem WebGPU-Flag-Set und `?renderer=webgl`. |
| Fallback WebGPU → WebGL2 prüfbar? | Ja: ohne Flags liefert `requestAdapter()` `null`, three wechselt automatisch auf WebGL2. |
| Tempo | Software-Rendering: erster Frame ~4,3–4,9 s, danach **~2 FPS** (1280×720, 96k Dreiecke, Schatten, Bloom). |
| Stolperfallen | ohne `--disable-blink-features=WebGPUExperimentalFeatures` wirft three r186 einen TypeError; `renderer.info.render.*` ist unter WebGPU 0; `drawImage(webgpuCanvas)` liefert leere Pixel. |

### Flag-Sets (in `playwright.config.ts` übernommen)

```text
WEBGPU  = --enable-unsafe-webgpu
          --disable-blink-features=WebGPUExperimentalFeatures
          --use-angle=swiftshader
          --enable-features=Vulkan,CDPScreenshotNewSurface
          --use-vulkan=swiftshader
WEBGL2  = (keine Flags) + URL-Parameter ?renderer=webgl
FALLBACK= (keine Flags), ohne ?renderer → WebGPU nicht verfügbar → automatische WebGL2-Wahl
```

`CDPScreenshotNewSurface` steht in `--enable-features`, weil Playwright dieses Feature selbst setzt und Chromium
bei doppeltem `--enable-features` nur das letzte Vorkommen auswertet (Nutzer-Flags hängt Playwright hinten an).

## Umgebung

- Container: 4 vCPU, 16 GB RAM, keine GPU, kein Swap.
- Node v22.22.2, @playwright/test 1.56.1, three 0.186.1, Vite 8.3.1.
- Chromium 141.0.7390.37 (Playwright-Revision 1194), kein `playwright install` nötig:
  - voll: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (Symlink `/opt/pw-browsers/chromium`) —
    von Playwright mit `--headless` (= neuer Headless-Modus) gestartet
  - Headless-Shell: `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`
  - mitgeliefert: `libvk_swiftshader.so`, `vk_swiftshader_icd.json`, ANGLE (`libEGL.so`, `libGLESv2.so`)
- `xvfb-run` / `Xvfb` vorhanden (Headed-Läufe möglich, bringen für WebGPU aber nichts, siehe unten).

## Messwerte (three r186, `scripts/qa/probe/index.html`)

Szene: 96k Dreiecke, 117 Drawcalls (WebGL-Zählung), TSL-NodeMaterials, PCF-Schatten 2048², RenderPipeline mit
Bloom, ACES-Tonemapping, Pixelratio 1. „Frame“ = `render()` + Warten auf GPU-Abschluss (WebGPU:
`queue.onSubmittedWorkDone()`, WebGL: `readPixels(1×1)`), „rAF“ = Median der Intervalle in einem 3-s-rAF-Loop.
Drei unabhängige Läufe (`phase-b-skia-vk-readpixels.json`, `phase-b-rep1.json`, `phase-b-rep2.json`),
Binary: volles Chromium, headless.

| Flags | Backend | Init | erster Frame | Frame (Median) | rAF (Median) |
|---|---|---|---|---|---|
| `WEBGPU`, auto | **webgpu** | 23–25 ms | 4,25–4,43 s | 486–516 ms | 474–489 ms |
| `WEBGPU`, `?renderer=webgl` | webgl2 | 18–22 ms | 4,86–4,95 s | 31–34 ms | 503–515 ms |
| keine, auto (Fallback) | webgl2 | 34–44 ms | 4,43–4,70 s | 33–34 ms | 502–572 ms |
| keine, `?renderer=webgl` | webgl2 | 17–20 ms | 4,56–4,60 s | 32–33 ms | 501–529 ms |

Lastvarianten (Einzelläufe, Flag-Set `WEBGPU`):

| Variante | WebGPU Frame / rAF | WebGL2 Frame / rAF |
|---|---|---|
| 1280×720 ohne Bloom und ohne Schatten | 291 ms / 283 ms | 21 ms / 279 ms |
| 640×360 mit Bloom und Schatten | 205 ms / 197 ms | 11 ms / 195 ms |

Headless-Shell (`chromium_headless_shell`) mit `WEBGPU`: webgpu erster Frame 4,3–4,5 s, rAF 453–477 ms; webgl2
rAF 19–23 ms (dieser Lauf noch mit `gl.finish()`-Synchronisation, daher nicht direkt vergleichbar).

Deutung:
- In beiden Backends liegt der Spiel-Loop bei **~2 FPS**. Die reine WebGL-Rasterzeit ist kurz (~33 ms); das
  rAF-Intervall wird von Compositing/Präsentation über SwiftShader bestimmt. Bei WebGPU dominiert die Rasterzeit.
- Pixelzahl und Post-Processing wirken fast linear: 640×360 oder ohne Bloom/Schatten ≈ 0,2–0,28 s pro Frame.
  E2E-Tests sollten deshalb `?quality=low` verwenden (sofern „low“ Pixelratio, Schatten und Bloom reduziert).
- Screenshot-Helligkeit (Mittelwert Luma 68–69, 89–96 Farb-Buckets) ist in allen Modi gleich → dieselbe
  Szene wird tatsächlich gerendert.
- **Korrektur früherer Werte:** Der erste Lauf maß „erster Frame ~1,5 s, rAF ~4,2 s“. Das war ein Messfehler:
  `gl.finish()` blockiert in Chromium/ANGLE/SwiftShader nicht bis zum Raster-Ende (gemessen 0,1 ms). So lagen
  ~45 unfertige Frames im rAF-Messfenster. Seit dem Umstieg auf `readPixels` sind die Werte reproduzierbar.

## Analyse des WebGPU-Device-Lost (warum die Flags nötig sind)

1. **Ohne Flags:** `navigator.gpu` existiert, `requestAdapter()` → `null`. three `WebGPURenderer` fällt korrekt
   auf WebGL2 zurück (`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`).
2. **`--enable-unsafe-webgpu`:** SwiftShader-Fallback-Adapter (`vendor=google`, `architecture=swiftshader`,
   `isFallbackAdapter=true`). Gleiches Ergebnis in allen 22 Flag-Kombinationen von Phase A, in beiden Binaries.
3. **three r186 + Chromium 141:** `--enable-unsafe-webgpu` schaltet die Blink-`WebGPUExperimentalFeatures` ein.
   Dann erwartet `GPUTextureViewDescriptor.swizzle` ein Dictionary, three übergibt `'rgba'` → `TypeError: Failed to
   read the 'swizzle' property ... not of type 'GPUTextureComponentSwizzle'`. Gegenmittel:
   `--disable-blink-features=WebGPUExperimentalFeatures` (zuletzt verifiziert mit Flag-Set `webgpu-skia-vk-ss+exp`).
4. **Device-Lost beim ersten Frame** (`A valid external Instance reference no longer exists`): Die
   Roh-WebGPU-Probe (`scripts/qa/probe/raw.html`, ohne three.js) zeigt, dass Offscreen-Rendering +
   `copyTextureToBuffer`/`mapAsync` fehlerfrei läuft (korrekte Pixel). Nur der **Canvas-Pfad** scheitert. Im
   Chromium-stderr (GPU-Prozess, `scripts/qa/_rawcdp.mjs`) steht:
   `shared_image_factory.cc:900 Could not find SharedImageBackingFactory with params: usage: RasterRead|DisplayRead|WebgpuRead|WebgpuSwapChainTexture|RasterWrite|WebgpuWrite, format: BGRA_8888`
   → `SharedImageStub: Unable to create shared image` → Wire-Client getrennt → Device-Lost.
   Ursache: `chrome://gpu` meldet „**Compositing: Software only**“, weil SwiftShader als Software-GPU gilt. Ohne
   GPU-Compositing gibt es keine Backing-Factory, die WebGPU-Schreiben und Display-Lesen verbindet.
5. **Lösung:** Skia-Compositing auf Vulkan (SwiftShader) über `--enable-features=Vulkan --use-vulkan=swiftshader`,
   **zusammen mit** `--use-angle=swiftshader`. Damit steht `ExternalVkImageBackingFactory` bereit. Die Roh-Probe
   zeigt Dreieck (`[26,204,76]`) und Clear-Farbe (`[128,0,0]`) korrekt im Playwright-Screenshot, und three r186
   rendert die volle Probe-Szene. Ablation (je ein Flag entfernt): ohne `--use-angle=swiftshader` oder ohne
   `--use-vulkan=swiftshader` → wieder Device-Lost. `--ignore-gpu-blocklist` und `--enable-unsafe-swiftshader`
   sind **nicht** nötig.

### Nicht erfolgreich (Device-Lost oder unsichtbares Canvas)

| Versuch | Ergebnis |
|---|---|
| `--enable-features=Vulkan --use-vulkan=swiftshader` ohne `--use-angle=swiftshader` | Device-Lost (SharedImage-Fehler) |
| `--use-webgpu-adapter=swiftshader` (allein oder mit Vulkan) | Device-Lost |
| `--use-angle=vulkan` (+ `VulkanFromANGLE`, `DefaultANGLEVulkan`) | kein Adapter bzw. Device-Lost |
| `--use-gl=angle --use-angle=swiftshader-webgl` | Device-Lost |
| `--ignore-gpu-blocklist --enable-unsafe-swiftshader --use-angle=swiftshader` (GL-Compositing „Hardware accelerated“) | Device-Lost |
| `--disable-gpu-compositing`, `--in-process-gpu`, `--use-gpu-in-tests` | Device-Lost |
| `--enable-skia-graphite --skia-graphite-backend=dawn-swiftshader` bzw. `dawn-vulkan` | kein Lost, aber Canvas bleibt transparent |
| `--enable-features=SkiaGraphite` (ohne Backend-Switch) | Device-Lost |
| Headed unter `xvfb-run`, nur `--enable-unsafe-webgpu` | kein Lost, aber Canvas im Screenshot unsichtbar |
| `requestAdapter({ forceFallbackAdapter: true })` / `powerPreference: 'low-power'|'high-performance'` (`raw.html?fallback=1`, `pp=low|high`) | ohne Einfluss: mit nur `--enable-unsafe-webgpu` in allen 4 Varianten Device-Lost, mit `WEBGPU` in allen 4 Varianten korrektes Bild |

## Konsequenzen für die Tests

- Projekt `webgpu` (Flags `WEBGPU`, ohne `?renderer`): prüft `rendererInfo().backend === 'webgpu'` hart.
- Projekt `webgl2` (keine Flags, `?renderer=webgl`): prüft `backend === 'webgl2'`.
- Fallback-Kette: Test ohne Flags und ohne `?renderer` erwartet `backend === 'webgl2'` und keine Fehlermeldung als
  Sackgasse (Anforderung „WebGPU zuerst, WebGL2 robuster Fallback“).
- Timeouts: Boot + erster Frame 5–15 s; jede Interaktion wartet auf `waitIdle()`. Test-Timeout 10 min, bei
  Komplett-Durchläufen bis 30 min.
- `rendererInfo().drawCalls/triangles` nur unter WebGL2 hart prüfen (unter WebGPU liefert three r186 mit
  RenderPipeline in `renderer.info.render` 0).
- Pixelprüfungen nur über Playwright-Screenshots, nie über `drawImage`/`toDataURL` des WebGPU-Canvas.

## Werkzeuge

| Datei | Zweck |
|---|---|
| `scripts/qa/gpu-probe.mjs` | Flag-Matrix; Phase A = Erkennung, Phase B = Rendering-Messung mit Screenshot-Statistik (`--only=`, `--modes=`, `--tag=`) |
| `scripts/qa/probe/index.html` + `probe.ts` | three-r186-Probe-Szene (WebGPURenderer, TSL, Schatten, Bloom), Parameter siehe Kopfkommentar |
| `scripts/qa/probe/raw.html` + `raw.ts` | Roh-WebGPU ohne three.js: Adapter → Device → Offscreen-Readback → Canvas |
| `scripts/qa/_one.mjs` | three-Probe einmal mit beliebigen Flags (`EXE=shell`, `HEADED=1`, `SHOT=<png>`) |
| `scripts/qa/_raw.mjs` | Roh-Probe über Playwright-Launcher |
| `scripts/qa/_rawcdp.mjs` | Roh-Probe mit selbst gestartetem Chromium (volles stderr-Log in `LOGFILE`, `SHOT=` mit Pixelprüfung) |
| `scripts/qa/_gpupage.mjs` | Text von `chrome://gpu` mit beliebigen Flags |

Beispiel: `node scripts/qa/gpu-probe.mjs --phase=b --only=webgpu-skia-vk-ss,none --modes=full-headless-new --tag=check`
(startet Vite auf 5199 selbst, falls nicht erreichbar).
