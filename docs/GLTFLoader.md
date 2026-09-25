# GLTFLoader — modelos esculpidos reales dentro de PriomGL

## Qué es

Un parser de glTF 2.0 / GLB escrito desde cero (`js/loaders/GLTFLoader.js`)
contra las clases propias del motor (`Geometry`, `Material`, `Mesh`,
`Object3D`) — sin three.js, sin Babylon, sin ninguna librería externa,
respetando la regla original del proyecto. Es el puente real entre "todo
generado por matemática" y "assets esculpidos de verdad": modelos hechos en
Blender, o descargados de una fuente con licencia clara (Kenney.nl,
Quaternius, Poly Pizza, CC0 en Sketchfab), se cargan y renderizan con el
mismo shader PBR que ya usa el resto del motor.

Verificado de punta a punta con un archivo `.glb` real generado por
`make_test_glb.py` (un cubo con textura de tablero de ajedrez embebida) —
no es una demo simulada, es el parser binario real leyendo bytes reales.
Ver captura de evidencia en el historial de esta conversación.

## Cómo usar

```js
// Desde cualquier parte con acceso al engine (p.ej. la consola del navegador):
await engine.loadModel('models/mi_roca.glb', {
    position: [10, 0, 5],
    scale: 1.5,          // o [sx, sy, sz] para escala no uniforme
    rotationY: Math.PI/4 // radianes, opcional
});
```

1. Descarga un `.glb` de una fuente con licencia que te convenza (CC0 es lo
   más simple: sin atribución requerida).
2. Ponlo en la carpeta `models/`.
3. Llama a `engine.loadModel(...)`. Devuelve el nodo raíz cargado (o `null`
   si falló, con el error impreso en consola — nunca rompe el resto de la
   app).

## Qué soporta (v1)

- `.glb` binario (chunk JSON + chunk BIN) y `.gltf` + `.bin` separados.
- Jerarquía de nodos completa (posición/rotación/escala, o matriz 4×4
  descompuesta automáticamente).
- Atributos `POSITION`, `NORMAL`, `TEXCOORD_0`, `COLOR_0`, `TANGENT`.
  Si faltan `NORMAL` o `TANGENT` en el archivo, se calculan (normales desde
  las caras, tangentes desde las UV) — muchos exportadores simples omiten
  tangentes, así que esto importa en la práctica.
- Material PBR metalness-roughness: `baseColorFactor`/`baseColorTexture`,
  `metallicFactor`/`roughnessFactor`, `normalTexture`, `occlusionTexture`.
- Imágenes embebidas en el `.glb` (el caso más común) y también
  imágenes externas o en data-URI — la decodificación en sí la hace
  `createImageBitmap` del propio navegador (PNG/JPEG), no un decoder hecho
  a mano.

## Qué NO soporta todavía (honesto, no oculto)

- **Animación esquelética** (`skins`, `JOINTS_0`/`WEIGHTS_0`, `animations`).
  Un modelo con animación se carga en su pose de bind (estática) — no se
  mueve solo. Es el candidato obvio para una v2 si vas a usar personajes
  animados (por ejemplo, reemplazar la fauna procedural de `Wildlife.js`
  por modelos con animación de caminar/correr real).
- Morph targets (blend shapes).
- Extensiones `KHR_*` (compresión Draco, texture transform, etc.). Un
  archivo que dependa de Draco para su geometría no cargará — la mayoría de
  bancos de assets ofrecen también una versión sin comprimir.
- El canal de metalness-roughness combinado (`metallicRoughnessTexture`,
  que en el estándar empaqueta roughness en G y metalness en B de una sola
  textura) se reutiliza tal cual como `roughnessMap` — el shader de este
  motor no separa canales todavía, así que el metalness de esa textura
  específica no se usa (sí se sigue usando `metallicFactor` como escalar).

## Por qué no descargué modelos yo mismo

Esta sesión no tiene acceso a internet (herramienta de red deshabilitada),
así que no pude bajar un asset real para probar. Además, aunque pudiera,
la elección de qué modelo usar y bajo qué licencia es tuya — yo no puedo
verificar por ti que un asset "gratis" en algún sitio realmente tenga los
derechos que dice tener. Por eso el archivo de prueba (`models/test_cube.glb`)
lo generé yo mismo desde cero con un script de Python (sin descargar nada),
solo para poder probar el parser de punta a punta.

## Siguiente paso natural

Si me compartes o me dices qué modelos específicos quieres usar (animales,
árboles, rocas), puedo:
1. Ajustar el loader para lo que ese modelo en particular necesite (por
   ejemplo, animación esquelética si el modelo la trae).
2. Escribir el código que reemplaza la generación procedural actual
   (`Wildlife.js`, `Terrain.buildTreeGeometryMerged`) por instancias de esos
   modelos cargados, incluyendo LOD y culling para que no cueste más
   rendimiento que el sistema procedural actual.
