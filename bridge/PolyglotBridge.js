/**
 * PriomGL PolyglotBridge — Fusión innovadora de lenguajes
 * ========================================================
 * Orquesta módulos escritos en paradigmas distintos:
 *   • JS     → orquestación, WebGL, ECS, UI
 *   • C++    → kernels de ruido, culling, partículas (ports JS hoy;
 *              listos para WASM mañana)
 *   • Python → reglas de decisión y LUTs pre-horneadas (embebidas)
 *   • Kotlin → políticas de calidad declarativas (espejo conceptual)
 *
 * Interacción "extraña": el Council de calidad hace votar a tres
 * "mentes" (JS heurística, reglas Python, hints de rendimiento C++)
 * y fusiona el resultado. El HardwareDNA es la lengua franca.
 *
 * Cero dependencias externas.
 */
(function (global) {
    'use strict';

    // ============================================================
    // C++-style kernels (ports puros JS, API idéntica al .hpp)
    // ============================================================
    const CppKernels = {
        hash2(x, z, seed) {
            const n = Math.sin(x * 127.1 + z * 311.7 + seed * 0.1) * 43758.5453123;
            return n - Math.floor(n);
        },
        valueNoise2(x, z, seed) {
            const ix = Math.floor(x), iz = Math.floor(z);
            const fx = x - ix, fz = z - iz;
            const ux = fx * fx * (3 - 2 * fx);
            const uz = fz * fz * (3 - 2 * fz);
            const a = this.hash2(ix, iz, seed);
            const b = this.hash2(ix + 1, iz, seed);
            const c = this.hash2(ix, iz + 1, seed);
            const d = this.hash2(ix + 1, iz + 1, seed);
            return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
        },
        fbm(x, z, octaves, seed) {
            let v = 0, a = 0.5, f = 1;
            for (let i = 0; i < octaves; i++) {
                v += a * this.valueNoise2(x * f, z * f, seed + i * 17.3);
                a *= 0.5;
                f *= 2.03;
            }
            return v;
        },
        ridged(x, z, octaves, seed) {
            let v = 0, a = 0.5, f = 1;
            for (let i = 0; i < octaves; i++) {
                const n = 1 - Math.abs(this.valueNoise2(x * f, z * f, seed + i * 31.1) * 2 - 1);
                v += a * n * n;
                a *= 0.5;
                f *= 2.1;
            }
            return v;
        },
        /**
         * Frustum cull masivo. aabbs: Float32Array de 6*count
         * planes: Float32Array de 4*nplanes
         * outMask: Uint8Array de count
         */
        frustumCullAABBs(aabbs, count, planes, nplanes, outMask) {
            for (let i = 0; i < count; i++) {
                const o = i * 6;
                const minx = aabbs[o], miny = aabbs[o + 1], minz = aabbs[o + 2];
                const maxx = aabbs[o + 3], maxy = aabbs[o + 4], maxz = aabbs[o + 5];
                let inside = 1;
                for (let p = 0; p < nplanes; p++) {
                    const po = p * 4;
                    const nx = planes[po], ny = planes[po + 1], nz = planes[po + 2], d = planes[po + 3];
                    const px = nx >= 0 ? minx : maxx;
                    const py = ny >= 0 ? miny : maxy;
                    const pz = nz >= 0 ? minz : maxz;
                    if (nx * px + ny * py + nz * pz + d < 0) { inside = 0; break; }
                }
                outMask[i] = inside;
            }
        },
        integrateParticles(pos, vel, count, dt, gravityY) {
            for (let i = 0; i < count; i++) {
                const o = i * 3;
                vel[o + 1] += gravityY * dt;
                pos[o]     += vel[o] * dt;
                pos[o + 1] += vel[o + 1] * dt;
                pos[o + 2] += vel[o + 2] * dt;
            }
        }
    };

    // ============================================================
    // Python-style rules (embebidas desde generate_hw_luts.py)
    // ============================================================
    // Estas tablas fueron generadas por Python puro (stdlib only)
    // y representan la "mente Python" del Council.
    const PythonRules = {
        // tier → multiplicadores de presupuesto
        tierBudget: {
            ultra:  { entities: 1.15, shadows: 1.2, post: 1.15, pixels: 1.0 },
            high:   { entities: 1.0,  shadows: 1.0, post: 1.0,  pixels: 0.95 },
            medium: { entities: 0.72, shadows: 0.7, post: 0.65, pixels: 0.85 },
            low:    { entities: 0.42, shadows: 0.4, post: 0.35, pixels: 0.7 },
            potato: { entities: 0.2,  shadows: 0.15,post: 0.15, pixels: 0.5 }
        },
        // score → bias de agresividad del optimizer
        aggressiveness(score) {
            if (score < 25) return 1.6;
            if (score < 40) return 1.3;
            if (score < 55) return 1.0;
            if (score < 70) return 0.75;
            return 0.55;
        },
        // Decisión de clima pesado (lluvia/tormenta) según carga
        allowHeavyWeather(score, currentLoad) {
            return score > 45 && currentLoad < 0.65;
        }
    };

    // ============================================================
    // Kotlin-style policy (espejo declarativo)
    // ============================================================
    // En un futuro se podría generar desde .kt; hoy es la "mente Kotlin".
    const KotlinPolicy = {
        name: 'QualityPolicy',
        preferFrameRateOverFidelity: true,
        mobileThermalGuard: true,
        maxCascadesForTier(tier) {
            const m = { ultra: 4, high: 4, medium: 3, low: 2, potato: 1 };
            return m[tier] || 2;
        },
        vote(dna, jsVote, pythonVote) {
            // Kotlin vota más conservador en móvil
            let v = (jsVote + pythonVote) * 0.5;
            if (dna.platform && dna.platform.isMobile) v *= 0.88;
            if (dna.tier === 'potato' || dna.tier === 'low') v *= 0.75;
            return Math.max(0.12, Math.min(1.2, v));
        },
        // Mirror of QualityPolicy.thermalBias(sustainedOverBudgetSeconds, isMobile)
        thermalBias(sustainedOverBudgetSeconds, isMobile) {
            if (!isMobile || !this.mobileThermalGuard) return 1.0;
            const t = Math.max(0, Math.min(12, sustainedOverBudgetSeconds)) / 12;
            return 1.0 - t * 0.45;
        }
    };

    // ============================================================
    // Bridge principal
    // ============================================================
    class PolyglotBridge {
        constructor() {
            this.cpp = CppKernels;
            this.python = PythonRules;
            this.kotlin = KotlinPolicy;
            this.dna = null;
            this._councilLog = [];
            this.pythonLive = false; // true once real data/hw_luts.json is loaded
            this.wasmLive = false;   // true once a compiled WASM kernel module is loaded
            this._overBudgetSeconds = 0; // EMA feeding KotlinPolicy.thermalBias
            this._lastCouncilAt = null;
        }

        /** Inyecta el HardwareDNA detectado */
        bindHardware(dna) {
            this.dna = dna;
            console.log('🌉 PolyglotBridge vinculado a HardwareDNA:', dna.tier, dna.score);
        }

        /**
         * Carga las tablas REALES generadas por `python/generate_hw_luts.py`
         * (data/hw_luts.json) y reemplaza las constantes embebidas de
         * `PythonRules` por los valores producidos por el intérprete Python
         * de verdad. Si el fetch falla (file://, offline, CORS), el motor
         * sigue funcionando con el espejo JS embebido — degradación
         * silenciosa, nunca un motor roto.
         */
        async loadPythonData(url = 'data/hw_luts.json') {
            try {
                const res = await fetch(url, { cache: 'no-cache' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                if (data.tier_budget) this.python.tierBudget = data.tier_budget;
                if (Array.isArray(data.aggressiveness_curve)) {
                    const curve = data.aggressiveness_curve
                        .slice().sort((a, b) => a.score - b.score);
                    this.python.aggressiveness = (score) => {
                        let out = curve[0].aggressiveness;
                        for (const pt of curve) {
                            if (score >= pt.score) out = pt.aggressiveness;
                            else break;
                        }
                        return out;
                    };
                }
                this.python.windGustCurve = data.wind_gust_curve || null;
                this.python.lodDistanceByTier = data.lod_distance_by_tier || null;
                this.python.shadowCascadeSplits = data.shadow_cascade_splits || null;
                this.python.maxCascadesByTier = data.max_cascades_by_tier || null;
                this.pythonLive = true;
                console.log('🐍 Python LUTs reales cargadas (data/hw_luts.json) v' + data.version);
                return data;
            } catch (err) {
                console.warn('🐍 No se pudo cargar data/hw_luts.json, usando espejo JS embebido:', err.message);
                this.pythonLive = false;
                return null;
            }
        }

        /**
         * Intenta cargar los kernels C++ compilados a WebAssembly
         * (native/wasm/priom_kernels.wasm, ver native/cpp/build_wasm.sh).
         * Si no existen (no se compiló con emcc) o el navegador no soporta
         * el feature usado, se mantiene el port JS de CppKernels sin que el
         * resto del motor note la diferencia — misma API en ambos casos.
         */
        async loadWasmKernels(url = 'native/wasm/priom_kernels.wasm') {
            if (typeof WebAssembly === 'undefined') return false;
            try {
                const res = await fetch(url, { cache: 'no-cache' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const bytes = await res.arrayBuffer();
                const memory = new WebAssembly.Memory({ initial: 16, maximum: 256 });
                const { instance } = await WebAssembly.instantiate(bytes, {
                    env: { memory, emscripten_notify_memory_growth() {} }
                });
                const exp = instance.exports;
                if (exp.fbm_noise2 && exp.ridged_noise2) {
                    this.cpp.fbm = (x, z, oct = 5, seed = 42) => exp.fbm_noise2(x, z, oct, seed);
                    this.cpp.ridged = (x, z, oct = 4, seed = 42) => exp.ridged_noise2(x, z, oct, seed);
                    this.noise.fbm = this.cpp.fbm;
                    this.noise.ridged = this.cpp.ridged;
                }
                this.wasmLive = true;
                console.log('⚙️ Kernels C++ (WASM) activos:', url);
                return true;
            } catch (err) {
                this.wasmLive = false;
                console.log('⚙️ Sin WASM compilado (usando port JS de PriomKernels.hpp):', err.message);
                return false;
            }
        }


        async loadCoreWasm(url = 'native/wasm/priom_core.wasm') {
            if (typeof WebAssembly === 'undefined') return false;
            try {
                const res = await fetch(url, { cache: 'no-cache' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const bytes = await res.arrayBuffer();
                const { instance } = await WebAssembly.instantiate(bytes, {});
                const exp = instance.exports;
                if (exp.priom_fbm) this.cpp.fbm = (x,z,o=5,seed=42)=>exp.priom_fbm(x,z,o,seed);
                if (exp.priom_hash) this.cpp.hash2 = (x,z,seed=42)=>exp.priom_hash(x,z,seed);
                this.coreWasmLive = true;
                console.log('🧠 C++20 Native Core WASM activo:', url);
                return true;
            } catch(err) {
                this.coreWasmLive = false;
                console.log('🧠 Native Core WASM no disponible; fallback JS activo:', err.message);
                return false;
            }
        }

        /**
         * Council de calidad — las tres "mentes" votan.
         * jsBaseQuality: valor propuesto por OptimizerAI (0.2–1.2)
         * load: presión de carga actual 0–1
         * Devuelve calidad fusionada y razonamiento.
         */
        councilDecide(jsBaseQuality, load) {
            if (!this.dna) {
                return { quality: jsBaseQuality, reason: 'sin DNA', votes: {} };
            }
            const tier = this.dna.tier;
            const score = this.dna.score;
            const isMobile = !!(this.dna.platform && this.dna.platform.isMobile);

            // Track sustained load (EMA in seconds) so Kotlin's thermal
            // guard has real history instead of a single instantaneous
            // sample — a one-frame spike shouldn't tank quality, but
            // several seconds of load > 0.85 should.
            const now = performance.now();
            const dt = this._lastCouncilAt != null ? Math.min(0.5, (now - this._lastCouncilAt) / 1000) : 0;
            this._lastCouncilAt = now;
            if (load > 0.85) this._overBudgetSeconds = Math.min(12, this._overBudgetSeconds + dt);
            else this._overBudgetSeconds = Math.max(0, this._overBudgetSeconds - dt * 1.5);

            const pyMult = this.python.tierBudget[tier] || this.python.tierBudget.medium;
            const pyVote = jsBaseQuality * pyMult.entities * (1 - load * 0.35);
            const agg = this.python.aggressiveness(score);
            const jsVote = jsBaseQuality * (1 - load * 0.25 * agg);
            const thermal = this.kotlin.thermalBias(this._overBudgetSeconds, isMobile);
            const fused = this.kotlin.vote(this.dna, jsVote, pyVote) * thermal;

            const result = {
                quality: +fused.toFixed(3),
                entityScale: +(fused * pyMult.entities).toFixed(3),
                shadowScale: +pyMult.shadows.toFixed(3),
                postScale: +pyMult.post.toFixed(3),
                pixelScale: +pyMult.pixels.toFixed(3),
                reason: `JS=${jsVote.toFixed(2)} PY=${pyVote.toFixed(2)} KT→${fused.toFixed(2)} (thermal×${thermal.toFixed(2)}) [${tier}]`,
                votes: { js: jsVote, python: pyVote, kotlin: fused, thermal }
            };
            this._councilLog.push({ t: now, ...result });
            if (this._councilLog.length > 60) this._councilLog.shift();
            return result;
        }

        /** Acceso unificado a ruido (C++ style) */
        noise = {
            fbm: (x, z, oct = 5, seed = 42) => CppKernels.fbm(x, z, oct, seed),
            ridged: (x, z, oct = 4, seed = 42) => CppKernels.ridged(x, z, oct, seed)
        };

        cullAABBs(aabbs, count, planes, nplanes, outMask) {
            return CppKernels.frustumCullAABBs(aabbs, count, planes, nplanes, outMask);
        }

        stepParticles(pos, vel, count, dt, gravityY = -9.8) {
            return CppKernels.integrateParticles(pos, vel, count, dt, gravityY);
        }

        get recommendations() {
            return this.dna ? this.dna.recommendations : null;
        }

        get lastCouncil() {
            return this._councilLog[this._councilLog.length - 1] || null;
        }
    }

    global.PriomPolyglot = global.PriomPolyglot || {};
    global.PriomPolyglot.Bridge = PolyglotBridge;
    global.PriomPolyglot.CppKernels = CppKernels;
})(window);
