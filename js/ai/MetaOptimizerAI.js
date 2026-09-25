/**
 * PriomGL MetaOptimizerAI v3 — Inteligencia Contextual Avanzada
 * 
 * Sistema de meta-aprendizaje que observa, predice y optimiza
 * la experiencia de usuario en tiempo real. Combina análisis de
 * hardware, patrones de juego y eventos del mundo para tomar
 * decisiones estratégicas.
 * 
 * Características:
 * - Aprendizaje contextual a corto y largo plazo
 * - Predicción de carga preventiva
 * - Perfilado dinámico del jugador
 * - IA explicable (decisiones con razonamiento)
 * - Optimización cinematográfica adaptativa
 */
(function(global) {
    'use strict';

    class MetaOptimizerAI {
        constructor(engine, optimizer, worldAI) {
            // Referencias al motor
            this.engine = engine;
            this.optimizer = optimizer;
            this.worldAI = worldAI;

            // Estado del sistema
            this.mode = 'balanced'; // balanced | cinematic | performance | battery | adaptive
            this.confidence = 0.7; // Nivel de confianza en las predicciones
            this.insights = [];
            this.maxInsights = 20;
            this.tick = 0;
            this.sessionStart = performance.now();

            // Memoria contextual (corto y largo plazo)
            this.memory = {
                shortTerm: [], // Últimos 60 segundos de eventos
                longTerm: {
                    avgFPS: 60,
                    peakLoad: 0,
                    userSpeed: 0,
                    cameraMovement: 0,
                    weatherPreferences: {},
                    timeOfDay: 0
                },
                patterns: {
                    lowFPSEvents: 0,
                    highLoadEvents: 0,
                    weatherStress: 0,
                    nightTimeCount: 0,
                    cinematicMoments: 0,
                    userActivity: 0
                }
            };

            // Perfil del usuario (aprendido)
            this.userProfile = {
                playStyle: 'explorer', // explorer | fighter | cinematographer | performance
                sensitivity: 1.0,
                preferredQuality: 1.0,
                movementSpeed: 0,
                cameraSpeed: 0,
                lastAction: null,
                actionHistory: []
            };

            // Hardware profiling
            this.hardware = {
                isMobile: /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
                estimatedGPU: 'medium', // low | medium | high | ultra
                availableMemory: 0,
                batterySaving: false,
                thermalThrottling: false,
                pixelRatio: Math.min(window.devicePixelRatio || 1, 2)
            };

            // Predicciones
            this.predictions = {
                futureLoad: 0,
                nextWeather: null,
                performanceTrend: 'stable',
                recommendedMode: 'balanced'
            };

            // Inicialización
            this._initHardwareProfile();
            this._initUserProfile();

            if (this.hardware.isMobile) {
                this.mode = 'performance';
                if (this.optimizer && this.optimizer._setMode) {
                    this.optimizer._setMode('performance');
                    this.optimizer.targetFPS = 38;
                }
                this._pushInsight('Dispositivo móvil detectado → modo PERFORMANCE activado', 'hardware');
            }
        }

        /**
         * Actualización principal del MetaOptimizerAI
         * @param {number} dt - Delta time en segundos
         * @param {number} fps - Frames por segundo actuales
         */
        update(dt, fps) {
            this.tick += dt;

            // Actualizar memoria de corto plazo cada segundo
            if (this.tick >= 1.0) {
                this._updateShortTermMemory(fps);
                this.tick = 0;
            }

            // Actualizar perfil del usuario
            this._updateUserProfile(dt);

            // Analizar patrones y hacer predicciones
            this._analyzePatterns();
            this._makePredictions();

            // Tomar decisiones estratégicas
            this._makeStrategicDecisions(fps);

            // Aplicar optimizaciones
            this._applyOptimizations();

            // Registrar insights significativos
            this._logSignificantEvents(fps);
        }

        /**
         * Inicializa el perfil de hardware del dispositivo
         */
        _initHardwareProfile() {
            const gl = this.engine.renderer?.gl;
            if (!gl) return;

            // Estimar capacidad de la GPU basada en extensiones y límites
            const extensions = gl.getSupportedExtensions() || [];
            let gpuScore = 0;

            // Extensiones clave para gráficos avanzados
            if (extensions.includes('EXT_color_buffer_float')) gpuScore += 2;
            if (extensions.includes('OES_texture_float_linear')) gpuScore += 2;
            if (extensions.includes('WEBGL_draw_buffers')) gpuScore += 1;
            if (extensions.includes('WEBGL_multi_draw')) gpuScore += 2;

            // Limitar por resolución de pantalla
            const pixelCount = window.screen.width * window.screen.height;
            if (pixelCount > 4000000) gpuScore += 2;
            else if (pixelCount > 2000000) gpuScore += 1;

            // Determinar nivel de GPU
            if (gpuScore >= 7) this.hardware.estimatedGPU = 'ultra';
            else if (gpuScore >= 4) this.hardware.estimatedGPU = 'high';
            else if (gpuScore >= 2) this.hardware.estimatedGPU = 'medium';
            else this.hardware.estimatedGPU = 'low';

            // Estimar memoria disponible (aproximación)
            const memEstimate = Math.min(4, Math.floor(gpuScore / 2) + 1);
            this.hardware.availableMemory = memEstimate;

            console.log(`%c🔍 [MetaAI] Hardware detectado: GPU ${this.hardware.estimatedGPU}, Memoria estimada: ${memEstimate}GB`, 'color:#38bdf8');
        }

        /**
         * Inicializa el perfil del usuario
         */
        _initUserProfile() {
            // Detectar preferencias iniciales basadas en hardware y contexto
            if (this.hardware.isMobile) {
                this.userProfile.playStyle = 'explorer';
                this.userProfile.sensitivity = 0.7;
            } else {
                this.userProfile.playStyle = 'cinematographer';
                this.userProfile.sensitivity = 1.0;
            }

            // Si el usuario ha usado los controles previamente, ajustar
            if (this.engine.keys && Object.keys(this.engine.keys).length > 0) {
                this.userProfile.playStyle = 'explorer';
            }
        }

        /**
         * Actualiza la memoria de corto plazo
         */
        _updateShortTermMemory(fps) {
            const worldStatus = this.worldAI.getStatus();
            const loadPressure = this.optimizer.getLoadPressure();

            this.memory.shortTerm.push({
                timestamp: performance.now(),
                fps: fps,
                load: loadPressure,
                weather: worldStatus.weather,
                season: worldStatus.season,
                temperature: worldStatus.temperature,
                animals: worldStatus.animals,
                fires: worldStatus.fires,
                mode: this.mode
            });

            // Mantener solo 60 entradas (último minuto)
            if (this.memory.shortTerm.length > 60) {
                this.memory.shortTerm.shift();
            }

            // Actualizar estadísticas de largo plazo
            this.memory.longTerm.avgFPS = this.memory.longTerm.avgFPS * 0.95 + fps * 0.05;
            this.memory.longTerm.peakLoad = Math.max(this.memory.longTerm.peakLoad, loadPressure);
        }

        /**
         * Actualiza el perfil del usuario basado en acciones
         */
        _updateUserProfile(dt) {
            const engine = this.engine;
            if (!engine.camera) return;

            // Medir velocidad de movimiento del usuario
            const camPos = engine.camera.position;
            if (this._lastCamPos) {
                const speed = camPos.distanceTo(this._lastCamPos) / dt;
                this.userProfile.movementSpeed = this.userProfile.movementSpeed * 0.9 + speed * 0.1;
            }
            this._lastCamPos = camPos.clone();

            // Medir velocidad de rotación de cámara
            const rotationSpeed = Math.abs(engine.mouse.dx + engine.mouse.dy) / dt;
            this.userProfile.cameraSpeed = this.userProfile.cameraSpeed * 0.9 + rotationSpeed * 0.1;

            // Detectar estilo de juego basado en patrones
            if (this.userProfile.movementSpeed > 8 && this.userProfile.cameraSpeed > 2) {
                this.userProfile.playStyle = 'fighter';
            } else if (this.userProfile.movementSpeed > 4 && this.userProfile.cameraSpeed > 1) {
                this.userProfile.playStyle = 'explorer';
            } else if (this.userProfile.cameraSpeed > 3 && this.userProfile.movementSpeed < 2) {
                this.userProfile.playStyle = 'cinematographer';
            } else if (this.userProfile.movementSpeed < 2 && this.userProfile.cameraSpeed < 1) {
                this.userProfile.playStyle = 'performance';
            }

            // Sensibilidad adaptativa
            this.userProfile.sensitivity = 0.8 + (this.userProfile.cameraSpeed / 10) * 0.4;
            this.userProfile.sensitivity = Math.min(1.5, Math.max(0.5, this.userProfile.sensitivity));
        }

        /**
         * Analiza patrones en los datos recolectados
         */
        _analyzePatterns() {
            const short = this.memory.shortTerm;
            if (short.length < 10) return;

            // Patrón: eventos de bajo FPS
            const recentFPS = short.slice(-10).map(s => s.fps);
            const avgRecentFPS = recentFPS.reduce((a, b) => a + b, 0) / recentFPS.length;
            if (avgRecentFPS < 30) this.memory.patterns.lowFPSEvents++;
            else this.memory.patterns.lowFPSEvents = Math.max(0, this.memory.patterns.lowFPSEvents - 0.5);

            // Patrón: eventos de alta carga
            const recentLoad = short.slice(-10).map(s => s.load);
            const avgRecentLoad = recentLoad.reduce((a, b) => a + b, 0) / recentLoad.length;
            if (avgRecentLoad > 0.6) this.memory.patterns.highLoadEvents++;
            else this.memory.patterns.highLoadEvents = Math.max(0, this.memory.patterns.highLoadEvents - 0.3);

            // Patrón: estrés climático
            const weatherStress = short.filter(s => s.weather === 'tormenta' || s.weather === 'nieve').length;
            this.memory.patterns.weatherStress = weatherStress / short.length;

            // Patrón: actividad del usuario
            const activity = this.userProfile.movementSpeed + this.userProfile.cameraSpeed;
            this.memory.patterns.userActivity = Math.min(1, activity / 15);

            // Patrón: momento cinematográfico
            const dramaticWeather = short.some(s => s.weather === 'tormenta' || s.weather === 'niebla');
            const goldenHour = this.memory.longTerm.timeOfDay > 17 && this.memory.longTerm.timeOfDay < 19.5;
            if (dramaticWeather || goldenHour) {
                this.memory.patterns.cinematicMoments += 0.1;
            } else {
                this.memory.patterns.cinematicMoments = Math.max(0, this.memory.patterns.cinematicMoments - 0.05);
            }
        }

        /**
         * Realiza predicciones basadas en patrones históricos
         */
        _makePredictions() {
            const short = this.memory.shortTerm;
            if (short.length < 20) return;

            // Predecir carga futura (tendencia)
            const loads = short.slice(-20).map(s => s.load);
            const trend = loads[loads.length - 1] - loads[0];
            this.predictions.futureLoad = Math.max(0, Math.min(1, loads[loads.length - 1] + trend * 0.3));

            // Predecir clima futuro (basado en transiciones anteriores)
            const weathers = short.slice(-30).map(s => s.weather);
            const weatherCounts = {};
            for (const w of weathers) {
                weatherCounts[w] = (weatherCounts[w] || 0) + 1;
            }
            let maxCount = 0;
            let predictedWeather = 'despejado';
            for (const [w, count] of Object.entries(weatherCounts)) {
                if (count > maxCount) {
                    maxCount = count;
                    predictedWeather = w;
                }
            }
            this.predictions.nextWeather = predictedWeather;

            // Tendencia de rendimiento
            const fpsHistory = short.slice(-30).map(s => s.fps);
            const fpsTrend = fpsHistory[fpsHistory.length - 1] - fpsHistory[0];
            if (fpsTrend > 5) this.predictions.performanceTrend = 'improving';
            else if (fpsTrend < -5) this.predictions.performanceTrend = 'declining';
            else this.predictions.performanceTrend = 'stable';

            // Recomendar modo
            const load = this.predictions.futureLoad;
            const isMobile = this.hardware.isMobile;
            const cinematic = this.memory.patterns.cinematicMoments > 0.6;

            if (isMobile && load > 0.5) {
                this.predictions.recommendedMode = 'performance';
            } else if (cinematic && load < 0.3 && !isMobile) {
                this.predictions.recommendedMode = 'cinematic';
            } else if (load < 0.2 && this.hardware.estimatedGPU !== 'low') {
                this.predictions.recommendedMode = 'balanced';
            } else {
                this.predictions.recommendedMode = 'adaptive';
            }
        }

        /**
         * Toma decisiones estratégicas basadas en predicciones
         */
        _makeStrategicDecisions(fps) {
            const world = this.worldAI.getStatus();
            const pressure = this.optimizer.getLoadPressure();
            const hourLike = (this.engine.clock.elapsed * 0.02) % 24;
            this.memory.longTerm.timeOfDay = hourLike;

            // --- Decisión: Modo Rendimiento vs Calidad (v4 más agresivo) ---
            if ((pressure > 0.4 || fps < 20) && this.mode !== 'performance') {
                this.mode = 'performance';
                this.optimizer.targetFPS = this.hardware.isMobile ? 38 : 48;
                this._pushInsight('Alta presión / FPS bajo → modo PERFORMANCE', 'performance');
            } else if (pressure < 0.12 && fps > 48 && this.mode === 'performance' && !this.hardware.isMobile) {
                this.mode = 'balanced';
                this.optimizer.targetFPS = 55;
                this._pushInsight('Carga estable → modo BALANCED', 'performance');
            }
            // Mobile: stay in performance longer
            if (this.hardware.isMobile && fps < 28 && this.mode !== 'performance') {
                this.mode = 'performance';
                this.optimizer._setMode && this.optimizer._setMode('performance');
            }

            // --- Decisión: Modo Cinemático ---
            const dramatic = world.weather === 'tormenta' || world.weather === 'niebla' ||
                            (hourLike > 17 && hourLike < 19.5);
            const cinematicScore = this.memory.patterns.cinematicMoments;

            if (dramatic && pressure < 0.35 && this.mode !== 'performance' && cinematicScore > 0.3) {
                if (this.mode !== 'cinematic') {
                    this.mode = 'cinematic';
                    this._pushInsight('Momento cinematográfico detectado → modo CINEMATIC', 'cinematic');
                }
            } else if (cinematicScore < 0.2 && this.mode === 'cinematic') {
                this.mode = this.predictions.recommendedMode;
                this._pushInsight('Fin de momento cinematográfico → modo ' + this.mode.toUpperCase(), 'cinematic');
            }

            // --- Decisión: Adaptación al hardware ---
            if (this.hardware.isMobile && this.memory.patterns.lowFPSEvents > 8) {
                this.optimizer.pixelRatioScale = Math.min(this.optimizer.pixelRatioScale, 0.7);
                this.hardware.thermalThrottling = true;
                if (this.mode !== 'performance') {
                    this.mode = 'performance';
                    this._pushInsight('Throttling térmico detectado → modo PERFORMANCE forzado', 'hardware');
                }
            }

            // --- Decisión: Ajuste por perfil de usuario ---
            if (this.userProfile.playStyle === 'fighter') {
                // Jugadores activos priorizan FPS
                this.optimizer.targetFPS = 60;
                this.optimizer.quality = Math.min(this.optimizer.quality, 0.9);
            } else if (this.userProfile.playStyle === 'cinematographer') {
                // Jugadores que aprecian la calidad visual
                this.optimizer.quality = Math.min(this.optimizer.quality + 0.05, 1.2);
            }
        }

        /**
         * Aplica las optimizaciones decididas al motor
         */
        _applyOptimizations() {
            const r = this.engine.renderer;
            if (!r) return;

            // Configuración de post-procesado según modo
            const isCinematic = this.mode === 'cinematic';
            const isPerformance = this.mode === 'performance';

            // Bloom
            r._metaBloomBoost = isCinematic ? 1.4 : isPerformance ? 0.6 : 1.0;

            // Vignette
            r._metaVignette = isCinematic ? 0.6 : isPerformance ? 0.2 : 0.35;

            // God Rays
            r._metaGodRayBoost = isCinematic ? 1.8 : isPerformance ? 0.4 : 1.0;

            // Saturación
            r._metaSaturation = isCinematic ? 1.2 : isPerformance ? 0.95 : 1.08;

            // Tono de color (cinematic grading)
            if (isCinematic) {
                r._metaColdShadow = [0.85, 0.95, 1.12];
                r._metaWarmHighlight = [1.12, 1.02, 0.82];
            } else if (isPerformance) {
                r._metaColdShadow = [0.95, 0.98, 1.02];
                r._metaWarmHighlight = [1.02, 0.99, 0.95];
            } else {
                r._metaColdShadow = [0.92, 0.98, 1.05];
                r._metaWarmHighlight = [1.05, 1.0, 0.9];
            }

            // SSAO: desactivar en modo rendimiento si la carga es alta
            if (isPerformance && this.memory.longTerm.peakLoad > 0.6) {
                r.ssaoEnabled = false;
            } else if (isCinematic) {
                r.ssaoEnabled = true;
                r._metaSSAOStrength = 0.7;
            } else {
                r.ssaoEnabled = true;
                r._metaSSAOStrength = 0.55;
            }

            // Ajuste de densidad de vegetación
            if (this.engine._applyEntityScale) {
                const scale = isPerformance ? 0.6 : isCinematic ? 1.1 : 0.9;
                this.engine._applyEntityScale(scale);
            }
        }

        /**
         * Registra eventos significativos como insights
         */
        _logSignificantEvents(fps) {
            // Detectar eventos importantes
            const short = this.memory.shortTerm;
            if (short.length < 2) return;

            const last = short[short.length - 1];
            const prev = short[short.length - 2];

            // Caída de FPS significativa
            if (last.fps < 25 && prev.fps > 40) {
                this._pushInsight(`Caída de FPS: ${Math.round(prev.fps)} → ${Math.round(last.fps)}`, 'warning');
            }

            // Cambio climático dramático
            if (last.weather !== prev.weather && last.weather !== 'despejado') {
                this._pushInsight(`Cambio climático: ${prev.weather} → ${last.weather}`, 'world');
            }

            // Cambio de modo
            if (last.mode !== prev.mode) {
                this._pushInsight(`Cambio de modo: ${prev.mode} → ${last.mode}`, 'system');
            }

            // Evento de incendio
            if (last.fires > prev.fires && last.fires > 0) {
                this._pushInsight(`🔥 Nuevo incendio detectado en el mundo`, 'world');
            }
        }

        /**
         * Registra un insight en el historial
         */
        _pushInsight(msg, category = 'system') {
            const entry = {
                msg,
                category,
                timestamp: Date.now(),
                mode: this.mode,
                fps: this.memory.longTerm.avgFPS
            };

            this.insights.unshift(entry);
            if (this.insights.length > this.maxInsights) this.insights.pop();

            // Console logging con colores según categoría
            const colors = {
                system: '#a78bfa',
                performance: '#34d399',
                cinematic: '#f472b6',
                world: '#38bdf8',
                hardware: '#f59e0b',
                warning: '#f87171'
            };
            const color = colors[category] || '#94a3b8';
            console.log(`%c[MetaAI] ${msg}`, `color:${color};font-weight:bold`);
        }

        /**
         * Obtiene el estado actual del MetaOptimizerAI
         */
        getStatus() {
            return {
                mode: this.mode,
                confidence: this.confidence,
                predictedLoad: this.predictions.futureLoad,
                predictedWeather: this.predictions.nextWeather,
                performanceTrend: this.predictions.performanceTrend,
                recommendedMode: this.predictions.recommendedMode,
                userProfile: {
                    playStyle: this.userProfile.playStyle,
                    sensitivity: this.userProfile.sensitivity.toFixed(2),
                    movementSpeed: this.userProfile.movementSpeed.toFixed(1),
                    cameraSpeed: this.userProfile.cameraSpeed.toFixed(1)
                },
                hardware: {
                    gpu: this.hardware.estimatedGPU,
                    mobile: this.hardware.isMobile,
                    thermalThrottling: this.hardware.thermalThrottling
                },
                memory: {
                    shortTerm: this.memory.shortTerm.length,
                    avgFPS: this.memory.longTerm.avgFPS.toFixed(1),
                    peakLoad: this.memory.longTerm.peakLoad.toFixed(2)
                },
                insights: this.insights.slice(0, 4).map(i => i.msg)
            };
        }

        /**
         * Forza un modo específico manualmente
         */
        forceMode(mode) {
            if (['balanced', 'cinematic', 'performance', 'battery', 'adaptive'].includes(mode)) {
                this.mode = mode;
                this._pushInsight(`Modo forzado manualmente: ${mode.toUpperCase()}`, 'system');
                this._applyOptimizations();
            }
        }

        /**
         * Obtiene una recomendación para el usuario
         */
        getRecommendation() {
            const status = this.getStatus();
            let rec = '';

            if (status.hardware.thermalThrottling) {
                rec = '⚠️ Dispositivo caliente. Considera reducir calidad gráfica.';
            } else if (status.mode === 'cinematic') {
                rec = '🎬 Momento cinematográfico activo. Disfruta de la vista.';
            } else if (status.performanceTrend === 'declining') {
                rec = '📉 Rendimiento bajando. El motor se está ajustando.';
            } else if (status.userProfile.playStyle === 'fighter') {
                rec = '⚔️ Estilo de juego activo. Priorizando FPS.';
            } else if (status.mode === 'performance') {
                rec = '⚡ Modo rendimiento activo. Máximo FPS.';
            } else {
                rec = '✅ Todo funcionando de forma óptima.';
            }

            return rec;
        }
    }

    // Exportar al sistema global
    global.PriomGL = global.PriomGL || {};
    global.PriomGL.MetaOptimizerAI = MetaOptimizerAI;

})(typeof window !== 'undefined' ? window : globalThis);