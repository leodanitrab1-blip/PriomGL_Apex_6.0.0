# Neural Tonemap — qué es y qué no es

## Qué es
Un MLP genuinamente pequeño (1 entrada → 12 → 12 → 1 salida, ~180 pesos)
entrenado **offline** con `python/train_neural_tonemap.py` usando solo
`numpy` (sin frameworks de ML, sin internet) para aproximar una curva de
tonemap filmico estilo ACES. Los pesos aprendidos se exportan como
constantes `float[]` y se evalúan **en vivo, por píxel, dentro del
fragment shader** (`neuralTonemapChannel` / `neuralTonemap` en
`js/renderer/shaders.js`) — es una red neuronal real participando en el
renderizado de cada frame, no una metáfora.

Para mantener el costo bajo, se evalúa **una vez por píxel sobre la
luminancia** (no 3 veces, una por canal) y el resultado reescala el color
original preservando el matiz — el mismo truco que usan los tonemaps
filmicos de producción para evitar además desplazamientos de color raros
en las luces altas.

## Por qué es opcional (`uUseNeuralTonemap`)
Probé la versión "siempre activa" en un Chromium real (headless,
WebGL2 por software) y confirmé que el costo extra por píxel —significativo
en un renderizador ya exigido por sombras, SSAO, niebla y PBR— podía volver
a introducir el mismo tipo de problema de rendimiento que costó varias
rondas resolver. En vez de ignorar esa señal, la función quedó gateada por
un uniform (`uUseNeuralTonemap`, igual para todos los píxeles de una misma
llamada de dibujo, así que la rama no cuesta nada extra):

- **Activada** en desktop y en tiers `high`/`ultra`.
- **Desactivada** (usa directamente la fórmula ACES de Narkowicz de la que
  la red fue entrenada a partir) en móvil y tiers `medium`/`low`/`potato` —
  que es exactamente el caso del dispositivo donde se reportaron los
  congelamientos originales.

`PriomEngine._initRenderer()` decide esto una sola vez al arrancar, según
`HardwareDNA`.

## Cómo re-entrenar
```bash
cd python
python3 train_neural_tonemap.py
```
Esto regenera `neural_tonemap_weights.json` y `neural_tonemap.glsl.txt`.
El segundo archivo se pega a mano dentro de la constante
`NEURAL_TONEMAP_GLSL` en `js/renderer/shaders.js` (no hay build step que lo
haga automático todavía — es la primera mejora obvia si esto se vuelve a
tocar).

## Limitaciones honestas
- El ajuste (MAE ~0.048 contra la curva ACES de referencia) no es un match
  perfecto; el resultado es una curva más contrastada que ACES puro, no una
  réplica exacta. Visualmente se lee como "filmico con más carácter", pero
  no es la intención original de ACES al pie de la letra.
- Es una red diminuta a propósito (un solo escalar de entrada: la
  luminancia). No hay pretensión de que esto sea "renderizado neuronal" al
  estilo de un denoiser o un upsampler de producción — es, literalmente,
  una curva de tonemap aprendida en vez de escrita a mano.
