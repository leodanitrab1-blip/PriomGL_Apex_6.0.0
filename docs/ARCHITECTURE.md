# PriomGL Polyglot Quantum — Arquitectura

## Lenguajes y roles

| Lenguaje | Rol | Ubicación | Cómo interactúa |
|----------|-----|-----------|-----------------|
| **JavaScript** | Host, WebGL2, ECS, loop, UI | `js/` | Orquesta todo. Ejecuta en el navegador. |
| **C++** | Kernels de alto rendimiento (ruido, culling, partículas) | `native/cpp/PriomKernels.hpp`, `native/cpp/priom_kernels.cpp` | API C-simple. Compilable a WASM real (`build_wasm.sh`); si no se compila, el Bridge usa un port JS idéntico. |
| **Python** | Reglas pre-computadas, LUTs, herramientas de generación | `python/generate_hw_luts.py` → `data/hw_luts.json` | Genera un JSON real que el Bridge **carga por fetch en runtime** (no solo un snippet embebido). |
| **Kotlin** | Política declarativa de calidad + guardia térmica | `kotlin/QualityPolicy.kt` | Espejo 1:1 mantenido en el Bridge (`KotlinPolicy`); su `thermalBias` afecta la calidad real cada frame. |
| **HTML/CSS** | Shell, HUD, loading | `index.html`, `css/` | Presentación. |

## Hardware DNA

Al arrancar, `HardwareProfiler` (JS puro):

1. Lee `navigator` (cores, deviceMemory, UA, touch).
2. Consulta WebGL (`WEBGL_debug_renderer_info`, límites, extensiones).
3. Clasifica GPU (Adreno / Mali / Apple / NVIDIA / AMD / Intel / software).
4. Ejecuta micro-benchmark (puntos + ruido CPU).
5. Produce un **score 0–100** y un **tier**: `potato | low | medium | high | ultra`.
6. Emite **recommendations** concretas (pixel ratio, presupuestos de árboles/rocas, SSAO, bloom, segmentos de terreno, target FPS).

Ese DNA es la lengua franca: el Engine, el Optimizer y el Bridge lo leen.

## Council (interacción innovadora)

Cada vez que el Optimizer aplica calidad (`PolyglotBridge.councilDecide`):

1. **JS** propone un valor reactivo (basado en FPS actual / carga).
2. **Python** aporta multiplicadores por tier y una curva de agresividad —
   leídos de `data/hw_luts.json` si el fetch tuvo éxito (`bridge.pythonLive === true`),
   o del espejo embebido si no.
3. **Kotlin** fusiona ambos votos, aplica sesgo térmico/móvil (`vote`) y además
   un **`thermalBias`** basado en cuántos segundos seguidos el frame estuvo
   sobre presupuesto (EMA calculada en el Bridge) — throttle *preventivo*
   antes de que el SO le baje el clock a la GPU por calor.
4. El resultado final ajusta entities, sombras, post y resolución.

No es un solo número: es un **voto multi-paradigma con estado real** (no solo
decorativo).

## Kernels nativos reales (opcional, con fallback automático)

- `native/cpp/priom_kernels.cpp` expone `fbm_noise2`, `ridged_noise2`,
  `frustum_cull_aabbs_ptr`, `integrate_particles_ptr`, etc. vía `extern "C"`.
- `native/cpp/build_wasm.sh` compila con Emscripten a
  `native/wasm/priom_kernels.wasm`.
- `PolyglotBridge.loadWasmKernels()` intenta cargar ese `.wasm` al arrancar.
  Si existe, el ruido de terreno pasa a ejecutarse en WASM real
  (`bridge.wasmLive === true`, se ve en consola: "⚙️ Kernels C++ (WASM) activos").
  Si no existe, el motor sigue funcionando exactamente igual con el port JS.

## Datos Python reales, no solo narrativa

- `python3 python/generate_hw_luts.py -o data/hw_luts.json` produce las tablas
  que el juego realmente usa: presupuestos por tier, curva de agresividad,
  splits prácticos de cascada de sombras por tier, curva de ráfagas de viento,
  y distancias de LOD por tier.
- `index.html` llama `bridge.loadPythonData()` en paralelo con
  `bridge.loadWasmKernels()` antes de crear el `PriomEngine`, así que las
  cascadas de sombra y el viento del primer frame ya usan los datos de Python
  cuando el servidor los sirve.

## Cero dependencias externas

- Sin npm, sin CDN, sin Three.js, sin Pyodide.
- Todo el runtime obligatorio es HTML + JS + WebGL2.
- C++ (WASM) y Python (JSON) son **aceleradores/datos opcionales reales**:
  si no se generan, el motor cae automáticamente al port/espejo JS
  correspondiente sin romperse.

## Deploy en Render

Opción A (recomendada): **Static Site** apuntando a la carpeta del proyecto
(ya incluye `data/hw_luts.json` pre-generado, listo para servir).

Opción B: servidor mínimo en Python stdlib:

```bash
cd PriomGL_Polyglot
python3 -m http.server 8080
```

O el script `python/serve.py`.

Para regenerar las tablas de Python tras editar `generate_hw_luts.py`:

```bash
python3 python/generate_hw_luts.py -o data/hw_luts.json
```

Para compilar los kernels C++ a WASM (opcional, requiere Emscripten):

```bash
native/cpp/build_wasm.sh
```

## Bug crítico corregido (picos/árboles rotos)

`instancedVS`/`shadowInstancedVS` asumían un layout de instancia (matriz 3×4
en 3 `vec4`) que **nadie llenaba** — `InstancedEntities.js` sube posición +
cuaternión + escala + color + fase como 5 atributos independientes. El shader
interpretaba esos bytes como una matriz de rotación arbitraria, deformando
cada árbol en un pico gigante. Ver `CHANGELOG.md` para el detalle.

## Roadmap natural

1. ~~Compilar `PriomKernels.hpp` a WASM y enlazarlo en el Bridge~~ — hecho,
   opcional vía `build_wasm.sh`.
2. Kotlin/JS real para compilar `QualityPolicy.kt` a un módulo cargable
   (hoy el espejo JS se mantiene manualmente en sincronía).
3. Worker Python (Pyodide o servidor) solo si se necesita generación online
   de mundos en vez de LUTs pre-horneadas.

