/**
 * PriomGL OptimizerAI v3 — Sistema de Optimización Predictiva y Adaptativa
 * 
 * Sistema de inteligencia de rendimiento que equilibra calidad visual y FPS
 * de forma proactiva. Utiliza predicción de carga, perfilado de hardware
 * y optimización por capas para mantener una experiencia fluida.
 * 
 * Características:
 * - Predicción de carga basada en tendencias y eventos
 * - Optimización por capas (priorizando impacto visual)
 * - Perfilado de GPU/CPU en tiempo real
 * - Modos de calidad adaptativa
 * - Memoria de largo plazo
 * - API pública para control manual
 */
(function(global) {
    'use strict';

    class OptimizerAI {
        constructor(engine) {
            this.engine = engine;
            
            // Configuración de objetivos — v4 Quantum: prioriza FPS jugable
            this.targetFPS = this.engine && this.engine.isMobile ? 42 : 55;
            this.minFPS = this.engine && this.engine.isMobile ? 22 : 28;
            this.maxQuality = 1.15;
            this.minQuality = 0.18;
            
            // Estado actual de calidad (0.3 - 1.2)
            this.quality = 1.0;
            this.shadowQuality = 1.0;
            this.particleMultiplier = 1.0;
            this.entityMultiplier = 1.0;
            this.pixelRatioScale = 1.0;
            this.textureQuality = 1.0;
            this.postProcessQuality = 1.0;
            
            // Historial de rendimiento
            this.history = [];
            this.maxHistory = 300; // 5 minutos a 60fps
            this.performanceLog = [];
            this.maxLogEntries = 1000;
            
            // Estado interno
            this.cooldown = 0;
            this.adjustments = 0;
            this.lastAction = 'none';
            this.thermalPressure = 0;
            this.learningRate = 0.08;
            this.convergenceCount = 0;
            this.sessionStart = performance.now();
            
            // Perfil de hardware
            this.hardwareProfile = {
                gpuScore: 0,
                cpuScore: 0,
                memoryScore: 0,
                estimatedTier: 'medium',
                deviceType: 'desktop'
            };
            
            // Modos de calidad predefinidos
            this.modes = {
                ultra: {
                    quality: 1.2,
                    shadows: 1.2,
                    particles: 1.3,
                    entities: 1.2,
                    pixelRatio: 1.0,
                    textureQuality: 1.2,
                    postProcess: 1.2,
                    ssao: true,
                    bloom: true
                },
                high: {
                    quality: 1.0,
                    shadows: 1.0,
                    particles: 1.0,
                    entities: 1.0,
                    pixelRatio: 1.0,
                    textureQuality: 1.0,
                    postProcess: 1.0,
                    ssao: true,
                    bloom: true
                },
                balanced: {
                    quality: 0.8,
                    shadows: 0.7,
                    particles: 0.7,
                    entities: 0.8,
                    pixelRatio: 0.9,
                    textureQuality: 0.8,
                    postProcess: 0.7,
                    ssao: true,
                    bloom: true
                },
                performance: {
                    quality: 0.48,
                    shadows: 0.28,
                    particles: 0.28,
                    entities: 0.38,
                    pixelRatio: 0.62,
                    textureQuality: 0.5,
                    postProcess: 0.3,
                    ssao: false,
                    bloom: false
                },
                powersaver: {
                    quality: 0.22,
                    shadows: 0.12,
                    particles: 0.12,
                    entities: 0.18,
                    pixelRatio: 0.45,
                    textureQuality: 0.35,
                    postProcess: 0.15,
                    ssao: false,
                    bloom: false
                }
            };
            
            // Perfil de la sesión actual
            this.sessionProfile = {
                avgFPS: 60,
                minFPS: 60,
                maxFPS: 60,
                samples: 0,
                stability: 1.0,
                qualityHistory: []
            };
            
            // Inicialización
            this._initHardwareProfile();
            this._initMode();
        }

        /**
         * Actualización principal del OptimizerAI
         * @param {number} dt - Delta time en segundos
         * @param {number} currentFPS - FPS actual
         */
        update(dt, currentFPS) {
            this.cooldown = Math.max(0, this.cooldown - dt);
            this.history.push({ fps: currentFPS, timestamp: performance.now() });
            if (this.history.length > this.maxHistory) this.history.shift();

            // Actualizar perfil de sesión
            this.sessionProfile.samples++;
            this.sessionProfile.avgFPS += (currentFPS - this.sessionProfile.avgFPS) * 0.05;
            this.sessionProfile.minFPS = Math.min(this.sessionProfile.minFPS, currentFPS);
            this.sessionProfile.maxFPS = Math.max(this.sessionProfile.maxFPS, currentFPS);
            
            // Calcular estabilidad (varianza)
            const recent = this._getRecentHistory(30);
            if (recent.length > 10) {
                const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
                const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
                this.sessionProfile.stability = Math.max(0, 1 - Math.sqrt(variance) / 30);
            }

            // Si está en cooldown, solo actualizar estadísticas
            if (this.cooldown > 0) {
                this._applyToEngine();
                return;
            }

            // Decidir acción basada en rendimiento actual y predicciones
            const avgFPS = this._recentAvg(30);
            const ratio = avgFPS / this.targetFPS;
            const loadPressure = this._calculateLoadPressure();
            const predictedLoad = this._predictLoad();
            
            // Decisión: degradar o mejorar — v4 mucho más reactivo
            if (ratio < 0.28 || avgFPS < 12) {
                // EMERGENCIA: salto directo a powersaver
                this._setMode('powersaver');
                this.lastAction = 'degrade_emergency';
                this.cooldown = 0.6;
            } else if (ratio < 0.55 || predictedLoad > 0.75 || avgFPS < this.minFPS) {
                // Degradación dura + posible modo performance
                this._degrade(0.22);
                if (avgFPS < 18) this._setMode('performance');
                this.lastAction = 'degrade_hard';
                this.cooldown = 1.1;
            } else if (ratio < 0.78 || predictedLoad > 0.58) {
                this._degrade(0.11);
                this.lastAction = 'degrade_soft';
                this.cooldown = 1.0;
            } else if (ratio > 1.15 && this.quality < this.maxQuality && this.sessionProfile.stability > 0.72) {
                this._upgrade(0.05);
                this.lastAction = 'upgrade';
                this.cooldown = 3.5;
            } else if (ratio > 1.28 && this.quality < this.maxQuality) {
                this._upgrade(0.09);
                this.lastAction = 'upgrade_quick';
                this.cooldown = 2.0;
            } else {
                this.lastAction = 'stable';
                // Ajuste fino: si estable, pequeñas correcciones
                this._fineTune();
            }

            // Aplicar cambios al motor
            this._applyToEngine();
            
            // Registrar ajuste
            if (this.lastAction !== 'stable') {
                this.adjustments++;
                this._logPerformance();
            }
            
            // Actualizar termal pressure (simulado)
            this.thermalPressure = Math.max(0, this.thermalPressure - dt * 0.02);
            if (this.lastAction.startsWith('degrade')) {
                this.thermalPressure = Math.min(1, this.thermalPressure + 0.05 * dt);
            }
            
            // Convergencia: si estamos estables por un tiempo, reducir learning rate
            if (this.lastAction === 'stable' && this.sessionProfile.stability > 0.8) {
                this.convergenceCount++;
                if (this.convergenceCount > 30) {
                    this.learningRate = Math.max(0.02, this.learningRate - 0.001);
                }
            } else {
                this.convergenceCount = 0;
                this.learningRate = Math.min(0.15, this.learningRate + 0.001);
            }
        }

        /**
         * Inicializa el perfil de hardware del dispositivo
         */
        _initHardwareProfile() {
            const gl = this.engine.renderer?.gl;
            if (!gl) return;

            let gpuScore = 0;
            let cpuScore = 0;
            let memoryScore = 0;

            // Evaluar GPU por extensiones
            const extensions = gl.getSupportedExtensions() || [];
            if (extensions.includes('EXT_color_buffer_float')) gpuScore += 2;
            if (extensions.includes('OES_texture_float_linear')) gpuScore += 2;
            if (extensions.includes('WEBGL_draw_buffers')) gpuScore += 1;
            if (extensions.includes('WEBGL_multi_draw')) gpuScore += 2;
            if (extensions.includes('WEBGL_compressed_texture_s3tc')) gpuScore += 1;
            if (extensions.includes('WEBGL_compressed_texture_astc')) gpuScore += 1;

            // Límites de renderizado
            const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            if (maxTextureSize >= 16384) gpuScore += 2;
            else if (maxTextureSize >= 8192) gpuScore += 1;

            // Evaluar CPU por capacidad de cálculo
            const maxVertexAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
            if (maxVertexAttribs >= 16) cpuScore += 2;
            else if (maxVertexAttribs >= 8) cpuScore += 1;

            // Memoria estimada
            const pixelCount = window.screen.width * window.screen.height;
            if (pixelCount > 4000000) memoryScore += 2;
            else if (pixelCount > 2000000) memoryScore += 1;

            // Determinar tier
            const totalScore = gpuScore + cpuScore + memoryScore;
            let tier = 'medium';
            if (totalScore >= 8) tier = 'ultra';
            else if (totalScore >= 5) tier = 'high';
            else if (totalScore >= 3) tier = 'medium';
            else tier = 'low';

            this.hardwareProfile = {
                gpuScore,
                cpuScore,
                memoryScore,
                estimatedTier: tier,
                deviceType: /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
                maxTextureSize
            };

            console.log(`%c🔧 [OptimizerAI] Hardware: ${tier} (GPU:${gpuScore}, CPU:${cpuScore}, Mem:${memoryScore})`, 'color:#34d399');
        }

        /**
         * Inicializa el modo de calidad basado en hardware
         */
        _initMode() {
            const tier = this.hardwareProfile.estimatedTier;
            const device = this.hardwareProfile.deviceType;
            
            let mode = 'balanced';
            if (device === 'mobile') {
                mode = tier === 'ultra' ? 'high' : 'performance';
            } else {
                mode = tier === 'ultra' ? 'ultra' : tier === 'high' ? 'high' : 'balanced';
            }
            
            this._setMode(mode);
            console.log(`%c🎯 [OptimizerAI] Modo inicial: ${mode.toUpperCase()}`, 'color:#34d399');
        }

        /**
         * Establece un modo de calidad predefinido
         */
        _setMode(mode) {
            const m = this.modes[mode];
            if (!m) return;
            
            this.quality = m.quality;
            this.shadowQuality = m.shadows;
            this.particleMultiplier = m.particles;
            this.entityMultiplier = m.entities;
            this.pixelRatioScale = m.pixelRatio;
            this.textureQuality = m.textureQuality;
            this.postProcessQuality = m.postProcess;
            
            // Aplicar inmediatamente
            this._applyToEngine();
            
            this._logPerformance(`Modo ${mode.toUpperCase()} aplicado`);
        }

        /**
         * Degrada la calidad (reduce rendimiento)
         */
        _degrade(amount) {
            // Degradación por capas: primero partículas, luego sombras, luego geometría
            const layerAmount = amount * 1.2;
            
            // Capa 1: Partículas
            this.particleMultiplier = Math.max(0.08, this.particleMultiplier - layerAmount * 1.7);
            
            // Capa 2: Sombras
            this.shadowQuality = Math.max(0.1, this.shadowQuality - layerAmount * 1.35);
            
            // Capa 3: Calidad general
            this.quality = Math.max(this.minQuality, this.quality - amount);
            
            // Capa 4: Geometría — más agresiva desde antes
            if (this.quality < 0.72) {
                this.entityMultiplier = Math.max(0.15, this.entityMultiplier - amount * 1.15);
            }
            
            // Capa 5: Resolución
            if (this.quality < 0.55) {
                this.pixelRatioScale = Math.max(0.4, this.pixelRatioScale - amount * 0.55);
            }
            
            // Capa 6: Post-process
            if (this.quality < 0.7) {
                this.postProcessQuality = Math.max(0.12, this.postProcessQuality - amount * 1.1);
            }
        }

        /**
         * Mejora la calidad (aumenta rendimiento)
         */
        _upgrade(amount) {
            // Mejora inversa de capas: primero resolución, luego geometría, etc
            const layerAmount = amount * 0.8;
            
            // Capa 1: Resolución (más impacto visual)
            this.pixelRatioScale = Math.min(1.0, this.pixelRatioScale + layerAmount * 0.5);
            
            // Capa 2: Geometría
            this.entityMultiplier = Math.min(1.2, this.entityMultiplier + layerAmount * 0.8);
            
            // Capa 3: Calidad general
            this.quality = Math.min(this.maxQuality, this.quality + amount);
            
            // Capa 4: Post-process
            this.postProcessQuality = Math.min(1.2, this.postProcessQuality + amount * 0.5);
            
            // Capa 5: Sombras
            this.shadowQuality = Math.min(1.2, this.shadowQuality + amount);
            
            // Capa 6: Partículas (último)
            this.particleMultiplier = Math.min(1.3, this.particleMultiplier + amount * 1.2);
        }

        /**
         * Ajuste fino cuando el rendimiento es estable
         */
        _fineTune() {
            // Pequeños ajustes para optimizar calidad sin comprometer FPS
            const headroom = this._recentAvg(10) - this.targetFPS;
            if (headroom > 8 && this.quality < this.maxQuality) {
                // Subir calidad lentamente
                this.quality = Math.min(this.maxQuality, this.quality + 0.01);
                this.shadowQuality = Math.min(1.2, this.shadowQuality + 0.01);
                this.particleMultiplier = Math.min(1.3, this.particleMultiplier + 0.015);
            } else if (headroom < -5 && this.quality > this.minQuality) {
                // Bajar calidad lentamente
                this.quality = Math.max(this.minQuality, this.quality - 0.01);
                this.shadowQuality = Math.max(0.2, this.shadowQuality - 0.01);
                this.particleMultiplier = Math.max(0.15, this.particleMultiplier - 0.015);
            }
        }

        /**
         * Calcula la presión de carga actual
         */
        _calculateLoadPressure() {
            const avg = this._recentAvg(20);
            return Math.max(0, 1 - avg / this.targetFPS);
        }

        /**
         * Predice la carga futura basada en tendencias
         */
        _predictLoad() {
            const recent = this.history.slice(-60);
            if (recent.length < 20) return 0.5;

            // Calcular tendencia
            const values = recent.map(h => h.fps);
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            const trend = values[values.length - 1] - values[0];
            
            // Predicción simple: si la tendencia es negativa, carga futura mayor
            let predictedLoad = 0.5;
            if (trend < -5) predictedLoad += 0.2;
            else if (trend > 5) predictedLoad -= 0.15;
            
            // Factor de estabilidad
            const stability = this.sessionProfile.stability;
            if (stability < 0.5) predictedLoad += 0.15; // Inestable -> más carga
            else if (stability > 0.8) predictedLoad -= 0.1;
            
            return Math.max(0, Math.min(1, predictedLoad));
        }

        /**
         * Obtiene historial reciente de FPS
         */
        _recentAvg(n) {
            const slice = this.history.slice(-n);
            if (!slice.length) return 60;
            return slice.reduce((a, b) => a + b.fps, 0) / slice.length;
        }

        /**
         * Obtiene historial reciente como array de valores
         */
        _getRecentHistory(n) {
            return this.history.slice(-n).map(h => h.fps);
        }

        /**
         * Aplica la configuración actual al motor
         */
        _applyToEngine() {
            const r = this.engine.renderer;
            if (!r) return;

            // --- Council políglota (JS + Python rules + Kotlin policy) ---
            let entityScale = this.entityMultiplier;
            let shadowScale = this.shadowQuality;
            let postScale = this.postProcessQuality;
            let pixelScale = this.pixelRatioScale;
            if (this.engine.polyglot && this.engine.polyglot.councilDecide) {
                const load = this._calculateLoadPressure ? this._calculateLoadPressure() : 0.4;
                const decision = this.engine.polyglot.councilDecide(this.quality, load);
                entityScale = decision.entityScale;
                shadowScale = Math.min(shadowScale, decision.shadowScale);
                postScale = Math.min(postScale, decision.postScale);
                pixelScale = Math.min(pixelScale, decision.pixelScale);
                this._lastCouncil = decision;
            }

            // Resolución dinámica
            const basePR = Math.min(window.devicePixelRatio || 1, 2);
            const targetPR = basePR * pixelScale;
            if (Math.abs(r.pixelRatio - targetPR) > 0.05) {
                r.pixelRatio = targetPR;
                r.resize();
            }

            // Exposición (compensación visual)
            r.exposure = 1.0 + this.quality * 0.4;

            // Sombras
            r.shadowCascadeScale = shadowScale;

            // SSAO
            const ssaoThreshold = this.hardwareProfile.estimatedTier === 'low' ? 0.7 : 0.5;
            r.ssaoEnabled = this.quality > ssaoThreshold && postScale > 0.3;
            r._metaSSAOStrength = 0.3 + this.quality * 0.35;

            // Bloom
            r.bloomEnabled = this.quality > 0.6 && postScale > 0.4;

            // God rays: same idea as bloom (a full extra offscreen pass —
            // sun projection + blur) but this flag didn't exist before, so
            // it always ran at full cost on every device regardless of
            // quality/tier. Slightly cheaper than bloom perceptually, so a
            // slightly lower bar to re-enable it.
            r.godRaysEnabled = postScale > 0.3;

            // Calidad de post-process
            r._metaBloomBoost = postScale;
            r._metaVignette = 0.2 + postScale * 0.3;

            // Aplicar a otros sistemas del motor
            this.engine._aiShadowScale = shadowScale;
            this.engine._aiParticleScale = this.particleMultiplier;
            this.engine._aiEntityScale = entityScale;
            
            if (this.engine._applyEntityScale) {
                this.engine._applyEntityScale(entityScale);
            }

            if (this.engine._setTextureQuality) {
                this.engine._setTextureQuality(this.textureQuality);
            }
        }

        /**
         * Registra el rendimiento en el log
         */
        _logPerformance(reason = '') {
            const entry = {
                timestamp: performance.now(),
                fps: this._recentAvg(5),
                quality: this.quality,
                shadows: this.shadowQuality,
                particles: this.particleMultiplier,
                entities: this.entityMultiplier,
                pixelRatio: this.pixelRatioScale,
                action: this.lastAction,
                reason: reason || this.lastAction
            };
            
            this.performanceLog.push(entry);
            if (this.performanceLog.length > this.maxLogEntries) {
                this.performanceLog.shift();
            }
        }

        /**
         * Obtiene la presión de carga actual
         */
        getLoadPressure() {
            return this._calculateLoadPressure();
        }

        /**
         * Obtiene el estado térmico simulado
         */
        getThermalStatus() {
            return {
                pressure: this.thermalPressure,
                throttling: this.thermalPressure > 0.7,
                reduction: Math.min(1, this.thermalPressure * 1.2)
            };
        }

        /**
         * Obtiene el estado completo del optimizador
         */
        getStatus() {
            return {
                quality: this.quality.toFixed(2),
                shadows: this.shadowQuality.toFixed(2),
                particles: this.particleMultiplier.toFixed(2),
                entities: this.entityMultiplier.toFixed(2),
                pixelRatio: this.pixelRatioScale.toFixed(2),
                action: this.lastAction,
                avgFPS: this.sessionProfile.avgFPS.toFixed(1),
                minFPS: this.sessionProfile.minFPS.toFixed(1),
                stability: this.sessionProfile.stability.toFixed(2),
                adjustments: this.adjustments,
                loadPressure: this._calculateLoadPressure().toFixed(2),
                predictedLoad: this._predictLoad().toFixed(2),
                hardwareTier: this.hardwareProfile.estimatedTier,
                learningRate: this.learningRate.toFixed(3)
            };
        }

        /**
         * Cambia manualmente el modo de calidad
         */
        setMode(mode) {
            if (this.modes[mode]) {
                this._setMode(mode);
                return true;
            }
            return false;
        }

        /**
         * Establece calidad manualmente (0.3 - 1.2)
         */
        setQuality(value) {
            this.quality = Math.max(this.minQuality, Math.min(this.maxQuality, value));
            this._applyToEngine();
            this._logPerformance(`Calidad manual: ${this.quality.toFixed(2)}`);
        }

        /**
         * Obtiene recomendaciones para el usuario
         */
        getRecommendations() {
            const status = this.getStatus();
            const recs = [];

            if (status.avgFPS < 25) {
                recs.push('Bajo rendimiento. Considera reducir la calidad gráfica.');
            }
            
            if (status.stability < 0.5) {
                recs.push('Rendimiento inestable. Cierra otras aplicaciones.');
            }
            
            if (status.loadPressure > 0.6) {
                recs.push('Alta carga. El motor está priorizando FPS.');
            }
            
            if (this.hardwareProfile.estimatedTier === 'low') {
                recs.push('Hardware limitado. Modo rendimiento recomendado.');
            }

            if (recs.length === 0) {
                recs.push('✅ Rendimiento óptimo. Disfruta de la experiencia.');
            }

            return recs;
        }
    }

    // Exportar al sistema global
    global.PriomGL = global.PriomGL || {};
    global.PriomGL.OptimizerAI = OptimizerAI;

})(typeof window !== 'undefined' ? window : globalThis);