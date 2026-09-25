/**
 * PriomGL Engine v3 — Motor de Próxima Generación
 * Versión autónoma que no depende de global.PriomGL
 */
(function() {
    'use strict';

    // Import compartido de matemáticas para todos los métodos de esta clase.
    // (Antes varios métodos —_updateCamera, _updateCinematicCamera, etc.— usaban
    // Vec3/Quat como si fueran globales sin importarlos, lo que lanzaba
    // "Quat is not defined" en el primer frame y dejaba la pantalla en negro.)
    const { Vec3, Vec2, Quat, Mat4, Color, AABB } = window.PriomMath;

    // ============================================================
    // LOOP DE CATMULL-ROM
    // ============================================================
    function catmullRom(p0, p1, p2, p3, t) {
        const t2 = t * t, t3 = t2 * t;
        return {
            x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
            y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
            z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
        };
    }

    // ============================================================
    // CLASE PRINCIPAL DEL MOTOR
    // ============================================================
    class PriomEngine {
        constructor(canvas, config = {}) {
            console.log('🚀 Inicializando PriomEngine Polyglot...');

            // === VERIFICAR DEPENDENCIAS ===
            if (typeof window.PriomGL === 'undefined') {
                console.error('PriomGL no está definido. Verifica que math.js y webgl.js se cargaron.');
                throw new Error('PriomGL no está definido');
            }

            // === HARDWARE DNA + POLYGLOT ===
            this.hardwareDNA = config.hardwareDNA || null;
            this.polyglot = config.polyglot || null;
            const rec = (this.hardwareDNA && this.hardwareDNA.recommendations) || {};

            // === CANVAS Y RENDERIZADOR ===
            this.canvas = canvas;
            this.isMobile = (this.hardwareDNA && this.hardwareDNA.platform)
                ? this.hardwareDNA.platform.isMobile
                : (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                   (navigator.maxTouchPoints > 1));

            // Obtener referencias
            const PriomRenderer = window.PriomGL.PriomRenderer;
            const Scene = window.PriomGL.Scene;
            const PerspectiveCamera = window.PriomGL.PerspectiveCamera;
            const Mesh = window.PriomGL.Mesh;
            const Material = window.PriomGL.Material;
            const Primitives = window.PriomGL.Primitives;
            const Color = window.PriomMath.Color;
            const Vec3 = window.PriomMath.Vec3;
            const Quat = window.PriomMath.Quat;
            const TerrainGenerator = window.PriomGL.TerrainGenerator;
            const Vegetation = window.PriomGL.Vegetation;
            const PhysicsWorld = window.PriomGL.PhysicsWorld;
            const RigidBody = window.PriomGL.RigidBody;
            const ParticleEmitter = window.PriomGL.ParticleEmitter;
            const ParticleSystem = window.PriomGL.ParticleSystem;
            const WorldAI = window.PriomGL.WorldAI;
            const OptimizerAI = window.PriomGL.OptimizerAI;
            const MetaOptimizerAI = window.PriomGL.MetaOptimizerAI;
            const ChunkedForest = window.PriomGL.ChunkedForest;
            const MaterialLibrary = window.PriomGL.MaterialLibrary;
            const WildlifeRenderer = window.PriomGL.WildlifeRenderer;
            const GeometryMerger = window.PriomGL.GeometryMerger;

            // === CREAR RENDERIZADOR (ajustado por HardwareDNA) ===
            try {
                const maxPR = rec.maxPixelRatio != null
                    ? rec.maxPixelRatio
                    : (this.isMobile ? 1.15 : 1.75);
                this._hwRec = rec;
                const preferWebGPU = config.preferWebGPU !== false && !!navigator.gpu && window.PriomGL.WebGPURenderer;
                this.renderer = preferWebGPU
                    ? new window.PriomGL.WebGPURenderer(canvas, { maxPixelRatio: Math.min(maxPR, this.isMobile ? 1.0 : 1.25), exposure: 1.25, mobile: this.isMobile, tier: (this.hardwareDNA && this.hardwareDNA.tier) || 'unknown' })
                    : new PriomRenderer(canvas, { maxPixelRatio: maxPR, exposure: 1.35 });
                this._fallbackMaxPR = maxPR;
                this.rendererStatus = preferWebGPU ? 'WebGPU iniciando…' : 'WebGL2';
                if (this.renderer.isWebGPU) {
                    this.renderer.readyPromise.then((ok) => {
                        if (!ok && !this.renderer._fallbackInstalled) {
                            this._installWebGL2Fallback('WebGPU no pudo inicializar: ' + (this.renderer.failureReason || 'motivo desconocido'));
                        }
                    });
                    console.log('⚡ WebGPU seleccionado; fallback WebGL2 disponible mediante preferWebGPU:false');
                    this.renderer.readyPromise.then((ok) => {
                        if (ok) this.rendererStatus = 'WebGPU activo';
                    });
                }
                if (rec.ssao === false) this.renderer.ssaoEnabled = false;
                if (rec.bloom === false) this.renderer.bloomEnabled = false;
                // Neural tonemap (see CHANGELOG v9 / docs/NeuralTonemap.md):
                // only worth its ~60 extra FMAs/pixel on hardware with
                // headroom to spare. Confirmed via live headless-browser
                // testing that the always-on version was heavy enough to
                // stall rendering — gating it by tier keeps the visual
                // upgrade without reintroducing the performance problems
                // fixed in earlier rounds. Desktop is never mobile-tight on
                // fragment ALU the way a phone GPU is, so treat it as
                // effectively "high" for this one decision regardless of
                // the measured tier.
                const tier = this.hardwareDNA && this.hardwareDNA.tier;
                const goodTier = tier === 'high' || tier === 'ultra' || !this.isMobile;
                this.renderer.useNeuralTonemap = !!goodTier;
                console.log('✅ Renderizador creado · PR max=', maxPR, '· tier=', tier,
                    '· neural tonemap=', this.renderer.useNeuralTonemap);
            } catch (e) {
                console.error('Error al crear renderizador:', e);
                throw e;
            }

            // === CREAR ESCENA Y CÁMARA ===
            this.scene = new Scene();
            this.camera = new PerspectiveCamera(this.isMobile ? 68 : 60, 1, 0.25, 1400);
            this.camera.position.set(0, 16, 38);
            this.camera.lookAt(new Vec3(0, 4, 0));

            // Cascade split distances: the renderer always allocates 4
            // shadow FBOs and dynamically shows fewer of them under load
            // (see _renderShadows' activeCascades), so we don't touch the
            // *count* here — only the practical-split *distances*, which
            // Python computes per hardware tier (data/hw_luts.json). If
            // that tier has fewer than 4 published splits (weak GPUs get
            // a coarser table), the array is padded by repeating the
            // farthest split so the renderer's fixed 4-cascade loop always
            // has 4 valid numbers to read. Kotlin's maxCascadesForTier is
            // only consulted as a sanity fallback when Python data never
            // loaded (offline/file://).
            if (this.polyglot && this.hardwareDNA) {
                const tier = this.hardwareDNA.tier;
                const py = this.polyglot.python;
                let splits = py.shadowCascadeSplits && py.shadowCascadeSplits[tier];
                if (splits && splits.length) {
                    splits = splits.slice();
                    // Extrapolate rather than repeat the last value: two
                    // cascades that share an identical far plane become
                    // perfect geometric duplicates (same light-space box,
                    // same projection) — wasted GPU work, and depending on
                    // which one the shading pass samples it can pick the
                    // coarser of the pair for near geometry. Growing each
                    // extra slot by 40% keeps every cascade meaningfully
                    // different in size.
                    while (splits.length < 4) splits.push(splits[splits.length - 1] * 1.4);
                    this.scene.sun.cascadeSplits = splits.slice(0, 4);
                    console.log('☀️ Cascadas de sombra (Python live):', this.scene.sun.cascadeSplits);
                } else {
                    console.log('☀️ Cascadas de sombra por defecto (Kotlin max=' +
                        this.polyglot.kotlin.maxCascadesForTier(tier) + ')');
                }
            }
            console.log('✅ Escena y cámara creadas');

            // === RELOJ Y ESTADÍSTICAS ===
            this.clock = { start: performance.now(), elapsed: 0, delta: 0, last: performance.now() };
            this.running = false;
            this.stats = { fps: 60, frames: 0, lastFpsUpdate: 0 };

            // === ENTRADA ===
            this.keys = {};
            this.mouse = { x: 0, y: 0, dx: 0, dy: 0, locked: false };
            this.yaw = 0.15;
            this.pitch = -0.28;
            this.moveSpeed = this.isMobile ? 16 : 24;
            this.touch = {
                leftId: null, rightId: null,
                leftStart: { x: 0, y: 0 }, leftCurr: { x: 0, y: 0 },
                rightStart: { x: 0, y: 0 }, rightCurr: { x: 0, y: 0 },
                lookSens: 0.0045
            };

            // === VARIABLES INTERNAS ===
            this._aiShadowScale = 1;
            this._aiParticleScale = 1;
            this._aiEntityScale = 1;
            this.cinematic = { active: false, u: 0, waypoints: null, speed: 0.14 };
            this._allForests = [];
            this._joyKnob = null;
            this._toastTimer = null;
            this.rainEmitter = null;
            this.snowEmitter = null;
            this.fireEmitters = [];
            this._fireIdCounter = 0;
            this._fireByEngine = new Map();
            this.playerBody = null;
            this.landmarkOrb = null;
            this.landmarkPos = null;
            this.orbLight = null;
            this.waterLevel = 0;
            this.forests = { pine: [], rock: null, bush: null, grass: null };
            this.terrainGen = null;
            this.terrainMesh = null;
            this.physics = null;
            this.worldAI = null;
            this.optimizerAI = null;
            this.metaAI = null;
            this.particles = null;
            this.wildlife = null;

            // === INICIALIZACIÓN ===
            this._bindInput();
            this._buildWorld();
            this._initPhysics();
            this._initParticles();
            this._initAI();
            this._buildMobileUI();

            console.log('✅ PriomEngine inicializado correctamente');
        }

        // ============================================================
        // ENTRADA
        // ============================================================
        _bindInput() {
            window.addEventListener('keydown', (e) => {
                this.keys[e.code] = true;
                if (e.code === 'KeyF') this._toggleFullscreen();
                if (e.code === 'KeyC') this._toggleCinematic();
                if (e.code === 'KeyP') this.metaAI && this.metaAI.forceMode('performance');
            });
            window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

            this._bindCanvasInput();
        }

        // Canvas-specific listeners only (click/pointer-lock/touch). Split
        // out from _bindInput() so the WebGL2 runtime fallback can re-attach
        // input to a freshly-swapped canvas element without re-registering
        // the window/document-level keyboard and mousemove listeners above
        // a second time.
        _bindCanvasInput() {
            this.canvas.addEventListener('click', () => {
                if (!this.isMobile) this.canvas.requestPointerLock();
            });
            document.addEventListener('pointerlockchange', () => {
                this.mouse.locked = document.pointerLockElement === this.canvas;
            });
            document.addEventListener('mousemove', (e) => {
                if (!this.mouse.locked) return;
                this.mouse.dx += e.movementX;
                this.mouse.dy += e.movementY;
            });

            const el = this.canvas;
            el.addEventListener('touchstart', (e) => {
                e.preventDefault();
                for (const t of e.changedTouches) {
                    if (t.clientX < window.innerWidth * 0.45) {
                        if (this.touch.leftId === null) {
                            this.touch.leftId = t.identifier;
                            this.touch.leftStart.x = this.touch.leftCurr.x = t.clientX;
                            this.touch.leftStart.y = this.touch.leftCurr.y = t.clientY;
                        }
                    } else {
                        if (this.touch.rightId === null) {
                            this.touch.rightId = t.identifier;
                            this.touch.rightStart.x = this.touch.rightCurr.x = t.clientX;
                            this.touch.rightStart.y = this.touch.rightCurr.y = t.clientY;
                        }
                    }
                }
            }, { passive: false });

            el.addEventListener('touchmove', (e) => {
                e.preventDefault();
                for (const t of e.changedTouches) {
                    if (t.identifier === this.touch.leftId) {
                        this.touch.leftCurr.x = t.clientX;
                        this.touch.leftCurr.y = t.clientY;
                    } else if (t.identifier === this.touch.rightId) {
                        const dx = t.clientX - this.touch.rightCurr.x;
                        const dy = t.clientY - this.touch.rightCurr.y;
                        this.mouse.dx += dx;
                        this.mouse.dy += dy;
                        this.touch.rightCurr.x = t.clientX;
                        this.touch.rightCurr.y = t.clientY;
                    }
                }
            }, { passive: false });

            el.addEventListener('touchend', (e) => {
                for (const t of e.changedTouches) {
                    if (t.identifier === this.touch.leftId) {
                        this.touch.leftId = null;
                        this.touch.leftCurr.x = this.touch.leftStart.x;
                        this.touch.leftCurr.y = this.touch.leftStart.y;
                    }
                    if (t.identifier === this.touch.rightId) this.touch.rightId = null;
                }
            });
            el.addEventListener('touchcancel', () => {
                this.touch.leftId = null;
                this.touch.rightId = null;
            });
        }

        _buildMobileUI() {
            if (!this.isMobile) return;
            const style = document.createElement('style');
            style.textContent = `
                #joy-zone, #look-zone {
                    position: fixed; bottom: 0; height: 45%; z-index: 50;
                    pointer-events: none;
                }
                #joy-zone { left: 0; width: 45%; }
                #look-zone { right: 0; width: 55%; }
                #joystick-base {
                    position: absolute; left: 28px; bottom: 28px;
                    width: 110px; height: 110px; border-radius: 50%;
                    background: rgba(255,255,255,0.08); border: 2px solid rgba(255,255,255,0.15);
                    pointer-events: none;
                }
                #joystick-knob {
                    position: absolute; left: 50%; top: 50%;
                    width: 48px; height: 48px; margin: -24px 0 0 -24px;
                    border-radius: 50%; background: rgba(56,189,248,0.55);
                    border: 2px solid rgba(255,255,255,0.4); pointer-events: none;
                }
                #look-hint {
                    position: absolute; right: 24px; bottom: 40px;
                    color: rgba(255,255,255,0.35); font-size: 11px; pointer-events: none;
                }
            `;
            document.head.appendChild(style);
            const joy = document.createElement('div');
            joy.id = 'joy-zone';
            joy.innerHTML = '<div id="joystick-base"><div id="joystick-knob"></div></div>';
            const look = document.createElement('div');
            look.id = 'look-zone';
            look.innerHTML = '<div id="look-hint">Arrastra para mirar</div>';
            document.body.appendChild(joy);
            document.body.appendChild(look);
            this._joyKnob = document.getElementById('joystick-knob');
        }

        _updateJoystickVisual() {
            if (!this._joyKnob || this.touch.leftId === null) {
                if (this._joyKnob) this._joyKnob.style.transform = 'translate(0,0)';
                return;
            }
            let dx = this.touch.leftCurr.x - this.touch.leftStart.x;
            let dy = this.touch.leftCurr.y - this.touch.leftStart.y;
            const max = 42;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            if (len > max) { dx = dx / len * max; dy = dy / len * max; }
            this._joyKnob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        }

        _toggleFullscreen() {
            if (!document.fullscreenElement) this.canvas.requestFullscreen && this.canvas.requestFullscreen();
            else document.exitFullscreen && document.exitFullscreen();
        }

        _showToast(msg) {
            let el = document.getElementById('priom-toast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'priom-toast';
                el.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);' +
                    'background:rgba(10,12,20,0.85);color:#e2e8f0;padding:8px 16px;border-radius:20px;' +
                    'font:600 13px system-ui,sans-serif;z-index:200;pointer-events:none;' +
                    'border:1px solid rgba(255,255,255,0.15);transition:opacity .3s;opacity:0;';
                document.body.appendChild(el);
            }
            el.textContent = msg;
            el.style.opacity = '1';
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2400);
        }

        // ============================================================
        // CONSTRUCCIÓN DEL MUNDO
        // ============================================================
        _buildWorld() {
            const Vec3 = window.PriomMath.Vec3;
            const Color = window.PriomMath.Color;
            const TerrainGenerator = window.PriomGL.TerrainGenerator;
            const Vegetation = window.PriomGL.Vegetation;
            const ChunkedForest = window.PriomGL.ChunkedForest;
            const MaterialLibrary = window.PriomGL.MaterialLibrary;
            const GeometryMerger = window.PriomGL.GeometryMerger;
            const Primitives = window.PriomGL.Primitives;
            const Mesh = window.PriomGL.Mesh;
            const Material = window.PriomGL.Material;

            console.log('🌍 PriomGL Polyglot — Construyendo mundo...');

            const segs = (this.hardwareDNA && this.hardwareDNA.recommendations && this.hardwareDNA.recommendations.terrainSegments)
                ? this.hardwareDNA.recommendations.terrainSegments
                : (this.isMobile ? 112 : 176);
            const terrainGen = new TerrainGenerator({
                size: 400, segments: segs, maxHeight: 28 + Math.random() * 12
            });
            this.terrainMesh = terrainGen.generate();
            this.scene.add(this.terrainMesh);
            this.terrainGen = terrainGen;
            console.log('🌱 Semilla del mundo: ' + terrainGen.seed);

            const waterMat = new Material({
                shader: 'water', albedo: new Color(0.03, 0.15, 0.22),
                roughness: 0.08, transparent: true
            });
            const water = new Mesh(this.renderer.waterGeo, waterMat);
            water.position.y = terrainGen.getWaterLevel();
            water.castShadow = false;
            this.scene.add(water);
            this.waterLevel = water.position.y;
            this.scene.waterLevel = this.waterLevel;

            this.scene.sun.direction.set(-0.6, -0.55, -0.35).normalize();
            this.scene.sun.color.set(1.0, 0.9, 0.72);
            this.scene.sun.intensity = 3.0; // was 4.8 — see CHANGELOG v9, overexposure fix
            this.scene.ambientColor.set(0.18, 0.22, 0.32);
            this.scene.fogColor.set(0.5, 0.65, 0.8);
            this.scene.fogDensity = 0.0015;
            this.scene.wind = new Vec3(1, 0, 0.35).normalize();
            this.scene.windStrength = 0.05;

            this._scatterNature(terrainGen);
            this._addLandmarks(terrainGen);
            console.log('✅ Mundo listo');
        }

        /**
         * Swaps the procedural pine/rock forests for real Kenney glTF
         * models, using the exact same ChunkedForest instancing system —
         * same draw-call profile, same LOD/culling, just better-looking
         * geometry. Deliberately NOT part of the default init path: the
         * procedural forest built during startup is the tested, known-
         * stable baseline (see CHANGELOG v6-v10 for how much work went
         * into that stability). This runs afterward, opt-in, and if any
         * model fails to load it leaves the procedural forest of that type
         * alone instead of leaving a gap.
         *
         * @param {object} [opts]
         * @param {string} [opts.basePath] - folder containing the .glb files
         * @param {string[]} [opts.treeFiles] - filenames to use as tree variants
         * @param {string[]} [opts.rockFiles] - filenames to use as rock variants
         */
        async upgradeToKenneyForest(opts = {}) {
            const GLTFLoader = window.PriomGL && window.PriomGL.GLTFLoader;
            const ChunkedForest = window.PriomGL.ChunkedForest;
            if (!GLTFLoader) { console.error('upgradeToKenneyForest: GLTFLoader.js no está cargado'); return false; }
            if (!this.terrainGen || !this.forests) { console.error('upgradeToKenneyForest: llama esto después de que el mundo esté listo'); return false; }

            const basePath = opts.basePath || 'models/kenney/fantasy-town/';
            const treeFiles = opts.treeFiles || ['tree.glb', 'tree-crooked.glb', 'tree-high.glb', 'tree-high-round.glb', 'tree-high-crooked.glb'];
            const rockFiles = opts.rockFiles || ['rock-large.glb', 'rock-small.glb', 'rock-wide.glb'];
            const gl = this.renderer.assetGL || this.renderer.gl;
            const cellSize = this.isMobile ? 110 : 95;
            const maxPerCell = this.isMobile ? 120 : 180;

            const loadAll = async (files) => {
                const results = [];
                for (const f of files) {
                    try {
                        const pair = await GLTFLoader.loadAsGeometry(gl, basePath + f);
                        if (pair) results.push(pair);
                    } catch (err) {
                        console.warn('upgradeToKenneyForest: no se pudo cargar', f, '—', err.message);
                    }
                }
                return results;
            };

            const [trees, rocks] = await Promise.all([loadAll(treeFiles), loadAll(rockFiles)]);

            if (trees.length) {
                const totalTreeCount = this.forests.pine.reduce((s, f) => s + (f.targetCount || 0), 0)
                    || Math.floor((this.isMobile ? 520 : 1800));
                const perVariant = Math.max(1, Math.floor(totalTreeCount / trees.length));
                const oldForests = this.forests.pine;
                const newForests = trees.map(({ geometry, material }) => {
                    const forest = new ChunkedForest(this.scene, geometry, material, { cellSize, maxInstancesPerCell: maxPerCell });
                    forest.scatter(this.terrainGen, {
                        count: perVariant, minHeight: 2.6, maxHeight: 22, maxSlopeDelta: 2.6,
                        scaleMin: 0.85, scaleMax: 1.6, scaleYVar: 0.18, colorVariance: 0.08,
                        exclude: (x, z) => {
                            const b = this.terrainGen.getBiome(x, z).name;
                            return !(b === 'forest' || b === 'meadow');
                        }
                    });
                    return forest;
                });
                for (const f of oldForests) f.dispose ? f.dispose() : this._disposeForest(f);
                this.forests.pine = newForests;
                console.log(`🌲 ${trees.length} variante(s) de árbol Kenney activas (reemplazando geometría procedural)`);
            }

            if (rocks.length) {
                const oldRock = this.forests.rock;
                const rockCount = oldRock && oldRock.targetCount ? oldRock.targetCount : (this.isMobile ? 140 : 520);
                // Multiple rock variants share the instance budget evenly.
                const perVariant = Math.max(1, Math.floor(rockCount / rocks.length));
                const newForests = rocks.map(({ geometry, material }) => {
                    const forest = new ChunkedForest(this.scene, geometry, material, { cellSize, maxInstancesPerCell: maxPerCell });
                    forest.scatter(this.terrainGen, {
                        count: perVariant, minHeight: 1.0, maxHeight: 34, maxSlopeDelta: 6,
                        scaleMin: 0.6, scaleMax: 1.8, scaleYVar: 0.25, colorVariance: 0.08
                    });
                    return forest;
                });
                if (oldRock) this._disposeForest(oldRock);
                // this.forests.rock was a single forest before; now it's a
                // small array. _cullVegetation/_allForests already iterate
                // whatever this._allForests holds (rebuilt below), so this
                // shape change is safe.
                this.forests.rock = newForests;
                console.log(`🪨 ${rocks.length} variante(s) de roca Kenney activas`);
            }

            // Rebuild the flat list _cullVegetation() iterates every frame.
            this._allForests = [
                ...this.forests.pine,
                ...(Array.isArray(this.forests.rock) ? this.forests.rock : (this.forests.rock ? [this.forests.rock] : [])),
                ...(this.forests.bush ? [this.forests.bush] : []),
                ...(this.forests.grass ? [this.forests.grass] : [])
            ];
            return true;
        }

        _disposeForest(forest) {
            // Best-effort GPU cleanup: remove every cell's mesh from the
            // scene so the old procedural instances stop being drawn.
            // Buffer/texture deletion is intentionally not attempted here —
            // this engine has no central GPU-resource registry to do that
            // safely, so the freed JS references are left for normal GC
            // rather than risk deleting a buffer something else still
            // holds a handle to.
            try {
                for (const cell of forest.cells.values()) {
                    if (cell.forest && cell.forest.mesh) this.scene.remove(cell.forest.mesh);
                }
            } catch (err) { console.warn('_disposeForest: cleanup parcial', err.message); }
        }

        _scatterNature(terrainGen) {
            const Vegetation = window.PriomGL.Vegetation;
            const ChunkedForest = window.PriomGL.ChunkedForest;
            const Material = window.PriomGL.Material;
            const Color = window.PriomMath.Color;
            const GeometryMerger = window.PriomGL.GeometryMerger;
            const Primitives = window.PriomGL.Primitives;

            // Presupuestos desde HardwareDNA (o fallbacks v4)
            const rec = (this.hardwareDNA && this.hardwareDNA.recommendations) || {};
            const treeCount = rec.treeBudget != null ? rec.treeBudget : (this.isMobile ? 520 : 1800);
            const rockCount = rec.rockBudget != null ? rec.rockBudget : (this.isMobile ? 140 : 520);
            const bushCount = this.isMobile
                ? Math.max(60, Math.floor(rockCount * 1.1))
                : Math.max(120, Math.floor(rockCount * 0.9));
            console.log('🌳 Presupuesto vegetación DNA:', { treeCount, rockCount, bushCount, tier: this.hardwareDNA && this.hardwareDNA.tier });

            this.forests = { pine: [], rock: null, bush: null, grass: null };

            const treeExclude = (x, z) => {
                const b = terrainGen.getBiome(x, z).name;
                return !(b === 'forest' || b === 'meadow');
            };
            const bushExclude = (x, z) => {
                const b = terrainGen.getBiome(x, z).name;
                return !(b === 'forest' || b === 'meadow' || b === 'riverbank');
            };

            // Larger cells → fewer draw calls (critical for mobile FPS)
            const cellSize = this.isMobile ? 110 : 95;
            const maxPerCell = this.isMobile ? 120 : 180;

            for (let v = 0; v < 4; v++) {
                const geo = Vegetation.buildTreeGeometryMerged(Primitives, GeometryMerger, v);
                const mat = new Material({ albedo: new Color(1, 1, 1), roughness: 0.78, metallic: 0.0, ao: 0.92, natureType: 2 });
                const forest = new ChunkedForest(this.scene, geo, mat, { cellSize, maxInstancesPerCell: maxPerCell });
                forest.scatter(terrainGen, {
                    count: Math.floor(treeCount / 4),
                    minHeight: 2.6, maxHeight: 22, maxSlopeDelta: 2.6,
                    scaleMin: 0.75, scaleMax: 2.05, scaleYVar: 0.38,
                    colorVariance: 0.22, exclude: treeExclude
                });
                this.forests.pine.push(forest);
            }

            {
                const geo = Vegetation.buildRockGeometryMerged(Primitives, GeometryMerger);
                const mat = new Material({ albedo: new Color(1, 1, 1), roughness: 0.88, metallic: 0.04, ao: 0.88, natureType: 3 });
                const forest = new ChunkedForest(this.scene, geo, mat, { cellSize, maxInstancesPerCell: maxPerCell });
                forest.scatter(terrainGen, {
                    count: rockCount, minHeight: 1.0, maxHeight: 34, maxSlopeDelta: 6,
                    scaleMin: 0.45, scaleMax: 2.6, scaleYVar: 0.55, colorVariance: 0.18
                });
                this.forests.rock = forest;
            }

            {
                const geo = Vegetation.buildBushGeometryMerged(Primitives, GeometryMerger);
                const mat = new Material({ albedo: new Color(1, 1, 1), roughness: 0.76, metallic: 0.0, natureType: 2 });
                const forest = new ChunkedForest(this.scene, geo, mat, { cellSize, maxInstancesPerCell: maxPerCell });
                forest.scatter(terrainGen, {
                    count: bushCount, minHeight: 2.2, maxHeight: 16, maxSlopeDelta: 1.8,
                    scaleMin: 0.65, scaleMax: 1.45, scaleYVar: 0.22, colorVariance: 0.24,
                    exclude: bushExclude, usePoisson: true, minDistance: 1.7
                });
                this.forests.bush = forest;
            }

            // Fine ground layer: dense clumps of individually modeled blades.
            // It is intentionally separate from shrubs so the engine can cull it
            // more aggressively on mobile while preserving the detailed tree silhouettes.
            if (Vegetation.buildGrassGeometryMerged) {
                const grassCount = this.isMobile ? 420 : 1050;
                const grassGeo = Vegetation.buildGrassGeometryMerged(Primitives, GeometryMerger);
                const grassMat = new Material({ albedo: new Color(0.78, 0.95, 0.66), roughness: 0.94, metallic: 0.0, ao: 0.86, natureType: 2 });
                const grass = new ChunkedForest(this.scene, grassGeo, grassMat, { cellSize: this.isMobile ? 85 : 75, maxInstancesPerCell: this.isMobile ? 150 : 190 });
                grass.scatter(terrainGen, {
                    count: grassCount, minHeight: 1.0, maxHeight: 20, maxSlopeDelta: 2.2,
                    scaleMin: 0.55, scaleMax: 1.35, scaleYVar: 0.35, colorVariance: 0.28,
                    exclude: (x,z) => terrainGen.getBiome(x,z).name === 'alpine_rock' || terrainGen.getBiome(x,z).name === 'scree'
                });
                this.forests.grass = grass;
            }

            this._allForests = [...this.forests.pine, this.forests.rock, this.forests.bush, ...(this.forests.grass ? [this.forests.grass] : [])];
        }

        _applyEntityScale(scale) {
            // Vegetation density is intentionally NOT changed every frame.
            // The previous implementation truncated instance buffers whenever
            // Trinity's quality score moved, producing the visible tree pop-in
            // seen on mobile. Density is now selected once at world build time;
            // distance culling/LOD handles performance without deleting visible
            // trees from the front of an instance buffer.
            this._vegetationQualityScale = Math.max(0.35, Math.min(1.0, scale || 1));
        }

        _cullVegetation(camera, dt) {
            if (!this._allForests) return;
            // Quality-scaled cull distance: low quality → much tighter horizon.
            // Bug fixed: this used to call `f.cull(camera, maxDist)`, passing
            // the *distance* (100-240) in the parameter `cull()` actually
            // treats as a frame delta-time. That broke the internal 0.5s
            // culling throttle (culling ran in full every single frame,
            // wasting CPU) AND never touched the real distance cutoff
            // (`forest.maxDist`, a separate property), so quality settings
            // never actually changed vegetation draw distance at all.
            const base = this.isMobile ? 205 : 300;
            const maxDist = base;
            for (const f of this._allForests) {
                f.maxDist = maxDist;
                f.cull(camera, dt);
            }
        }

        /**
         * Assembles a small real structure from the fantasy-town kit (4
         * walls on a 1×1 grid cell + gable roof + a fence ring + a tree +
         * the round fountain nearby) as a hand-placed cluster of individual
         * loadModel() calls — these are unique one-off pieces, not
         * thousands of instances, so a handful of extra draw calls here is
         * a non-issue (contrast with upgradeToKenneyForest, which had to
         * go through ChunkedForest instancing because there ARE thousands
         * of those).
         *
         * Kenney's modular kit convention (verified against the actual
         * accessor bounds in these files): each wall piece is a 1×1×1 unit
         * cell with the wall slab against the local +X face. Rotating it
         * 0°/90°/180°/270° around Y walks it around the other three sides.
         * This is a straightforward hut, not a guarantee of pixel-perfect
         * alignment with what Kenney's own map editor would snap to —
         * treat it as a working starting point to hand-tune from, not a
         * finished village.
         */
        async upgradeToKenneyVillage(opts = {}) {
            if (!this.terrainGen) { console.error('upgradeToKenneyVillage: llama esto después de que el mundo esté listo'); return false; }
            const basePath = opts.basePath || 'models/kenney/fantasy-town/';

            // Find a decent building spot instead of trusting a hardcoded
            // (x,z): every world is a fresh random seed, so a fixed offset
            // can just as easily land on a snowy peak or a steep riverbank
            // as on flat meadow (confirmed live — the first version of this
            // did exactly that). Sample candidates, score by flatness +
            // being in a sensible biome + being away from open water.
            let best = null, bestScore = -Infinity;
            const waterLevel = this.terrainGen.getWaterLevel ? this.terrainGen.getWaterLevel() : 0;
            for (let i = 0; i < 40; i++) {
                const x = opts.x ?? ((Math.random() - 0.5) * 140);
                const z = opts.z ?? ((Math.random() - 0.5) * 140);
                const h = this.terrainGen.getHeight(x, z);
                if (h < waterLevel + 1.5) continue; // too close to/under water
                const biome = this.terrainGen.getBiome ? this.terrainGen.getBiome(x, z).name : 'meadow';
                const h2 = this.terrainGen.getHeight(x + 2, z);
                const h3 = this.terrainGen.getHeight(x, z + 2);
                const flatness = -(Math.abs(h - h2) + Math.abs(h - h3)); // closer to 0 = flatter
                const biomeBonus = (biome === 'meadow' || biome === 'forest') ? 4 : 0;
                const heightPenalty = -Math.abs(h - 8) * 0.15; // prefer moderate elevation, not peaks
                const score = flatness * 3 + biomeBonus + heightPenalty;
                if (score > bestScore) { bestScore = score; best = { x, z, h, biome }; }
                if (opts.x !== undefined && opts.z !== undefined) break; // explicit position requested — don't search
            }
            if (!best) { console.error('upgradeToKenneyVillage: no se encontró un buen sitio'); return false; }
            const cx = best.x, cz = best.z, cy = best.h;
            console.log(`🏘️ Sitio elegido: (${cx.toFixed(1)}, ${cz.toFixed(1)}) altura=${cy.toFixed(1)} bioma=${best.biome}`);

            const HALF_PI = Math.PI / 2;
            const jobs = [];
            const place = (file, position, rotationY = 0, scale = 1) =>
                jobs.push(this.loadModel(basePath + file, { position, rotationY, scale }).catch(err => {
                    console.warn('upgradeToKenneyVillage: no se pudo cargar', file, '—', err.message);
                    return null;
                }));

            // Hut: 4 walls around a 1x1 cell + gable roof on top.
            place('wall.glb', [cx, cy, cz], 0);            // east
            place('wall.glb', [cx, cy, cz], HALF_PI);       // north
            place('wall.glb', [cx, cy, cz], Math.PI);       // west
            place('wall-door.glb', [cx, cy, cz], -HALF_PI); // south (entrance)
            place('roof-gable.glb', [cx, cy + 1.0, cz], 0);
            place('chimney.glb', [cx + 0.3, cy + 1.5, cz - 0.3], 0);

            // A little fenced garden patch beside the hut.
            for (let i = 0; i < 3; i++) place('fence.glb', [cx - 1.5, cy, cz - 0.5 + i], 0);
            place('fence-gate.glb', [cx - 1.5, cy, cz + 2], 0);

            // Centerpiece fountain a few meters out front, plus a real
            // Kenney tree instead of the procedural forest right next to it
            // so the contrast is easy to see.
            place('fountain-center.glb', [cx + 4, this.terrainGen.getHeight(cx + 4, cz + 3), cz + 3], 0, 1.4);
            place('tree-high-round.glb', [cx - 3, this.terrainGen.getHeight(cx - 3, cz + 4), cz + 4], Math.random() * Math.PI * 2);
            place('cart.glb', [cx + 1.5, cy, cz - 2], HALF_PI * 0.5);

            const results = await Promise.all(jobs);
            const okCount = results.filter(Boolean).length;
            console.log(`🏘️ Aldea Kenney: ${okCount}/${jobs.length} piezas cargadas en (${cx.toFixed(1)}, ${cy.toFixed(1)}, ${cz.toFixed(1)})`);
            return okCount > 0;
        }

        /**
         * Same idea as upgradeToKenneyVillage but with the industrial kit:
         * a small row of buildings, tanks and shipping containers — an
         * "abandoned outpost" point of interest rather than trying to force
         * a full factory into a nature sim.
         */
        async spawnKenneyOutpost(opts = {}) {
            if (!this.terrainGen) { console.error('spawnKenneyOutpost: llama esto después de que el mundo esté listo'); return false; }
            const basePath = opts.basePath || 'models/kenney/city-industrial/';

            let best = null, bestScore = -Infinity;
            const waterLevel = this.terrainGen.getWaterLevel ? this.terrainGen.getWaterLevel() : 0;
            for (let i = 0; i < 40; i++) {
                const x = opts.x ?? ((Math.random() - 0.5) * 140);
                const z = opts.z ?? ((Math.random() - 0.5) * 140);
                const h = this.terrainGen.getHeight(x, z);
                if (h < waterLevel + 1.5) continue;
                const h2 = this.terrainGen.getHeight(x + 3, z);
                const h3 = this.terrainGen.getHeight(x, z + 3);
                const flatness = -(Math.abs(h - h2) + Math.abs(h - h3));
                const heightPenalty = -Math.abs(h - 8) * 0.15;
                const score = flatness * 3 + heightPenalty;
                if (score > bestScore) { bestScore = score; best = { x, z, h }; }
                if (opts.x !== undefined && opts.z !== undefined) break;
            }
            if (!best) { console.error('spawnKenneyOutpost: no se encontró un buen sitio'); return false; }
            const cx = best.x, cz = best.z;
            console.log(`🏭 Sitio elegido: (${cx.toFixed(1)}, ${cz.toFixed(1)}) altura=${best.h.toFixed(1)}`);

            const HALF_PI = Math.PI / 2;
            const jobs = [];
            const place = (file, dx, dz, rotationY = 0, scale = 1) => {
                const x = cx + dx, z = cz + dz;
                const y = this.terrainGen.getHeight(x, z);
                jobs.push(this.loadModel(basePath + file, { position: [x, y, z], rotationY, scale }).catch(err => {
                    console.warn('spawnKenneyOutpost: no se pudo cargar', file, '—', err.message);
                    return null;
                }));
            };

            place('building-a.glb', 0, 0, 0);
            place('building-c.glb', 6, 0.5, HALF_PI);
            place('detail-tank-large.glb', -5, 3, 0);
            place('chimney-large.glb', 3, -4, 0);
            place('shipping-container-a.glb', -3, -5, 0.3);
            place('shipping-container-b.glb', -3, -3.2, 0.3);

            const results = await Promise.all(jobs);
            const okCount = results.filter(Boolean).length;
            console.log(`🏭 Puesto industrial Kenney: ${okCount}/${jobs.length} piezas cargadas en (${cx}, ${cz})`);
            return okCount > 0;
        }

        _addLandmarks(terrainGen) {
            const MaterialLibrary = window.PriomGL.MaterialLibrary;
            const Mesh = window.PriomGL.Mesh;
            const Primitives = window.PriomGL.Primitives;
            const Color = window.PriomMath.Color;
            const Vec3 = window.PriomMath.Vec3;

            let bestY = 0, bx = 30, bz = -20;
            for (let i = 0; i < 60; i++) {
                const x = 10 + Math.random() * 60;
                const z = -50 + Math.random() * 50;
                const y = terrainGen.getHeight(x, z);
                if (y > bestY) { bestY = y; bx = x; bz = z; }
            }
            const stone = MaterialLibrary.stoneWorn();
            const gold = MaterialLibrary.gold();
            const platform = new Mesh(Primitives.box(8, 1.2, 8), stone);
            platform.position.set(bx, bestY + 0.6, bz);
            this.scene.add(platform);
            for (let i = 0; i < 6; i++) {
                const ang = (i / 6) * Math.PI * 2;
                const col = new Mesh(Primitives.cylinder(0.45, 0.55, 5.5, 10), stone);
                col.position.set(bx + Math.cos(ang) * 2.8, bestY + 3.5, bz + Math.sin(ang) * 2.8);
                this.scene.add(col);
            }
            const orb = new Mesh(Primitives.sphere(1.3, 24, 16), gold);
            orb.position.set(bx, bestY + 7.2, bz);
            this.scene.add(orb);
            this.landmarkOrb = orb;
            this.landmarkPos = new Vec3(bx, bestY, bz);

            this.orbLight = {
                position: orb.position,
                color: new Color(1.0, 0.78, 0.35),
                intensity: 14,
                radius: 26
            };
            this.scene.pointLights.push(this.orbLight);
        }

        // ============================================================
        // FÍSICA
        // ============================================================
        _initPhysics() {
            const PhysicsWorld = window.PriomGL.PhysicsWorld;
            const RigidBody = window.PriomGL.RigidBody;
            const Vec3 = window.PriomMath.Vec3;

            this.physics = new PhysicsWorld({
                gravity: new Vec3(0, -18, 0),
                getHeight: (x, z) => this.terrainGen.getHeight(x, z)
            });
            this.playerBody = new RigidBody({
                position: this.camera.position.clone(),
                mass: 70, radius: 0.9, restitution: 0.1, friction: 0.55
            });
            this.physics.add(this.playerBody);
        }

        // ============================================================
        // PARTÍCULAS
        // ============================================================
        _initParticles() {
            const ParticleSystem = window.PriomGL.ParticleSystem;
            const ParticleEmitter = window.PriomGL.ParticleEmitter;
            this.particles = new ParticleSystem(this.renderer, this.isMobile ? 1200 : 2500);
            this.rainEmitter = null;
            this.snowEmitter = null;
            this.fireEmitters = [];
        }

        _syncWeatherParticles() {
            const ParticleSystem = window.PriomGL.ParticleSystem;
            const ParticleEmitter = window.PriomGL.ParticleEmitter;
            const Color = window.PriomMath.Color;
            const Vec3 = window.PriomMath.Vec3;

            if (!this.worldAI) return;
            const w = this.worldAI.weather;
            const cam = this.camera.position;

            if (w === 'lluvia' || w === 'tormenta') {
                if (!this.rainEmitter) {
                    this.rainEmitter = ParticleSystem.createRain(ParticleEmitter, cam.clone(), 100);
                    this.particles.addEmitter(this.rainEmitter);
                }
                this.rainEmitter.position.copy(cam);
                this.rainEmitter.active = true;
                this.rainEmitter.rate = w === 'tormenta' ? 320 : 180;
                if (this.snowEmitter) this.snowEmitter.active = false;
            } else if (w === 'nieve') {
                if (!this.snowEmitter) {
                    this.snowEmitter = ParticleSystem.createSnow(ParticleEmitter, cam.clone(), 110);
                    this.particles.addEmitter(this.snowEmitter);
                }
                this.snowEmitter.position.copy(cam);
                this.snowEmitter.active = true;
                if (this.rainEmitter) this.rainEmitter.active = false;
            } else {
                if (this.rainEmitter) this.rainEmitter.active = false;
                if (this.snowEmitter) this.snowEmitter.active = false;
            }

            // Fires
            this._fireIdCounter = this._fireIdCounter || 0;
            this._fireByEngine = this._fireByEngine || new Map();
            const seenIds = new Set();
            for (const f of this.worldAI.fires) {
                if (f._engineId === undefined) f._engineId = ++this._fireIdCounter;
                seenIds.add(f._engineId);
                let rec = this._fireByEngine.get(f._engineId);
                if (!rec) {
                    const em = ParticleSystem.createFire(ParticleEmitter, f.pos);
                    this.particles.addEmitter(em);
                    const light = { position: f.pos.clone(), color: new Color(1.0, 0.5, 0.15), intensity: 8, radius: 14, _flickerSeed: Math.random() * 100 };
                    this.scene.pointLights.push(light);
                    rec = { emitter: em, light };
                    this._fireByEngine.set(f._engineId, rec);
                }
                rec.emitter.position.copy(f.pos);
                rec.emitter.active = true;
                rec.emitter.rate = 35 * f.intensity;
                const flick = 0.85 + Math.sin(this.clock.elapsed * 14 + rec.light._flickerSeed) * 0.15
                                  + Math.sin(this.clock.elapsed * 37 + rec.light._flickerSeed) * 0.08;
                rec.light.intensity = 8 * f.intensity * flick;
                rec.light.position.copy(f.pos);
            }
            for (const [id, rec] of this._fireByEngine) {
                if (seenIds.has(id)) continue;
                rec.emitter.active = false;
                const li = this.scene.pointLights.indexOf(rec.light);
                if (li >= 0) this.scene.pointLights.splice(li, 1);
                this._fireByEngine.delete(id);
            }
        }

        // ============================================================
        // INTELIGENCIA ARTIFICIAL
        // ============================================================
        /**
         * Load a real glTF/GLB model (sculpted mesh, PBR textures — see
         * js/loaders/GLTFLoader.js) and add it to the scene. This is the
         * real integration point for actual downloaded/exported assets;
         * point it at any .glb under this project (e.g. models/deer.glb)
         * once you've added one with a license you're comfortable with.
         *
         * @param {string} url - e.g. 'models/rock_01.glb'
         * @param {object} [placement] - { position:[x,y,z], scale:number|[x,y,z], rotationY:number }
         * @returns {Promise<Object3D|null>} the loaded root node, or null on failure
         */
        async loadModel(url, placement = {}) {
            if (!window.PriomGL || !window.PriomGL.GLTFLoader) {
                console.error('loadModel: GLTFLoader.js no está cargado (falta el <script> en index.html)');
                return null;
            }
            try {
                const root = await window.PriomGL.GLTFLoader.load(this.renderer.assetGL || this.renderer.gl, url);
                if (placement.position) root.position.set(...placement.position);
                if (placement.scale !== undefined) {
                    const s = placement.scale;
                    root.scale.set(...(Array.isArray(s) ? s : [s, s, s]));
                }
                if (placement.rotationY) root.rotation.setFromAxisAngle(new Vec3(0, 1, 0), placement.rotationY);
                this.scene.add(root);
                console.log('📦 Modelo glTF cargado:', url, root);
                return root;
            } catch (err) {
                console.error('📦 Error cargando modelo glTF', url, '—', err.message);
                return null;
            }
        }

        _initAI() {
            const WorldAI = window.PriomGL.WorldAI;
            const OptimizerAI = window.PriomGL.OptimizerAI;
            const MetaOptimizerAI = window.PriomGL.MetaOptimizerAI;
            const WildlifeRenderer = window.PriomGL.WildlifeRenderer;

            this.worldAI = new WorldAI(this);
            this.climateEngine = window.PriomGL.ClimateEngine ? new window.PriomGL.ClimateEngine((this.terrainGen?.seed||1337)) : null;
            // Cap simulated wildlife by hardware tier. Each animal now costs
            // ~10 draw calls post-merge (was ~20-25) but weak/mobile GPUs
            // still shouldn't be asked to juggle 80 of them. WorldAI's
            // constructor already spawned its initial population using the
            // default cap, so trim it down too, not just future growth.
            if (this.hardwareDNA) {
                const tierCap = { potato: 14, low: 22, medium: 36, high: 55, ultra: 80 };
                const cap = tierCap[this.hardwareDNA.tier] || 36;
                this.worldAI.config.maxAnimals = cap;
                if (this.worldAI.animals.length > cap) this.worldAI.animals.length = cap;
            }
            this.optimizerAI = new OptimizerAI(this);
            this.metaAI = new MetaOptimizerAI(this, this.optimizerAI, this.worldAI);
            this.trinityNeural = window.PriomGL.TrinityNeuralCore ? new window.PriomGL.TrinityNeuralCore(this) : null;
            this.wildlife = new WildlifeRenderer(this.scene);
            console.log('🧠 Triple-AI online: WorldAI · OptimizerAI · MetaOptimizerAI');
            console.log('🦌 Fauna visible: ' + this.worldAI.animals.length + ' criaturas animadas');
        }

        // ============================================================
        // CINEMÁTICA
        // ============================================================
        _buildCinematicPath() {
            const lp = this.landmarkPos ? this.landmarkPos.clone() : new Vec3(0, 10, 0);
            const g = this.terrainGen;
            const h = (x, z) => (g ? g.getHeight(x, z) : lp.y);
            const pts = [
                { x: lp.x + 90, y: h(lp.x + 90, lp.z + 90) + 55, z: lp.z + 90 },
                { x: lp.x + 25, y: h(lp.x + 25, lp.z - 70) + 32, z: lp.z - 70 },
                { x: lp.x - 75, y: h(lp.x - 75, lp.z - 15) + 16, z: lp.z - 15 },
                { x: lp.x - 25, y: 4.5, z: lp.z + 55 },
                { x: lp.x + 8, y: lp.y + 10, z: lp.z + 6 },
                { x: lp.x + 70, y: h(lp.x + 70, lp.z - 45) + 45, z: lp.z - 45 }
            ];
            this.cinematic.waypoints = pts;
        }

        _toggleCinematic() {
            this.cinematic.active = !this.cinematic.active;
            if (this.cinematic.active) {
                if (!this.cinematic.waypoints) this._buildCinematicPath();
                this.cinematic.u = 0;
                this.metaAI && this.metaAI.forceMode('cinematic');
                this._showToast('🎬 Cámara cinematográfica');
            } else {
                this._showToast('🎮 Control manual');
            }
        }

        toggleCinematic() {
            this._toggleCinematic();
        }

        _updateCinematicCamera(dt) {
            const cin = this.cinematic;
            const pts = cin.waypoints;
            const N = pts.length;
            cin.u = (cin.u + dt * cin.speed) % N;
            const i = Math.floor(cin.u);
            const t = cin.u - i;
            const p0 = pts[(i - 1 + N) % N], p1 = pts[i % N], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N];
            const pos = catmullRom(p0, p1, p2, p3, t);
            this.camera.position.set(pos.x, pos.y, pos.z);

            const posAhead = catmullRom(p0, p1, p2, p3, Math.min(0.99, t + 0.06));
            const fwd = { x: posAhead.x - pos.x, y: posAhead.y - pos.y, z: posAhead.z - pos.z };
            const lookAhead = { x: pos.x + fwd.x * 6, y: pos.y + fwd.y * 6, z: pos.z + fwd.z * 6 };
            const orbTarget = this.landmarkPos ? { x: this.landmarkPos.x, y: this.landmarkPos.y + 7, z: this.landmarkPos.z } : lookAhead;
            const target = {
                x: lookAhead.x + (orbTarget.x - lookAhead.x) * 0.4,
                y: lookAhead.y + (orbTarget.y - lookAhead.y) * 0.4,
                z: lookAhead.z + (orbTarget.z - lookAhead.z) * 0.4
            };
            this.camera.lookAt(new Vec3(target.x, target.y, target.z));

            this.playerBody.position.copy(this.camera.position);
            this.playerBody.velocity.set(0, 0, 0);
        }

        // ============================================================
        // CÁMARA
        // ============================================================
        _updateCamera(dt) {
            if (this.cinematic.active) {
                const wantsControl = this.keys['KeyW'] || this.keys['KeyA'] || this.keys['KeyS'] || this.keys['KeyD'] ||
                    this.keys['ArrowUp'] || this.keys['ArrowDown'] || this.keys['ArrowLeft'] || this.keys['ArrowRight'] ||
                    this.keys['Space'] || this.touch.leftId !== null ||
                    Math.abs(this.mouse.dx) > 2 || Math.abs(this.mouse.dy) > 2;
                if (wantsControl) {
                    this.cinematic.active = false;
                    this.mouse.dx = 0; this.mouse.dy = 0;
                    this._showToast('🎮 Control manual reanudado');
                } else {
                    this._updateCinematicCamera(dt);
                    this._updateJoystickVisual();
                    return;
                }
            }

            const sens = this.isMobile ? this.touch.lookSens : 0.0022;
            this.yaw -= this.mouse.dx * sens;
            this.pitch -= this.mouse.dy * sens;
            this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
            this.mouse.dx = 0;
            this.mouse.dy = 0;

            const qYaw = new Quat().setFromAxisAngle(new Vec3(0, 1, 0), this.yaw);
            const qPitch = new Quat().setFromAxisAngle(new Vec3(1, 0, 0), this.pitch);
            this.camera.rotation.copy(qYaw).multiply(qPitch);

            const rotMat = new window.PriomMath.Mat4().makeRotationFromQuaternion(this.camera.rotation);
            const forward = new Vec3(0, 0, -1).transformDirection(rotMat);
            forward.y = 0;
            if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
            forward.normalize();
            const right = new Vec3(forward.z, 0, -forward.x).normalize();

            let mx = 0, mz = 0;
            if (this.keys['KeyW'] || this.keys['ArrowUp']) mz += 1;
            if (this.keys['KeyS'] || this.keys['ArrowDown']) mz -= 1;
            if (this.keys['KeyA'] || this.keys['ArrowLeft']) mx -= 1;
            if (this.keys['KeyD'] || this.keys['ArrowRight']) mx += 1;

            if (this.touch.leftId !== null) {
                const dx = this.touch.leftCurr.x - this.touch.leftStart.x;
                const dy = this.touch.leftCurr.y - this.touch.leftStart.y;
                const max = 48;
                mx += Math.max(-1, Math.min(1, dx / max));
                mz += Math.max(-1, Math.min(1, -dy / max));
            }

            const len = Math.sqrt(mx * mx + mz * mz) || 1;
            if (len > 1) { mx /= len; mz /= len; }

            const sprint = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 2.2 : 1;
            const speed = this.moveSpeed * sprint;
            const wish = new Vec3();
            wish.addScaled(forward, mz * speed);
            wish.addScaled(right, mx * speed);

            if (this.keys['Space'] || this.keys['KeyQ']) {
                if (this.playerBody.onGround) this.playerBody.velocity.y = 9.5;
            }
            if (this.keys['KeyE'] || this.keys['ControlLeft']) {
                this.playerBody.velocity.y -= 25 * dt;
            }

            this.playerBody.velocity.x += (wish.x - this.playerBody.velocity.x) * Math.min(1, dt * 8);
            this.playerBody.velocity.z += (wish.z - this.playerBody.velocity.z) * Math.min(1, dt * 8);

            this.camera.position.x = this.playerBody.position.x;
            this.camera.position.y = this.playerBody.position.y + 1.4;
            this.camera.position.z = this.playerBody.position.z;

            this.camera.updateMatrix();
            this.camera.matrixWorld.copy(this.camera.matrix);
            this.camera.viewMatrix.copy(this.camera.matrixWorld).invert();
            this._updateJoystickVisual();
        }

        // ============================================================
        // SOL
        // ============================================================
        _updateSun(t) {
            const daySpeed = 0.012;
            const angle = t * daySpeed + 0.8;
            this.scene.sun.direction.set(
                Math.cos(angle) * 0.75,
                -Math.max(0.12, Math.sin(angle) * 0.9 + 0.1),
                Math.sin(angle * 0.65) * 0.45
            ).normalize();
            const elev = -this.scene.sun.direction.y;
            const warm = Math.max(0, 1 - elev * 1.8);
            this.scene.sun.color.set(1.0, 0.93 - warm * 0.28, 0.8 - warm * 0.45);
            // Sun intensity used to peak at 6.0, which — fed through this
            // engine's PBR math (albedo * sunColor * intensity * NdotL) —
            // pushed nearly every sunlit surface past the tonemap's usable
            // range before it even got there, crushing every texture's
            // contrast into a near-flat, washed-out pale look (measured:
            // std-dev of ~2.7/255 on rendered grass pixels that should vary
            // by dozens of levels). Peaking at 3.2 instead keeps highlights
            // inside the tonemap's contrasty midrange instead of blowing
            // them out. See CHANGELOG v9.
            this.scene.sun.intensity = 1.4 + elev * 1.8;
            this.scene.ambientColor.set(0.12 + elev * 0.14, 0.15 + elev * 0.12, 0.25 + elev * 0.12);
            if (this.landmarkOrb) {
                const pulse = 0.9 + Math.sin(t * 2.5) * 0.15;
                this.landmarkOrb.scale.set(pulse, pulse, pulse);
                if (this.orbLight) this.orbLight.intensity = 14 * pulse;
            }
        }

        // ============================================================
        // FALLBACK WEBGL2 (auto-recuperación)
        // ============================================================
        // A canvas element only ever gets one GPU context type for its whole
        // lifetime: once `canvas.getContext('webgpu')` has been called (even
        // if WebGPU later fails or produces invalid frames), a later
        // `canvas.getContext('webgl2')` on that *same* element returns null.
        // The previous fallback path re-used the original canvas, so on any
        // device where WebGPU init failed after already grabbing the
        // context, "automatic WebGL2 fallback" silently produced a
        // non-functional renderer — another route to a stuck black screen.
        // Swapping in a fresh, context-free clone of the canvas fixes that.
        _installWebGL2Fallback(reason) {
            if (this.renderer && this.renderer._fallbackInstalled) return;
            console.warn('↩️ Activando WebGL2 automáticamente:', reason);
            this.rendererStatus = 'WebGL2 · ' + reason;
            const PriomRenderer = window.PriomGL.PriomRenderer;
            const oldCanvas = this.canvas;
            const freshCanvas = oldCanvas.cloneNode(false);
            oldCanvas.replaceWith(freshCanvas);
            this.canvas = freshCanvas;
            // WebGL2's full forward+CSM-shadows+SSAO+bloom pipeline is far
            // heavier per pixel than the WebGPU path it replaces, and this
            // switch can happen mid-session on a phone. Rather than starting
            // at whatever pixel ratio/quality WebGPU was configured for and
            // waiting several seconds for OptimizerAI's FPS feedback loop to
            // claw it back down (which is what produced a single-digit FPS
            // right after the swap), start the rescue renderer at a
            // conservative quality outright.
            const rec = this._hwRec || {};
            const rescuePR = this.isMobile ? 0.85 : Math.min(this._fallbackMaxPR || 1.5, 1.25);
            const fallback = new PriomRenderer(freshCanvas, { maxPixelRatio: rescuePR, exposure: 1.35 });
            fallback._fallbackInstalled = true;
            fallback.failureReason = this.rendererStatus;
            fallback.shadowCascadeScale = this.isMobile ? 0.34 : 0.7;
            if (rec.ssao === false || this.isMobile) fallback.ssaoEnabled = false;
            // Now that bloom/god rays are actually skippable (see
            // PriomRenderer._postProcess), start the rescue renderer with
            // both off on mobile instead of waiting for OptimizerAI to
            // notice the FPS crash a few seconds in.
            if (this.isMobile) { fallback.bloomEnabled = false; fallback.godRaysEnabled = false; }
            this.renderer = fallback;
            // Pointer-lock/click/touch listeners from the constructor were
            // bound to the old (now-detached) canvas element; re-bind just
            // those (not the window/document-level ones, to avoid double
            // firing keydown/mousemove) to the fresh canvas.
            if (typeof this._bindCanvasInput === 'function') this._bindCanvasInput();
        }

        // ============================================================
        // HUD
        // ============================================================
        _vegetationStats() {
            if (!this._allForests) return { total: 0, visible: 0 };
            let total = 0, visible = 0;
            for (const f of this._allForests) { total += f.totalInstances; visible += f.visibleInstances; }
            return { total, visible };
        }

        _updateHUD() {
            const el = document.getElementById('hud-stats');
            if (!el) return;
            const s = this.renderer.stats;
            const w = this.worldAI ? this.worldAI.getStatus() : { weather: '--', season: '--', temperature: 0 };
            const o = this.optimizerAI ? this.optimizerAI.getStatus() : { quality: '1.00' };
            const m = this.metaAI ? this.metaAI.getStatus() : { mode: 'balanced' };
            const veg = this._vegetationStats();
            const wildlifeCount = this.wildlife ? this.wildlife.getCount() : 0;

            const tier = this.hardwareDNA ? this.hardwareDNA.tier : '--';
            const score = this.hardwareDNA ? this.hardwareDNA.score : '--';
            // Diagnostic addition: camera position and the terrain height
            // directly beneath it. If the camera Y ends up at or below the
            // terrain height here, the camera is inside/clipped into the
            // ground — which alone would explain "huge flat-shaded triangle
            // walls filling the screen" far better than any shader/buffer
            // bug, since you'd be looking at the underside/interior of
            // terrain geometry from point-blank range. Cheap to compute, and
            // settles the "is the camera actually inside the mesh?"
            // question from a screenshot instead of guessing.
            let camDiag = '--';
            try {
                const cx = this.camera.position.x, cy = this.camera.position.y, cz = this.camera.position.z;
                const groundY = this.terrainGen ? this.terrainGen.getHeight(cx, cz) : null;
                const rel = groundY != null ? (cy - groundY).toFixed(1) : '?';
                camDiag = `(${cx.toFixed(0)}, ${cy.toFixed(1)}, ${cz.toFixed(0)}) · suelo ${groundY != null ? groundY.toFixed(1) : '?'} · Δ${rel}`;
            } catch (e) { camDiag = 'error: ' + e.message; }
            // Diagnostic: raw sun direction/color actually used to light the
            // scene this frame, so a NaN or all-zero light (which would
            // explain a persistent black screen regardless of where the
            // camera is) is visible directly instead of guessed at.
            let lightDiag = '--';
            try {
                const s = this.renderer.lastFrameSun, c = this.renderer.lastFrameSunColor;
                if (s && c) {
                    const fmt = n => (typeof n === 'number' ? n.toFixed(2) : String(n));
                    lightDiag = `dir(${fmt(s.x)},${fmt(s.y)},${fmt(s.z)}) col(${fmt(c.r)},${fmt(c.g)},${fmt(c.b)})` + (this.renderer.lastFrameDebug?.nan ? ' ⚠️NaN' : '');
                }
            } catch (e) { lightDiag = 'error: ' + e.message; }
            el.innerHTML =
                '<div class="stat"><span>FPS</span><span class="value ' + (this.stats.fps >= 48 ? 'good' : 'warn') + '">' + this.stats.fps + '</span></div>' +
                '<div class="stat"><span>Draws</span><span class="value">' + s.drawCalls + '</span></div>' +
                '<div class="stat"><span>Tris</span><span class="value">' + (s.triangles / 1000).toFixed(1) + 'k</span></div>' +
                '<div class="stat"><span>Vegetación</span><span class="value">' + veg.visible + ' / ' + veg.total + '</span></div>' +
                '<div class="stat"><span>Clima</span><span class="value meta">' + w.weather + '</span></div>' +
                '<div class="stat"><span>Estación</span><span class="value">' + w.season + '</span></div>' +
                '<div class="stat"><span>Temp</span><span class="value">' + w.temperature + '°C</span></div>' +
                '<div class="stat"><span>Fauna viva</span><span class="value">' + wildlifeCount + '</span></div>' +
                '<div class="stat"><span>Calidad IA</span><span class="value ultra">' + o.quality + '</span></div>' +
                '<div class="stat"><span>HW DNA</span><span class="value ai">' + tier + ' · ' + score + '</span></div>' +
                '<div class="stat"><span>Modo Meta</span><span class="value ai">' + m.mode + '</span></div>' +
                '<div class="stat"><span>Cámara</span><span class="value">' + (this.cinematic.active ? '🎬 Autopiloto' : '🎮 Manual') + '</span></div>' +
                '<div class="stat"><span>Motor</span><span class="value ultra">' + (this.rendererStatus || (this.renderer.isWebGPU ? 'WebGPU Apex' : 'WebGL2')) + '</span></div>' +
                '<div class="stat"><span>Meshlets</span><span class="value meta">' + (this.renderer.isWebGPU ? (s.meshlets || 0) : 'N/D (WebGL2)') + '</span></div>' +
                '<div class="stat"><span>Trinity NN</span><span class="value ai">' + (this.trinityNeural ? this.trinityNeural.diagnostics().steps : 0) + ' pasos</span></div>' +
                '<div class="stat"><span>Cam/Suelo</span><span class="value">' + camDiag + '</span></div>' +
                '<div class="stat"><span>Sol</span><span class="value">' + lightDiag + '</span></div>';
        }

        // ============================================================
        // BUCLE PRINCIPAL
        // ============================================================
        start() {
            this.running = true;
            this.clock.last = performance.now();

            const loop = (now) => {
                if (!this.running) return;
                try {
                    const dt = Math.min((now - this.clock.last) / 1000, 0.05);
                    this.clock.last = now;
                    this.clock.elapsed = (now - this.clock.start) / 1000;
                    this.renderer.time = this.clock.elapsed;

                    if (this.worldAI) this.worldAI.update(dt);
                    if (this.climateEngine) this.climateEngine.update(dt, this.worldAI);
                    if (this.optimizerAI) this.optimizerAI.update(dt, this.stats.fps);
                    if (this.metaAI) this.metaAI.update(dt, this.stats.fps);
                    if (this.trinityNeural) this.trinityNeural.tick(dt);

                    this._applyEntityScale(this._aiEntityScale);
                    this._syncWeatherParticles();
                    if (this.particles) this.particles.update(dt);
                    if (this.physics) this.physics.step(dt);

                    this._updateCamera(dt);
                    this._updateSun(this.clock.elapsed);
                    this._cullVegetation(this.camera, dt);

                    if (this.wildlife && this.worldAI) this.wildlife.sync(this.worldAI, dt, this.camera);

                    if (this.worldAI) {
                        const base = this.worldAI.weather === 'tormenta' ? 0.16
                            : this.worldAI.weather === 'lluvia' ? 0.09 : 0.05;
                        // Modulate by Python's precomputed gust envelope (sum of
                        // incommensurate sine waves, data/hw_luts.json) so wind
                        // "breathes" instead of holding a flat magnitude — real
                        // per-frame lookup into a table Python actually produced,
                        // not just a JS Math.sin() dressed up as multi-language.
                        const curve = this.polyglot && this.polyglot.python.windGustCurve;
                        let gust = 1.0;
                        if (curve && curve.length) {
                            const t = (this.clock.elapsed * 0.12) % 1;
                            const idx = Math.floor(t * curve.length);
                            gust = curve[idx];
                        }
                        this.scene.windStrength = base * gust;
                    }

                    this.renderer.render(this.scene, this.camera);
                    if (this.particles && !this.renderer.isWebGPU) this.particles.render(this.camera, this._aiParticleScale);

                    // Runtime watchdog: render() can "succeed" (no thrown JS
                    // error, stats keep updating) while the GPU silently
                    // rejects every draw as invalid, which looks identical
                    // to a healthy engine except the canvas stays black.
                    // WebGPURenderer flags that state via `.failed` after
                    // enough consecutive validation errors — catch it here,
                    // not just at startup, and recover instead of leaving
                    // the person staring at a black screen indefinitely.
                    if (this.renderer.isWebGPU && this.renderer.failed && !this.renderer._fallbackInstalled) {
                        this._installWebGL2Fallback(this.renderer.failureReason || 'fallo de render WebGPU en tiempo de ejecución');
                    }

                    this.stats.frames++;
                    if (now - this.stats.lastFpsUpdate > 400) {
                        this.stats.fps = Math.round(this.stats.frames * 1000 / (now - this.stats.lastFpsUpdate));
                        this.stats.frames = 0;
                        this.stats.lastFpsUpdate = now;
                        this._updateHUD();
                    }
                    this._consecutiveFrameErrors = 0;
                } catch (err) {
                    // CRITICAL: an uncaught exception anywhere above used to
                    // propagate out of this callback, which means
                    // requestAnimationFrame(loop) below never ran again —
                    // the whole engine would silently stop on whatever the
                    // last successfully drawn frame was. That is *exactly*
                    // what "se congela" looks like from the outside: not a
                    // slowdown, a perfectly frozen frame with a live tab
                    // underneath. Catching here, logging, and continuing
                    // turns any remaining one-off bug into a visible
                    // console error instead of a dead engine.
                    this._consecutiveFrameErrors = (this._consecutiveFrameErrors || 0) + 1;
                    console.error('⚠️ Error en el frame (motor sigue vivo):', err);
                    if (this._consecutiveFrameErrors > 240) {
                        // ~4s of back-to-back failures at 60fps: something is
                        // truly broken every frame, not a one-off. Stop
                        // cleanly instead of spinning forever on a dead state.
                        console.error('💥 Demasiados errores consecutivos — deteniendo el loop.');
                        this.running = false;
                        return;
                    }
                }
                requestAnimationFrame(loop);
            };
            requestAnimationFrame(loop);
        }

        stop() { this.running = false; }

        // ============================================================
        // MÉTODOS PÚBLICOS
        // ============================================================
        getScene() { return this.scene; }
        getCamera() { return this.camera; }
        getRenderer() { return this.renderer; }
        getPhysics() { return this.physics; }
        getWorldAI() { return this.worldAI; }
        getOptimizerAI() { return this.optimizerAI; }
        getMetaAI() { return this.metaAI; }
        getParticles() { return this.particles; }
        getWildlife() { return this.wildlife; }
        getTerrainGen() { return this.terrainGen; }
        getTerrainMesh() { return this.terrainMesh; }
    }

    // ============================================================
    // EXPORTACIÓN
    // ============================================================
    window.PriomGL = window.PriomGL || {};
    window.PriomGL.PriomEngine = PriomEngine;
    window.PriomEngine = PriomEngine;

})();