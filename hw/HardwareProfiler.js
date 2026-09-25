/**
 * PriomGL HardwareProfiler — Autodetección profunda de hardware
 * Puro JS, sin dependencias. Genera un "HardwareDNA" que todos los
 * módulos (JS, C++-style kernels, reglas Python embebidas) consultan.
 *
 * Innovación: combina señales estáticas (navigator, WebGL) con
 * micro-benchmarks reales de GPU/CPU para clasificar el dispositivo
 * en tiers y producir un perfil de calidad accionable.
 */
(function (global) {
    'use strict';

    class HardwareProfiler {
        constructor() {
            this.dna = null;
            this._benchMs = 0;
        }

        /**
         * Ejecuta el perfil completo. Debe llamarse una vez al inicio,
         * preferiblemente antes de crear el renderer pesado.
         */
        async profile(canvas) {
            const t0 = performance.now();
            // IMPORTANT: never create a WebGL context on the main canvas here.
            // WebGPU and WebGL are mutually exclusive canvas context types in
            // browsers; probing WebGL first permanently prevents
            // canvas.getContext('webgpu') later. Apex 4.0 accidentally did
            // exactly that, forcing the renderer into a fallback (and, because
            // the async WebGPU renderer had not built its water geometry yet,
            // could leave the scene black). All capability probes use an
            // isolated scratch canvas instead.
            const probeCanvas = this._makeProbeCanvas();
            const dna = {
                version: 4,
                timestamp: Date.now(),
                platform: this._detectPlatform(),
                cpu: this._detectCPU(),
                memory: this._detectMemory(),
                gpu: await this._detectGPU(probeCanvas),
                webgl: this._detectWebGLCaps(probeCanvas),
                display: this._detectDisplay(),
                bench: null,
                tier: 'medium',
                score: 50,
                recommendations: {}
            };

            // Micro-benchmark síncrono (rápido, ~30-80ms)
            dna.bench = this._runMicroBench(probeCanvas, dna);
            this._scoreAndRecommend(dna);

            this._benchMs = performance.now() - t0;
            this.dna = dna;
            console.log(`🧬 HardwareDNA listo en ${this._benchMs.toFixed(1)}ms → tier=${dna.tier} score=${dna.score}`);
            return dna;
        }

        _makeProbeCanvas() {
            // OffscreenCanvas is ideal when available; a tiny DOM canvas is
            // the compatibility fallback. Neither touches the render canvas.
            try {
                if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(64, 64);
            } catch (_) {}
            const c = document.createElement('canvas');
            c.width = 64; c.height = 64;
            return c;
        }

        _detectPlatform() {
            const ua = navigator.userAgent || '';
            const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ||
                (navigator.maxTouchPoints > 1 && /Mac/.test(ua) === false);
            const isIOS = /iPhone|iPad|iPod/i.test(ua);
            const isAndroid = /Android/i.test(ua);
            return {
                isMobile,
                isIOS,
                isAndroid,
                isDesktop: !isMobile,
                touch: navigator.maxTouchPoints || 0,
                language: navigator.language || 'en',
                coresHint: navigator.hardwareConcurrency || 4
            };
        }

        _detectCPU() {
            const cores = navigator.hardwareConcurrency || 4;
            // Heurística simple de "potencia" relativa
            let power = Math.min(10, Math.max(1, cores));
            if (this._isLowEndUA()) power = Math.max(1, power - 2);
            return { cores, power };
        }

        _detectMemory() {
            // deviceMemory es experimental pero útil cuando existe
            const gb = navigator.deviceMemory || 4;
            return {
                deviceMemoryGB: gb,
                jsHeapLimitMB: (performance.memory && performance.memory.jsHeapSizeLimit)
                    ? Math.round(performance.memory.jsHeapSizeLimit / 1048576) : null
            };
        }

        async _detectGPU(canvas) {
            const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' }) ||
                       canvas.getContext('webgl');
            let vendor = 'unknown', renderer = 'unknown', unmasked = null;
            if (gl) {
                const dbg = gl.getExtension('WEBGL_debug_renderer_info');
                if (dbg) {
                    vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || vendor;
                    renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || renderer;
                    unmasked = { vendor, renderer };
                } else {
                    vendor = gl.getParameter(gl.VENDOR) || vendor;
                    renderer = gl.getParameter(gl.RENDERER) || renderer;
                }
            }
            const family = this._classifyGPU(renderer, vendor);
            return { vendor, renderer, unmasked, family };
        }

        _classifyGPU(renderer, vendor) {
            const r = (renderer || '').toLowerCase();
            const v = (vendor || '').toLowerCase();
            // Móviles
            if (/adreno/.test(r)) {
                if (/7[3-9]0|8\d{2}/.test(r)) return 'mobile-high';
                if (/6\d{2}|5[4-9]0/.test(r)) return 'mobile-mid';
                return 'mobile-low';
            }
            if (/mali/.test(r)) {
                if (/g7[1-9]|g78|g710|g610/.test(r)) return 'mobile-high';
                if (/g5[2-7]|g68/.test(r)) return 'mobile-mid';
                return 'mobile-low';
            }
            if (/apple\s*gpu|a1[5-9]|a2\d|m[1-3]/.test(r)) return 'mobile-high';
            if (/powervr|sgx/.test(r)) return 'mobile-low';
            // Desktop
            if (/nvidia|geforce|rtx|gtx|quadro/.test(r) || /nvidia/.test(v)) {
                if (/rtx\s*4\d|rtx\s*3[0-9]|rtx\s*20/.test(r)) return 'desktop-ultra';
                if (/gtx\s*16|gtx\s*10|rtx/.test(r)) return 'desktop-high';
                return 'desktop-mid';
            }
            if (/amd|radeon|rx\s*[5-7]|vega/.test(r) || /ati|amd/.test(v)) {
                if (/rx\s*6|rx\s*7|rx\s*680|rx\s*790/.test(r)) return 'desktop-ultra';
                return 'desktop-high';
            }
            if (/intel.*uhd|intel.*iris|intel.*hd/.test(r)) return 'desktop-low';
            if (/swiftshader|llvmpipe|software/.test(r)) return 'software';
            return 'unknown';
        }

        _detectWebGLCaps(canvas) {
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) return { version: 0 };
            const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
            const aniso = gl.getExtension('EXT_texture_filter_anisotropic') ||
                          gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
            const maxAniso = aniso ? gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
            return {
                version: isWebGL2 ? 2 : 1,
                maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
                maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
                maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
                maxTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
                maxAnisotropy: maxAniso,
                floatTextures: !!(gl.getExtension('OES_texture_float') || isWebGL2),
                colorBufferFloat: !!(gl.getExtension('EXT_color_buffer_float') || (isWebGL2 && gl.getExtension('EXT_color_buffer_float'))),
                instancedArrays: isWebGL2 || !!gl.getExtension('ANGLE_instanced_arrays'),
                drawBuffers: isWebGL2 || !!gl.getExtension('WEBGL_draw_buffers'),
                depthTexture: isWebGL2 || !!gl.getExtension('WEBGL_depth_texture')
            };
        }

        _detectDisplay() {
            const dpr = window.devicePixelRatio || 1;
            return {
                width: window.screen.width,
                height: window.screen.height,
                availWidth: window.screen.availWidth,
                dpr,
                highRefresh: (window.screen.refreshRate || 60) >= 90
            };
        }

        _isLowEndUA() {
            const ua = navigator.userAgent || '';
            return /Android [1-7]\.|iPhone OS [1-9]_|iPhone OS 1[0-2]_/.test(ua);
        }

        /**
         * Micro-benchmark: dibuja una cantidad fija de puntos/triángulos
         * y mide tiempo. No requiere el renderer completo.
         */
        _runMicroBench(canvas, dna) {
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) return { cpuMs: 999, gpuMs: 999, score: 0 };

            const vsSrc = `#version 300 es
                in vec2 a; void main(){ gl_Position=vec4(a,0.,1.); gl_PointSize=2.0; }`;
            const fsSrc = `#version 300 es
                precision mediump float; out vec4 c; void main(){ c=vec4(0.2,0.6,1.0,1.0); }`;

            // Fallback WebGL1 simple si no hay 2
            let prog, buf, is2 = true;
            try {
                if (!(gl instanceof WebGL2RenderingContext)) {
                    is2 = false;
                }
                const vs = gl.createShader(is2 ? gl.VERTEX_SHADER : gl.VERTEX_SHADER);
                // Usamos siempre GLSL ES 1.0 style para máxima compat
                const vs1 = 'attribute vec2 a; void main(){ gl_Position=vec4(a,0.,1.); gl_PointSize=2.0; }';
                const fs1 = 'precision mediump float; void main(){ gl_FragColor=vec4(0.2,0.6,1.0,1.0); }';
                const vsh = gl.createShader(gl.VERTEX_SHADER);
                gl.shaderSource(vsh, vs1);
                gl.compileShader(vsh);
                const fsh = gl.createShader(gl.FRAGMENT_SHADER);
                gl.shaderSource(fsh, fs1);
                gl.compileShader(fsh);
                prog = gl.createProgram();
                gl.attachShader(prog, vsh);
                gl.attachShader(prog, fsh);
                gl.linkProgram(prog);
                gl.useProgram(prog);

                const N = 12000;
                const data = new Float32Array(N * 2);
                for (let i = 0; i < N * 2; i++) data[i] = Math.random() * 2 - 1;
                buf = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
                const loc = gl.getAttribLocation(prog, 'a');
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

                // Warmup
                gl.viewport(0, 0, 64, 64);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.drawArrays(gl.POINTS, 0, N);
                gl.finish();

                const t0 = performance.now();
                for (let i = 0; i < 8; i++) {
                    gl.clear(gl.COLOR_BUFFER_BIT);
                    gl.drawArrays(gl.POINTS, 0, N);
                }
                gl.finish();
                const gpuMs = (performance.now() - t0) / 8;

                // CPU noise-ish bench
                const t1 = performance.now();
                let acc = 0;
                for (let i = 0; i < 80000; i++) {
                    acc += Math.sin(i * 0.017) * Math.cos(i * 0.031);
                }
                const cpuMs = performance.now() - t1;
                if (acc === Infinity) console.log(''); // prevent DCE

                gl.deleteBuffer(buf);
                gl.deleteProgram(prog);

                // Score 0-100 (más bajo tiempo = mejor)
                const gpuScore = Math.max(0, 100 - gpuMs * 8);
                const cpuScore = Math.max(0, 100 - cpuMs * 1.2);
                return {
                    gpuMs: +gpuMs.toFixed(2),
                    cpuMs: +cpuMs.toFixed(2),
                    gpuScore: +gpuScore.toFixed(1),
                    cpuScore: +cpuScore.toFixed(1),
                    composite: +((gpuScore * 0.65 + cpuScore * 0.35)).toFixed(1)
                };
            } catch (e) {
                console.warn('MicroBench falló:', e);
                return { cpuMs: 50, gpuMs: 50, score: 30, error: String(e) };
            }
        }

        _scoreAndRecommend(dna) {
            let score = 50;
            const { platform, cpu, memory, gpu, webgl, bench, display } = dna;

            // GPU family
            const fam = gpu.family || 'unknown';
            if (fam === 'desktop-ultra') score += 35;
            else if (fam === 'desktop-high') score += 25;
            else if (fam === 'desktop-mid') score += 12;
            else if (fam === 'desktop-low') score -= 5;
            else if (fam === 'mobile-high') score += 15;
            else if (fam === 'mobile-mid') score += 5;
            else if (fam === 'mobile-low') score -= 15;
            else if (fam === 'software') score -= 40;

            // Bench
            if (bench && bench.composite != null) {
                score = score * 0.45 + bench.composite * 0.55;
            }

            // Memory & cores
            if (memory.deviceMemoryGB >= 8) score += 8;
            else if (memory.deviceMemoryGB <= 2) score -= 12;
            if (cpu.cores >= 8) score += 6;
            else if (cpu.cores <= 2) score -= 8;

            // Mobile penalty (térmica + batería)
            if (platform.isMobile) score -= 10;
            if (platform.isIOS && /iPhone (8|X|1[0-2])/.test(navigator.userAgent)) score -= 5;

            // WebGL2 bonus
            if (webgl.version >= 2) score += 5;
            if (webgl.maxTextureSize >= 8192) score += 3;

            score = Math.max(5, Math.min(98, Math.round(score)));
            dna.score = score;

            // Tier
            if (score >= 78) dna.tier = 'ultra';
            else if (score >= 62) dna.tier = 'high';
            else if (score >= 42) dna.tier = 'medium';
            else if (score >= 25) dna.tier = 'low';
            else dna.tier = 'potato';

            // Recomendaciones concretas para el motor
            const rec = {
                maxPixelRatio: platform.isMobile
                    ? (score > 55 ? 1.25 : score > 35 ? 1.0 : 0.75)
                    : (score > 70 ? 1.75 : score > 50 ? 1.4 : 1.1),
                shadowCascades: score > 65 ? 4 : score > 40 ? 3 : 2,
                shadowMapSize: score > 70 ? 2048 : score > 45 ? 1024 : 512,
                ssao: score > 48,
                bloom: score > 40,
                entityScale: score > 70 ? 1.0 : score > 50 ? 0.75 : score > 30 ? 0.45 : 0.22,
                treeBudget: platform.isMobile
                    ? (score > 50 ? 480 : score > 30 ? 280 : 140)
                    : (score > 65 ? 1600 : score > 45 ? 900 : 450),
                rockBudget: platform.isMobile
                    ? (score > 50 ? 120 : 70)
                    : (score > 65 ? 480 : 260),
                terrainSegments: platform.isMobile
                    ? (score > 50 ? 128 : 96)
                    : (score > 65 ? 192 : 144),
                targetFPS: platform.isMobile ? (score > 45 ? 40 : 30) : (score > 60 ? 55 : 45),
                postQuality: score > 55 ? 1.0 : score > 35 ? 0.6 : 0.3,
                useAnisotropy: webgl.maxAnisotropy > 1 && score > 40
            };
            dna.recommendations = rec;
        }

        getDNA() { return this.dna; }

        /** Resumen legible para HUD */
        summary() {
            if (!this.dna) return 'Sin perfil';
            const d = this.dna;
            return `${d.tier.toUpperCase()} (${d.score}) · ${d.gpu.family} · ${d.platform.isMobile ? 'móvil' : 'desktop'}`;
        }
    }

    global.PriomHW = global.PriomHW || {};
    global.PriomHW.HardwareProfiler = HardwareProfiler;
})(window);
