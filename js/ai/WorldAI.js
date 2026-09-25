/**
 * PriomGL WorldAI v3 — Sistema de Ecosistema Vivo y Emergente
 * 
 * Simulación de mundo completo con comportamiento animal avanzado,
 * ciclos ecológicos, eventos climáticos extremos, y dinámica de
 * incendios forestales. Crea un mundo que respira, evoluciona y
 * reacciona a la presencia del jugador.
 * 
 * Características:
 * - Ecosistema con cadenas tróficas reales
 * - Comportamiento animal basado en necesidades (hambre, energía, miedo)
 * - Eventos climáticos extremos (tormentas, sequías, olas de calor)
 * - Propagación de incendios con física de viento
 * - Ciclos de vegetación estacionales
 * - Memoria ecológica (animales recuerdan ubicaciones)
 * - Narrativa ambiental emergente
 */
(function(global) {
    'use strict';

    const { Vec3, Color } = global.PriomMath;

    // Constantes del mundo
    const SEASONS = ['primavera', 'verano', 'otoño', 'invierno'];
    const WEATHERS = ['despejado', 'nublado', 'lluvia', 'tormenta', 'niebla', 'nieve'];
    const BIOMES = ['bosque', 'pradera', 'montaña', 'ribera', 'tundra', 'desierto'];
    
    // Estados de comportamiento animal
    const ANIMAL_STATES = {
        EXPLORANDO: 'explorando',
        PASTANDO: 'pastando',
        CAZANDO: 'cazando',
        HUYENDO: 'huyendo',
        DESCANSANDO: 'descansando',
        SOCIALIZANDO: 'socializando',
        BEBiendo: 'bebiendo',
        MIGRANDO: 'migrando',
        DEFENDIENDO: 'defendiendo'
    };

    class WorldAI {
        constructor(engine) {
            this.engine = engine;

            // Monotonic animal-id counter. Must live here (not inside
            // _initAnimals, which can bail out early if terrain isn't
            // ready yet) so it's always a real number before any spawn
            // path touches it — see the id-collision fix in _spawnAnimal.
            this._nextAnimalId = 0;
            
            // Tiempo del mundo
            this.time = 0;
            this.dayTime = 0; // 0-24 horas
            this.dayLength = 600; // segundos por día
            this.dayCount = 0;
            
            // Estaciones
            this.seasonIndex = 1; // verano
            this.seasonProgress = 0;
            this.seasonDuration = 120; // segundos por estación
            
            // Clima
            this.weather = 'despejado';
            this.weatherTimer = 0;
            this.weatherDuration = 45;
            this.weatherTransition = 0;
            this.previousWeather = 'despejado';
            this.weatherIntensity = 1.0;
            
            // Variables ambientales
            this.temperature = 22;
            this.humidity = 0.4;
            this.wind = new Vec3(1, 0, 0.3);
            this.windSpeed = 1.5;
            this.cloudCover = 0.2;
            this.airQuality = 1.0;
            
            // Ecosistema
            this.animals = [];
            this.plants = [];
            this.fires = [];
            this.waterSources = [];
            this.foodSources = [];
            this.events = [];
            this.ecosystemMemory = {
                dangerZones: [],
                foodZones: [],
                migrationRoutes: []
            };
            
            // Configuración del ecosistema
            this.config = {
                maxAnimals: 80,
                fireChance: 0.0006,
                fireSpreadRate: 0.8,
                rainGrowthBoost: 1.8,
                snowSlow: 0.45,
                migrationThreshold: 0.3,
                plantGrowthRate: 0.02,
                animalSpawnRate: 0.1,
                reproductionCooldown: 30
            };
            
            // Estados de emergencia
            this.emergency = {
                drought: false,
                heatwave: false,
                blizzard: false,
                wildfire: false
            };
            
            // Inicializar ecosistema
            this._initWaterSources();
            this._initPlants();
            this._initAnimals();
            this._initBiomes();
            
            console.log('%c🌍 [WorldAI] Mundo vivo inicializado con ' + this.animals.length + ' criaturas', 'color:#38bdf8');
        }

        // ============================================================
        // INICIALIZACIÓN DEL MUNDO
        // ============================================================

        _initWaterSources() {
            const terrain = this.engine.terrainGen;
            if (!terrain) return;
            
            // Crear fuentes de agua (lagos, ríos)
            const sources = [
                { x: -30, z: 20, radius: 12 },  // Lago norte
                { x: 45, z: -15, radius: 8 },   // Lago este
                { x: -10, z: -40, radius: 6 }   // Lago sur
            ];
            
            for (const src of sources) {
                const y = terrain.getHeight(src.x, src.z);
                if (y > 2 && y < 15) {
                    this.waterSources.push({
                        pos: new Vec3(src.x, y + 0.5, src.z),
                        radius: src.radius,
                        level: 1.0,
                        temperature: 10 + Math.random() * 8
                    });
                }
            }
        }

        _initPlants() {
            const terrain = this.engine.terrainGen;
            if (!terrain) return;
            
            const plantTypes = [
                { name: 'árbol', minHeight: 3, maxHeight: 25, growthRate: 0.01, maxSize: 1.0 },
                { name: 'arbusto', minHeight: 1, maxHeight: 18, growthRate: 0.02, maxSize: 0.6 },
                { name: 'flor', minHeight: 2, maxHeight: 14, growthRate: 0.03, maxSize: 0.3 },
                { name: 'hierba', minHeight: 0.5, maxHeight: 20, growthRate: 0.04, maxSize: 0.2 }
            ];
            
            for (let i = 0; i < 200; i++) {
                const type = plantTypes[Math.floor(Math.random() * plantTypes.length)];
                let x, z, y, tries = 0;
                do {
                    x = (Math.random() - 0.5) * 200;
                    z = (Math.random() - 0.5) * 200;
                    y = terrain.getHeight(x, z);
                    tries++;
                } while ((y < type.minHeight || y > type.maxHeight) && tries < 15);
                
                if (tries < 15) {
                    this.plants.push({
                        type: type.name,
                        pos: new Vec3(x, y, z),
                        size: 0.3 + Math.random() * 0.7,
                        maxSize: type.maxSize * (0.7 + Math.random() * 0.6),
                        growth: 0.5 + Math.random() * 0.5,
                        growthRate: type.growthRate * (0.7 + Math.random() * 0.6),
                        health: 0.7 + Math.random() * 0.3,
                        season: this.seasonIndex,
                        edible: type.name !== 'árbol'
                    });
                }
            }
        }

        _initAnimals() {
            const terrain = this.engine.terrainGen;
            if (!terrain) return;
            
            const species = [
                { name: 'ciervo', speed: 6, radius: 0.45, prey: true, social: true, diet: 'herbivore' },
                { name: 'lobo', speed: 8, radius: 0.4, prey: false, social: true, diet: 'carnivore' },
                { name: 'ave', speed: 12, radius: 0.2, prey: true, social: true, flying: true, diet: 'herbivore' },
                { name: 'oso', speed: 5, radius: 0.7, prey: false, social: false, diet: 'omnivore' },
                { name: 'conejo', speed: 7, radius: 0.2, prey: true, social: true, diet: 'herbivore' },
                { name: 'zorro', speed: 9, radius: 0.3, prey: false, social: false, diet: 'carnivore' },
                { name: 'jabalí', speed: 5.5, radius: 0.5, prey: false, social: true, diet: 'omnivore' }
            ];
            
            const count = Math.min(this.config.maxAnimals, 30 + Math.floor(Math.random() * 20));

            for (let i = 0; i < count; i++) {
                const speciesData = species[i % species.length];
                let x, z, y, tries = 0;
                do {
                    x = (Math.random() - 0.5) * 180;
                    z = (Math.random() - 0.5) * 180;
                    y = terrain.getHeight(x, z);
                    tries++;
                } while ((y < 1.5 || y > 20) && tries < 20);
                
                if (tries < 20) {
                    const animal = this._createAnimal(speciesData, x, y, z, this._nextAnimalId++);
                    this.animals.push(animal);
                }
            }
        }

        _createAnimal(species, x, y, z, id) {
            const isFlying = species.flying || false;
            return {
                id: id,
                type: species.name,
                pos: new Vec3(x, y + (isFlying ? 8 : 0.5), z),
                vel: new Vec3(),
                speed: species.speed * (0.7 + Math.random() * 0.6),
                radius: species.radius,
                prey: species.prey,
                flying: isFlying,
                social: species.social || false,
                diet: species.diet || 'herbivore',
                state: ANIMAL_STATES.EXPLORANDO,
                stateTimer: 2 + Math.random() * 6,
                energy: 0.6 + Math.random() * 0.4,
                health: 0.7 + Math.random() * 0.3,
                hunger: 0.3 + Math.random() * 0.3,
                thirst: 0.3 + Math.random() * 0.3,
                age: Math.random() * 0.8,
                pregnant: false,
                gestationTimer: 0,
                target: null,
                targetPos: null,
                memory: {
                    foodSources: [],
                    dangerZones: [],
                    homePos: new Vec3(x, y, z),
                    lastWater: null
                },
                groupId: Math.floor(Math.random() * 10),
                personality: {
                    aggression: 0.3 + Math.random() * 0.4,
                    curiosity: 0.3 + Math.random() * 0.4,
                    caution: 0.3 + Math.random() * 0.4
                }
            };
        }

        _initBiomes() {
            // Mapear biomas basados en altura y humedad
            const terrain = this.engine.terrainGen;
            if (!terrain) return;
            
            // Pre-calcular biomas para el terreno
            this.biomeMap = new Map();
            for (let x = -100; x <= 100; x += 10) {
                for (let z = -100; z <= 100; z += 10) {
                    const h = terrain.getHeight(x, z);
                    const moisture = terrain.getMoisture(x, z);
                    let biome = 'pradera';
                    if (h > 22) biome = 'tundra';
                    else if (h > 16) biome = 'montaña';
                    else if (moisture > 0.6) biome = 'bosque';
                    else if (moisture < 0.25) biome = 'desierto';
                    else if (h < 2) biome = 'ribera';
                    this.biomeMap.set(`${x},${z}`, biome);
                }
            }
        }

        // ============================================================
        // CICLO PRINCIPAL DE ACTUALIZACIÓN
        // ============================================================

        update(dt) {
            this.time += dt;
            this.dayTime += dt / this.dayLength * 24;
            if (this.dayTime >= 24) {
                this.dayTime -= 24;
                this.dayCount++;
            }
            
            // Actualizar estaciones
            this.seasonProgress += dt / this.seasonDuration;
            if (this.seasonProgress >= 1) {
                this.seasonProgress = 0;
                this.seasonIndex = (this.seasonIndex + 1) % 4;
                this._onSeasonChange();
            }
            
            // Actualizar clima
            this._updateWeather(dt);
            
            // Actualizar variables ambientales
            this._updateEnvironment(dt);
            
            // Actualizar ecosistema
            this._updatePlants(dt);
            this._updateAnimals(dt);
            this._updateFires(dt);
            this._checkEmergencies(dt);
            
            // Eventos aleatorios
            if (Math.random() < 0.0001 * dt) {
                this._triggerRandomEvent();
            }
            
            // Aplicar efectos al mundo visual
            this._applyWorldEffects();
            
            // Generar narrativa
            if (this.events.length > 0 && this.events.length % 10 === 0) {
                this._generateNarrative();
            }
        }

        // ============================================================
        // CLIMA Y ESTACIONES
        // ============================================================

        _updateWeather(dt) {
            // Transición de clima
            if (this.weatherTransition > 0) {
                this.weatherTransition -= dt * 0.1;
            }
            
            this.weatherTimer += dt;
            if (this.weatherTimer > this.weatherDuration) {
                this.weatherTimer = 0;
                this.weatherDuration = 20 + Math.random() * 60;
                this._changeWeather();
                this.weatherTransition = 1.0;
            }
            
            // Intensidad del clima
            if (this.weather === 'tormenta') {
                this.weatherIntensity = 0.7 + Math.sin(this.time * 0.3) * 0.3;
            } else if (this.weather === 'lluvia') {
                this.weatherIntensity = 0.5 + Math.sin(this.time * 0.2 + 1) * 0.3;
            } else {
                this.weatherIntensity = 1.0;
            }
        }

        _changeWeather() {
            const season = this.getSeason();
            const baseWeather = this._getSeasonalWeather(season);
            
            // Probabilidad de clima extremo
            let r = Math.random();
            let newWeather;
            
            if (this.emergency.heatwave && season === 'verano') {
                newWeather = r < 0.3 ? 'despejado' : 'nublado';
            } else if (this.emergency.blizzard && season === 'invierno') {
                newWeather = 'nieve';
            } else if (r < 0.3) {
                newWeather = baseWeather;
            } else if (r < 0.6) {
                // Clima alternativo
                const alternatives = WEATHERS.filter(w => w !== baseWeather);
                newWeather = alternatives[Math.floor(Math.random() * alternatives.length)];
            } else {
                newWeather = 'despejado';
            }
            
            // Forzar transiciones suaves
            if (this.weather === 'tormenta' && newWeather !== 'lluvia') {
                newWeather = 'lluvia';
            }
            
            this.previousWeather = this.weather;
            this.weather = newWeather;
            this.events.push({ type: 'weather', weather: this.weather, t: this.time });
        }

        _getSeasonalWeather(season) {
            const weatherMap = {
                'primavera': ['lluvia', 'nublado', 'despejado'],
                'verano': ['despejado', 'nublado', 'tormenta'],
                'otoño': ['lluvia', 'niebla', 'nublado'],
                'invierno': ['nieve', 'nublado', 'despejado']
            };
            const options = weatherMap[season] || ['despejado'];
            return options[Math.floor(Math.random() * options.length)];
        }

        _onSeasonChange() {
            const season = this.getSeason();
            this.events.push({ type: 'season', season: season, t: this.time });
            
            // Efectos estacionales en el ecosistema
            switch(season) {
                case 'primavera':
                    this.config.plantGrowthRate = 0.03;
                    for (const a of this.animals) {
                        a.energy = Math.min(1, a.energy + 0.2);
                        a.health = Math.min(1, a.health + 0.1);
                    }
                    break;
                case 'verano':
                    this.config.plantGrowthRate = 0.02;
                    // Posible ola de calor
                    if (Math.random() < 0.3) {
                        this.emergency.heatwave = true;
                    }
                    break;
                case 'otoño':
                    this.config.plantGrowthRate = 0.01;
                    // Animales acumulan energía
                    for (const a of this.animals) {
                        a.energy = Math.min(1, a.energy + 0.15);
                    }
                    break;
                case 'invierno':
                    this.config.plantGrowthRate = 0.005;
                    // Posible tormenta de nieve
                    if (Math.random() < 0.4) {
                        this.emergency.blizzard = true;
                        this.weather = 'nieve';
                    }
                    break;
            }
        }

        _updateEnvironment(dt) {
            const season = this.getSeason();
            
            // Temperatura base por estación
            const baseTemp = {
                'primavera': 14,
                'verano': 26,
                'otoño': 13,
                'invierno': 0
            }[season] || 15;
            
            // Modificadores climáticos
            let tempMod = 0;
            let humidMod = 0;
            
            switch(this.weather) {
                case 'nieve': tempMod = -10; humidMod = 0.3; break;
                case 'lluvia': tempMod = -4; humidMod = 0.5; break;
                case 'tormenta': tempMod = -3; humidMod = 0.6; break;
                case 'niebla': tempMod = -2; humidMod = 0.4; break;
                case 'despejado': tempMod = 4; humidMod = -0.2; break;
                case 'nublado': tempMod = 0; humidMod = 0.1; break;
            }
            
            // Ciclo diurno de temperatura
            const dayTempCycle = Math.sin((this.dayTime / 24) * Math.PI * 2) * 5;
            
            this.temperature = baseTemp + tempMod + dayTempCycle;
            this.humidity = 0.3 + humidMod + Math.sin(this.time * 0.1) * 0.05;
            this.humidity = Math.max(0.1, Math.min(0.95, this.humidity));
            
            // Viento
            const windSpeed = this.weather === 'tormenta' ? 8 + Math.random() * 4 :
                             this.weather === 'lluvia' ? 4 + Math.random() * 2 :
                             1.5 + Math.random() * 1.5;
            this.windSpeed = windSpeed;
            this.wind.set(
                Math.cos(this.time * 0.05 + this.seasonIndex) * windSpeed,
                0,
                Math.sin(this.time * 0.07 + this.seasonIndex * 0.5) * windSpeed * 0.7
            );
            
            // Nubosidad
            this.cloudCover = this.weather === 'nublado' ? 0.7 + Math.random() * 0.2 :
                             this.weather === 'lluvia' ? 0.8 + Math.random() * 0.15 :
                             this.weather === 'tormenta' ? 0.85 + Math.random() * 0.1 :
                             this.weather === 'niebla' ? 0.9 :
                             0.1 + Math.random() * 0.3;
        }

        // ============================================================
        // ECOSISTEMA - PLANTAS
        // ============================================================

        _updatePlants(dt) {
            const season = this.getSeason();
            const growthMultiplier = this.config.plantGrowthRate * 
                (this.humidity > 0.7 ? 1.5 : 1.0) *
                (this.temperature > 5 ? 1.0 : 0.3);
            
            for (const plant of this.plants) {
                // Crecimiento
                if (plant.size < plant.maxSize) {
                    plant.growth += growthMultiplier * dt * plant.growthRate;
                    plant.size = plant.maxSize * Math.min(1, plant.growth);
                }
                
                // Salud según estación
                if (season === 'invierno' && this.temperature < 0) {
                    plant.health = Math.max(0.3, plant.health - dt * 0.01);
                } else if (season === 'verano' && this.emergency.drought) {
                    plant.health = Math.max(0.2, plant.health - dt * 0.02);
                } else {
                    plant.health = Math.min(1, plant.health + dt * 0.005);
                }
                
                // Renovación
                if (plant.health < 0.1 && Math.random() < 0.001) {
                    plant.health = 0.5 + Math.random() * 0.3;
                    plant.size = 0.1;
                    plant.growth = 0.1;
                }
            }
        }

        // ============================================================
        // ECOSISTEMA - ANIMALES
        // ============================================================

        _updateAnimals(dt) {
            const terrain = this.engine.terrainGen;
            if (!terrain) return;
            
            // Actualizar cada animal
            for (const a of this.animals) {
                if (a.health <= 0) continue;
                
                // Envejecimiento
                a.age += dt * 0.002;
                if (a.age > 1.5) {
                    a.health -= dt * 0.01;
                    if (a.health <= 0) continue;
                }
                
                // Necesidades vitales
                a.hunger = Math.min(1, a.hunger + dt * 0.02);
                a.thirst = Math.min(1, a.thirst + dt * 0.015);
                a.energy = Math.max(0, a.energy - dt * 0.01);
                
                // Estado de comportamiento
                this._updateAnimalBehavior(a, dt);
                
                // Movimiento
                this._updateAnimalMovement(a, dt, terrain);
                
                // Interacciones sociales y depredación
                this._updateAnimalInteractions(a, dt);
                
                // Reproducción
                this._updateAnimalReproduction(a, dt);
                
                // Mantener dentro de límites
                const lim = 180;
                if (Math.abs(a.pos.x) > lim) a.vel.x -= Math.sign(a.pos.x) * 10 * dt;
                if (Math.abs(a.pos.z) > lim) a.vel.z -= Math.sign(a.pos.z) * 10 * dt;
            }
            
            // Eliminar animales muertos
            this.animals = this.animals.filter(a => a.health > 0);
            
            // Reproducir animales si hay espacio
            if (this.animals.length < this.config.maxAnimals && Math.random() < 0.001) {
                this._spawnAnimal();
            }
        }

        _updateAnimalBehavior(animal, dt) {
            animal.stateTimer -= dt;
            
            // Actualizar necesidades y decidir estado
            if (animal.stateTimer <= 0) {
                const needs = {
                    hunger: animal.hunger,
                    thirst: animal.thirst,
                    energy: 1 - animal.energy,
                    danger: this._detectDanger(animal)
                };
                
                // Decisión basada en necesidades
                if (needs.hunger > 0.7 && !animal.prey) {
                    // Carnívoros cazan cuando tienen hambre
                    animal.state = ANIMAL_STATES.CAZANDO;
                    animal.stateTimer = 5 + Math.random() * 5;
                } else if (needs.hunger > 0.6 && animal.diet === 'herbivore') {
                    animal.state = ANIMAL_STATES.PSTANDO;
                    animal.stateTimer = 4 + Math.random() * 6;
                } else if (needs.thirst > 0.7) {
                    animal.state = ANIMAL_STATES.BEBiendo;
                    animal.stateTimer = 2 + Math.random() * 3;
                } else if (needs.energy < 0.3 && animal.energy < 0.4) {
                    animal.state = ANIMAL_STATES.DESCANSANDO;
                    animal.stateTimer = 3 + Math.random() * 5;
                } else if (needs.danger > 0.5) {
                    animal.state = ANIMAL_STATES.HUYENDO;
                    animal.stateTimer = 2 + Math.random() * 3;
                } else if (animal.social && Math.random() < 0.15) {
                    animal.state = ANIMAL_STATES.SOCIALIZANDO;
                    animal.stateTimer = 2 + Math.random() * 4;
                } else {
                    animal.state = ANIMAL_STATES.EXPLORANDO;
                    animal.stateTimer = 3 + Math.random() * 8;
                }
            }
            
            // Comportamiento específico
            switch(animal.state) {
                case ANIMAL_STATES.PSTANDO:
                    this._behaviorGrazing(animal, dt);
                    break;
                case ANIMAL_STATES.CAZANDO:
                    this._behaviorHunting(animal, dt);
                    break;
                case ANIMAL_STATES.HUYENDO:
                    this._behaviorFleeing(animal, dt);
                    break;
                case ANIMAL_STATES.BEBiendo:
                    this._behaviorDrinking(animal, dt);
                    break;
                case ANIMAL_STATES.DESCANSANDO:
                    this._behaviorResting(animal, dt);
                    break;
                case ANIMAL_STATES.SOCIALIZANDO:
                    this._behaviorSocializing(animal, dt);
                    break;
                default:
                    this._behaviorExploring(animal, dt);
                    break;
            }
        }

        _behaviorExploring(animal, dt) {
            if (!animal.targetPos || animal.pos.distanceTo(animal.targetPos) < 5) {
                animal.targetPos = new Vec3(
                    animal.pos.x + (Math.random() - 0.5) * 60,
                    0,
                    animal.pos.z + (Math.random() - 0.5) * 60
                );
            }
            this._moveToward(animal, animal.targetPos, 0.5);
        }

        _behaviorGrazing(animal, dt) {
            // Buscar comida cercana (plantas)
            let nearestPlant = null;
            let nearestDist = 30;
            
            for (const plant of this.plants) {
                if (!plant.edible || plant.health < 0.3) continue;
                const dist = animal.pos.distanceTo(plant.pos);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestPlant = plant;
                }
            }
            
            if (nearestPlant) {
                this._moveToward(animal, nearestPlant.pos, 0.3);
                if (nearestDist < 0.8) {
                    // Comer — bug real corregido: esto usaba la variable
                    // `plant` del for de arriba, que ya no existe fuera del
                    // loop (ReferenceError cada vez que un animal empezaba a
                    // pastar, o sea casi de inmediato). Al lanzar la
                    // excepción DENTRO de worldAI.update(), que corre antes
                    // que renderer.render() en el loop principal, ningún
                    // frame llegaba a dibujarse nunca más — visualmente
                    // idéntico a un congelamiento total.
                    nearestPlant.size *= 0.9;
                    nearestPlant.health *= 0.9;
                    animal.hunger = Math.max(0, animal.hunger - 0.1);
                    animal.energy = Math.min(1, animal.energy + 0.05);
                    animal.stateTimer = Math.max(1, animal.stateTimer - 0.5);
                }
            } else {
                // Explorar si no hay comida cerca
                this._behaviorExploring(animal, dt);
            }
        }

        _behaviorHunting(animal, dt) {
            // Buscar presa cercana
            let nearestPrey = null;
            let nearestDist = 50;
            
            for (const prey of this.animals) {
                if (prey === animal || !prey.prey) continue;
                const dist = animal.pos.distanceTo(prey.pos);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestPrey = prey;
                }
            }
            
            if (nearestPrey) {
                this._moveToward(animal, nearestPrey.pos, 1.1);
                if (nearestDist < 1.5) {
                    // Atacar
                    const attackPower = 0.3 + animal.personality.aggression * 0.3;
                    nearestPrey.health -= attackPower;
                    nearestPrey.state = ANIMAL_STATES.HUYENDO;
                    nearestPrey.stateTimer = 3;
                    animal.hunger = Math.max(0, animal.hunger - 0.15);
                    animal.energy = Math.min(1, animal.energy + 0.1);
                    animal.stateTimer = Math.max(1, animal.stateTimer - 1);
                }
            } else {
                // Explorar si no hay presas
                this._behaviorExploring(animal, dt);
            }
        }

        _behaviorFleeing(animal, dt) {
            // Huir de depredadores
            let nearestPredator = null;
            let nearestDist = 40;
            
            for (const predator of this.animals) {
                if (predator === animal || predator.prey) continue;
                const dist = animal.pos.distanceTo(predator.pos);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestPredator = predator;
                }
            }
            
            if (nearestPredator) {
                const fleeDir = animal.pos.clone().sub(nearestPredator.pos);
                fleeDir.y = 0;
                fleeDir.normalize().mul(50);
                const fleeTarget = animal.pos.clone().add(fleeDir);
                this._moveToward(animal, fleeTarget, 1.3);
            } else {
                animal.state = ANIMAL_STATES.EXPLORANDO;
                animal.stateTimer = 2 + Math.random() * 4;
            }
        }

        _behaviorDrinking(animal, dt) {
            // Buscar agua
            let nearestWater = null;
            let nearestDist = 50;
            
            for (const water of this.waterSources) {
                const dist = animal.pos.distanceTo(water.pos);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestWater = water;
                }
            }
            
            if (nearestWater) {
                this._moveToward(animal, nearestWater.pos, 0.4);
                if (nearestDist < 1.0) {
                    animal.thirst = Math.max(0, animal.thirst - 0.15);
                    animal.stateTimer = Math.max(1, animal.stateTimer - 0.5);
                }
            } else {
                this._behaviorExploring(animal, dt);
            }
        }

        _behaviorResting(animal, dt) {
            animal.vel.mul(0.95);
            animal.energy = Math.min(1, animal.energy + dt * 0.08);
            if (animal.energy > 0.8) {
                animal.state = ANIMAL_STATES.EXPLORANDO;
                animal.stateTimer = 2 + Math.random() * 4;
            }
        }

        _behaviorSocializing(animal, dt) {
            // Buscar miembros del grupo
            let nearestGroup = null;
            let nearestDist = 20;
            
            for (const other of this.animals) {
                if (other === animal || other.type !== animal.type) continue;
                const dist = animal.pos.distanceTo(other.pos);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestGroup = other;
                }
            }
            
            if (nearestGroup) {
                this._moveToward(animal, nearestGroup.pos, 0.3);
                if (nearestDist < 2) {
                    animal.stateTimer = Math.max(1, animal.stateTimer - 0.5);
                }
            } else {
                this._behaviorExploring(animal, dt);
            }
        }

        _updateAnimalMovement(animal, dt, terrain) {
            const speed = animal.speed * (animal.energy * 0.5 + 0.5);
            const maxSpeed = speed * (animal.state === ANIMAL_STATES.HUYENDO ? 1.5 : 1.0);
            
            // Limitar velocidad
            const vel = animal.vel.length();
            if (vel > maxSpeed) {
                animal.vel.mul(maxSpeed / vel);
            }
            
            // Aplicar movimiento
            animal.pos.addScaled(animal.vel, dt);
            
            // Terreno
            if (terrain) {
                const h = terrain.getHeight(animal.pos.x, animal.pos.z);
                if (animal.flying) {
                    const desired = h + 6 + Math.sin(this.time * 0.5 + animal.id * 2) * 2;
                    animal.pos.y += (desired - animal.pos.y) * dt * 2;
                } else {
                    animal.pos.y = h + animal.radius;
                }
            }
        }

        _updateAnimalInteractions(animal, dt) {
            // Interacciones con otros animales
            for (const other of this.animals) {
                if (other === animal || other.health <= 0) continue;
                const dist = animal.pos.distanceTo(other.pos);
                
                // Evitar colisiones
                if (dist < animal.radius + other.radius + 0.5) {
                    const pushDir = animal.pos.clone().sub(other.pos);
                    pushDir.y = 0;
                    if (pushDir.length() > 0) {
                        pushDir.normalize();
                        animal.pos.addScaled(pushDir, 0.02 * dt * 10);
                    }
                }
                
                // Reacción a depredadores
                if (animal.prey && !other.prey && dist < 15) {
                    if (animal.state !== ANIMAL_STATES.HUYENDO) {
                        animal.state = ANIMAL_STATES.HUYENDO;
                        animal.stateTimer = 3 + Math.random() * 2;
                    }
                }
            }
        }

        _updateAnimalReproduction(animal, dt) {
            if (animal.pregnant) {
                animal.gestationTimer += dt;
                if (animal.gestationTimer > 20) {
                    // Nacer cría
                    animal.pregnant = false;
                    animal.gestationTimer = 0;
                    this._spawnAnimalNear(animal.pos);
                }
                return;
            }
            
            // Buscar pareja
            if (animal.health > 0.7 && animal.energy > 0.6 && animal.hunger < 0.5) {
                for (const other of this.animals) {
                    if (other === animal || other.type !== animal.type || other.pregnant) continue;
                    if (other.health < 0.7) continue;
                    
                    const dist = animal.pos.distanceTo(other.pos);
                    if (dist < 3 && Math.random() < 0.001 * dt) {
                        // Reproducción
                        animal.pregnant = true;
                        animal.gestationTimer = 0;
                        other.pregnant = true;
                        other.gestationTimer = 0;
                        break;
                    }
                }
            }
        }

        _detectDanger(animal) {
            let danger = 0;
            for (const predator of this.animals) {
                if (predator === animal || predator.prey) continue;
                const dist = animal.pos.distanceTo(predator.pos);
                if (dist < 20) {
                    danger += (1 - dist / 20) * 0.5;
                }
            }
            // Incendios cercanos
            for (const fire of this.fires) {
                const dist = animal.pos.distanceTo(fire.pos);
                if (dist < 30) {
                    danger += (1 - dist / 30) * 0.3;
                }
            }
            return Math.min(1, danger);
        }

        _moveToward(animal, target, speedMod) {
            const dir = target.clone().sub(animal.pos);
            dir.y = 0;
            const dist = dir.length();
            if (dist < 0.5) return;
            
            dir.normalize().mul(animal.speed * speedMod);
            animal.vel.lerp(dir, 1 - Math.exp(-0.5));
        }

        _spawnAnimal() {
            const terrain = this.engine.terrainGen;
            if (!terrain) return;
            
            const species = ['ciervo', 'lobo', 'ave', 'conejo', 'zorro', 'jabalí'];
            const type = species[Math.floor(Math.random() * species.length)];
            
            let x, z, y, tries = 0;
            do {
                x = (Math.random() - 0.5) * 160;
                z = (Math.random() - 0.5) * 160;
                y = terrain.getHeight(x, z);
                tries++;
            } while ((y < 2 || y > 20) && tries < 15);
            
            if (tries < 15) {
                const speciesData = {
                    name: type,
                    speed: type === 'lobo' ? 8 : type === 'ave' ? 12 : type === 'conejo' ? 7 : 6,
                    radius: type === 'lobo' ? 0.4 : type === 'ave' ? 0.2 : type === 'conejo' ? 0.2 : 0.45,
                    prey: type !== 'lobo' && type !== 'zorro',
                    flying: type === 'ave',
                    social: type !== 'zorro' && type !== 'jabalí',
                    diet: type === 'lobo' || type === 'zorro' ? 'carnivore' : 'herbivore'
                };
                // Bug real corregido: antes el id era `this.animals.length + 1`,
                // que se repite en cuanto el array se acorta por muertes —
                // dos animales distintos terminaban con el mismo id y el
                // renderer de fauna (indexado por id) mezclaba sus mallas,
                // produciendo "animales" que saltaban de posición y forma.
                const id = this._nextAnimalId++;
                const animal = this._createAnimal(speciesData, x, y, z, id);
                this.animals.push(animal);
            }
        }

        _spawnAnimalNear(pos) {
            const terrain = this.engine.terrainGen;
            if (!terrain) return;
            
            const offset = new Vec3(
                (Math.random() - 0.5) * 5,
                0,
                (Math.random() - 0.5) * 5
            );
            const newPos = pos.clone().add(offset);
            const y = terrain.getHeight(newPos.x, newPos.z);
            newPos.y = y + 0.5;
            
            // Buscar animal adulto cercano para usar su tipo
            let parentType = 'ciervo';
            let parentSpecies = null;
            for (const a of this.animals) {
                if (a.pos.distanceTo(pos) < 3) {
                    parentType = a.type;
                    parentSpecies = a;
                    break;
                }
            }
            
            if (parentSpecies) {
                const child = this._createAnimal(
                    {
                        name: parentType,
                        speed: parentSpecies.speed,
                        radius: parentSpecies.radius * 0.6,
                        prey: parentSpecies.prey,
                        flying: parentSpecies.flying,
                        social: parentSpecies.social,
                        diet: parentSpecies.diet
                    },
                    newPos.x, newPos.y, newPos.z,
                    this._nextAnimalId++
                );
                child.radius *= 0.6;
                child.energy = 0.5;
                child.health = 0.6;
                this.animals.push(child);
            }
        }

        // ============================================================
        // INCENDIOS FORESTALES
        // ============================================================

        _updateFires(dt) {
            for (let i = this.fires.length - 1; i >= 0; i--) {
                const fire = this.fires[i];
                fire.life -= dt;
                fire.intensity *= (0.995 + Math.random() * 0.005);
                
                // Propagación
                if (fire.intensity > 0.3 && Math.random() < this.config.fireSpreadRate * dt * 0.5) {
                    this._spreadFire(fire);
                }
                
                // Efecto en el entorno
                if (fire.radius > 0) {
                    // Calor reduce humedad cerca
                    fire.radius += dt * 0.05;
                }
                
                if (fire.life <= 0 || fire.intensity < 0.05) {
                    this.fires.splice(i, 1);
                }
            }
        }

        _spreadFire(source) {
            const terrain = this.engine.terrainGen;
            if (!terrain) return;
            
            const angle = Math.random() * Math.PI * 2;
            const dist = 2 + Math.random() * 4;
            const x = source.pos.x + Math.cos(angle) * dist + this.wind.x * 0.3;
            const z = source.pos.z + Math.sin(angle) * dist + this.wind.z * 0.3;
            const y = terrain.getHeight(x, z);
            
            // Solo propagar en terrenos con vegetación
            if (y < 2 || y > 25) return;
            
            // Humedad reduce propagación
            if (this.humidity > 0.7 && Math.random() < 0.3) return;
            
            // No crear fuegos demasiado cerca
            for (const existing of this.fires) {
                if (new Vec3(x, y, z).distanceTo(existing.pos) < 5) return;
            }
            
            this.fires.push({
                pos: new Vec3(x, y, z),
                life: 15 + Math.random() * 25,
                intensity: 0.4 + Math.random() * 0.5,
                radius: 1 + Math.random() * 2,
                source: source
            });
            
            this.events.push({ type: 'fire', x, z, t: this.time });
        }

        _maybeIgnite(dt) {
            const season = this.getSeason();
            const drySeason = season === 'verano' || season === 'otoño';
            const dryWeather = this.weather === 'despejado' || this.weather === 'nublado';
            
            if (!drySeason || !dryWeather) return;
            if (this.fires.length >= 5) return;
            if (this.humidity > 0.5) return;
            
            const chance = this.config.fireChance * (1 - this.humidity) * 2;
            if (Math.random() < chance * dt * 60) {
                const terrain = this.engine.terrainGen;
                if (!terrain) return;
                
                let x, z, y, tries = 0;
                do {
                    x = (Math.random() - 0.5) * 140;
                    z = (Math.random() - 0.5) * 140;
                    y = terrain.getHeight(x, z);
                    tries++;
                } while ((y < 3 || y > 20) && tries < 15);
                
                if (tries < 15) {
                    this.fires.push({
                        pos: new Vec3(x, y, z),
                        life: 20 + Math.random() * 30,
                        intensity: 0.5 + Math.random() * 0.5,
                        radius: 1.5 + Math.random() * 2
                    });
                    this.events.push({ type: 'fire', x, z, t: this.time });
                }
            }
        }

        // ============================================================
        // EMERGENCIAS Y EVENTOS
        // ============================================================

        _checkEmergencies(dt) {
            // Sequía
            if (this.humidity < 0.2 && this.temperature > 28) {
                this.emergency.drought = true;
            } else if (this.humidity > 0.4) {
                this.emergency.drought = false;
            }
            
            // Ola de calor (ya gestionada en _onSeasonChange)
            
            // Tormenta de nieve
            if (this.weather === 'nieve' && this.temperature < -5 && this.windSpeed > 5) {
                this.emergency.blizzard = true;
            } else if (this.weather !== 'nieve') {
                this.emergency.blizzard = false;
            }
            
            // Incendio forestal
            if (this.fires.length >= 3 && this.humidity < 0.4) {
                this.emergency.wildfire = true;
            } else if (this.fires.length < 2) {
                this.emergency.wildfire = false;
            }
        }

        _triggerRandomEvent() {
            const events = [
                'tormenta eléctrica',
                'lluvia de meteoros',
                'migración de aves',
                'manada en movimiento',
                'floración primaveral',
                'niebla densa',
                'terremoto leve'
            ];
            
            const event = events[Math.floor(Math.random() * events.length)];
            this.events.push({ type: 'random', event, t: this.time });
            
            // Efectos del evento
            switch(event) {
                case 'tormenta eléctrica':
                    this.weather = 'tormenta';
                    this.weatherDuration = 10 + Math.random() * 15;
                    break;
                case 'migración de aves':
                    // Añadir aves temporales
                    for (let i = 0; i < 5; i++) {
                        this._spawnAnimalNear(new Vec3(
                            (Math.random() - 0.5) * 100,
                            20,
                            (Math.random() - 0.5) * 100
                        ));
                    }
                    break;
                case 'floración primaveral':
                    for (const plant of this.plants) {
                        if (plant.type === 'flor') {
                            plant.health = Math.min(1, plant.health + 0.2);
                            plant.size = Math.min(plant.maxSize, plant.size * 1.2);
                        }
                    }
                    break;
            }
        }

        _generateNarrative() {
            // Crear una narrativa basada en eventos recientes
            const recentEvents = this.events.slice(-5);
            if (recentEvents.length < 3) return;
            
            let narrative = '';
            const fires = recentEvents.filter(e => e.type === 'fire');
            const weather = recentEvents.filter(e => e.type === 'weather');
            const seasons = recentEvents.filter(e => e.type === 'season');
            
            if (fires.length > 2 && this.emergency.wildfire) {
                narrative = `🔥 Un gran incendio forestal está arrasando la región. La fauna huye hacia zonas más seguras.`;
            } else if (weather.length > 0 && weather[weather.length - 1].weather === 'tormenta') {
                narrative = `⚡ Una tormenta eléctrica ilumina el cielo. El viento azota los árboles.`;
            } else if (seasons.length > 0) {
                const season = seasons[seasons.length - 1].season;
                if (season === 'primavera') narrative = `🌱 La primavera ha llegado. La vida florece en el bosque.`;
                else if (season === 'verano') narrative = `☀️ El verano calienta la tierra. Los animales buscan sombra.`;
                else if (season === 'otoño') narrative = `🍂 El otoño tiñe el bosque de colores cálidos.`;
                else if (season === 'invierno') narrative = `❄️ El invierno cubre el paisaje de nieve. La vida se ralentiza.`;
            }
            
            if (narrative) {
                console.log('%c📖 [WorldAI] Narrativa: ' + narrative, 'color:#fbbf24');
                this.events.push({ type: 'narrative', text: narrative, t: this.time });
            }
        }

        // ============================================================
        // EFECTOS VISUALES EN EL RENDERIZADOR
        // ============================================================

        _applyWorldEffects() {
            const scene = this.engine.scene;
            if (!scene) return;
            
            // Niebla según clima
            const fogMap = {
                'niebla': { density: 0.006, color: [0.7, 0.75, 0.8] },
                'lluvia': { density: 0.0035, color: [0.4, 0.45, 0.5] },
                'tormenta': { density: 0.004, color: [0.35, 0.38, 0.42] },
                'nieve': { density: 0.0028, color: [0.75, 0.8, 0.88] },
                'nublado': { density: 0.002, color: [0.55, 0.6, 0.68] },
                'despejado': { density: 0.0014, color: [0.55, 0.68, 0.82] }
            };
            
            const fog = fogMap[this.weather] || fogMap['despejado'];
            scene.fogDensity = fog.density;
            scene.fogColor.set(fog.color[0], fog.color[1], fog.color[2]);
            
            // Luz ambiental según nubosidad
            const ambientIntensity = 0.15 + (1 - this.cloudCover) * 0.25;
            scene.ambientColor.set(
                0.12 + ambientIntensity * 0.3,
                0.15 + ambientIntensity * 0.25,
                0.2 + ambientIntensity * 0.3
            );
            
            // Viento (visual)
            scene.wind = this.wind.clone();
            scene.windStrength = this.windSpeed * 0.008;
        }

        // ============================================================
        // API PÚBLICA
        // ============================================================

        getSeason() { return SEASONS[this.seasonIndex]; }
        getSeasonBlend() { return this.seasonProgress; }

        getStatus() {
            return {
                season: this.getSeason(),
                weather: this.weather,
                weatherIntensity: this.weatherIntensity,
                temperature: Math.round(this.temperature),
                humidity: Math.round(this.humidity * 100),
                wind: this.wind.length().toFixed(1),
                cloudCover: Math.round(this.cloudCover * 100),
                animals: this.animals.length,
                fires: this.fires.length,
                plants: this.plants.length,
                dayTime: Math.round(this.dayTime * 100) / 100,
                dayCount: this.dayCount,
                emergencies: Object.keys(this.emergency).filter(k => this.emergency[k]),
                events: this.events.slice(-3)
            };
        }

        getEcosystemHealth() {
            const animalHealth = this.animals.reduce((sum, a) => sum + a.health, 0) / this.animals.length || 0;
            const plantHealth = this.plants.reduce((sum, p) => sum + p.health, 0) / this.plants.length || 0;
            return {
                animalHealth: Math.round(animalHealth * 100),
                plantHealth: Math.round(plantHealth * 100),
                biodiversity: Math.min(1, this.animals.length / this.config.maxAnimals),
                overall: Math.round((animalHealth * 0.6 + plantHealth * 0.4) * 100)
            };
        }

        forceWeather(weather) {
            if (WEATHERS.includes(weather)) {
                this.weather = weather;
                this.weatherTimer = 0;
                this.weatherDuration = 30 + Math.random() * 30;
                this.events.push({ type: 'force_weather', weather, t: this.time });
            }
        }

        getAnimalsInArea(center, radius) {
            return this.animals.filter(a => a.pos.distanceTo(center) < radius);
        }
    }

    global.PriomGL.WorldAI = WorldAI;

})(typeof window !== 'undefined' ? window : globalThis);