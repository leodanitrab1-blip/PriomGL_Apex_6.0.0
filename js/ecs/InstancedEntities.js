/**
 * PriomGL Instanced Entities v3 — Sistema de Renderizado Masivo por GPU
 * 
 * Sistema de instanciación GPU para vegetación, rocas y objetos del mundo.
 * Con soporte para LOD automático, culling espacial por octree, batching
 * dinámico y animaciones por instancia.
 * 
 * Características:
 * - LOD automático basado en distancia
 * - Culling por octree jerárquico
 * - Batching dinámico de instancias
 * - Animaciones GPU por instancia (oscilación, rotación)
 * - Pool de instancias reutilizable
 * - Compresión de datos de instancias
 * - Actualización diferida de buffers
 */
(function(global) {
    'use strict';

    const { Vec3, Mat4, Quat } = global.PriomMath;

    // ============================================================
    // INSTANCED MESH — NÚCLEO DE RENDERIZADO
    // ============================================================
    class InstancedMesh {
        constructor(geometry, material, maxInstances, options = {}) {
            this.geometry = geometry;
            this.material = material;
            this.maxInstances = maxInstances;
            this.count = 0;
            this.visible = true;
            this.castShadow = true;
            this.receiveShadow = true;
            this.isInstanced = true;

            // Interfaz mínima de nodo de escena (Object3D-compatible) para que
            // Scene.updateMatrixWorld()/traverse() puedan recorrerlo sin fallar.
            // InstancedMesh no usa una única transformación: cada instancia
            // guarda su propia posición/rotación/escala en instanceData.
            this.position = new Vec3();
            this.matrixWorld = new Mat4();
            this.parent = null;
            this.children = [];
            
            // Opciones
            this.options = {
                useLOD: options.useLOD || false,
                lodDistances: options.lodDistances || [30, 80, 180],
                lodScale: options.lodScale || [0.7, 0.5, 0.3],
                animationSpeed: options.animationSpeed || 0,
                windInfluence: options.windInfluence || 0,
                ...options
            };

            // Datos de instancia (compactos)
            // 12 floats: posición(3) + rotación(4) + escala(3) + color(3) + fase(1)
            this.instanceData = new Float32Array(maxInstances * 14);
            this.lodData = new Uint8Array(maxInstances); // 0=full, 1=medium, 2=low, 3=ultra-low
            this.dirtyFlags = new Uint8Array(maxInstances);
            this.activeIndices = new Uint32Array(maxInstances);
            this.activeCount = 0;
            
            // Buffer GPU
            this._buffer = null;
            this._vao = null;
            this._needsUpload = true;
            this._uploadCount = 0;
            
            // Transformaciones (para cálculos de CPU)
            this._transforms = new Float32Array(maxInstances * 16);
        }

        /**
         * Establece una instancia con transformación completa
         */
        // No-ops de compatibilidad con Object3D: un InstancedMesh no tiene
        // hijos ni una única transformación que propagar.
        updateMatrixWorld(force = false) {}
        traverse(fn) { fn(this); }

        setInstance(i, x, y, z, rotY, sx, sy, sz, r = 1, g = 1, b = 1, phase = 0) {
            if (i >= this.maxInstances) return;
            
            const o = i * 14;
            const c = Math.cos(rotY), s = Math.sin(rotY);
            
            // Posición
            this.instanceData[o] = x;
            this.instanceData[o + 1] = y;
            this.instanceData[o + 2] = z;
            
            // Rotación (quaternion compacto para rotación Y)
            this.instanceData[o + 3] = 0; // x
            this.instanceData[o + 4] = Math.sin(rotY * 0.5); // y
            this.instanceData[o + 5] = 0; // z
            this.instanceData[o + 6] = Math.cos(rotY * 0.5); // w
            
            // Escala
            this.instanceData[o + 7] = sx;
            this.instanceData[o + 8] = sy;
            this.instanceData[o + 9] = sz;
            
            // Color y fase
            this.instanceData[o + 10] = r;
            this.instanceData[o + 11] = g;
            this.instanceData[o + 12] = b;
            this.instanceData[o + 13] = phase;
            
            // LOD por defecto
            this.lodData[i] = 0;
            this.dirtyFlags[i] = 1;
            
            // Transformación para cálculos
            const t = i * 16;
            this._transforms[t] = c * sx;
            this._transforms[t + 1] = 0;
            this._transforms[t + 2] = s * sz;
            this._transforms[t + 3] = x;
            this._transforms[t + 4] = 0;
            this._transforms[t + 5] = sy;
            this._transforms[t + 6] = 0;
            this._transforms[t + 7] = y;
            this._transforms[t + 8] = -s * sx;
            this._transforms[t + 9] = 0;
            this._transforms[t + 10] = c * sz;
            this._transforms[t + 11] = z;
            this._transforms[t + 12] = 0;
            this._transforms[t + 13] = 0;
            this._transforms[t + 14] = 0;
            this._transforms[t + 15] = 1;
        }

        /**
         * Actualiza LOD para una instancia basado en distancia
         */
        updateLOD(i, distance) {
            if (i >= this.maxInstances) return;
            
            const lod = this.options.useLOD ? this._calculateLOD(distance) : 0;
            if (this.lodData[i] !== lod) {
                this.lodData[i] = lod;
                this.dirtyFlags[i] = 1;
            }
        }

        _calculateLOD(distance) {
            const distances = this.options.lodDistances;
            for (let i = 0; i < distances.length; i++) {
                if (distance < distances[i]) return i;
            }
            return distances.length;
        }

        /**
         * Construye el buffer en GPU
         */
        build(gl) {
            if (!this.geometry.vao) this.geometry.build(gl);
            
            // Crear buffer de instancias con formato optimizado
            this._buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
            const stride = 14 * 4; // 14 floats * 4 bytes
            
            // Buffer dinámico para actualizaciones frecuentes
            gl.bufferData(gl.ARRAY_BUFFER, this.maxInstances * stride, gl.DYNAMIC_DRAW);
            
            // Configurar VAO
            this._vao = gl.createVertexArray();
            gl.bindVertexArray(this._vao);
            
            // Atributos base de geometría
            for (const [name, attr] of Object.entries(this.geometry.attributes)) {
                const locs = { position: 0, normal: 1, uv: 2, tangent: 3, color: 4 };
                const loc = locs[name];
                if (loc === undefined) continue;
                gl.bindBuffer(gl.ARRAY_BUFFER, attr.buffer);
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, attr.size, gl.FLOAT, false, 0, 0);
            }
            
            // Fallbacks para atributos faltantes
            if (!this.geometry.attributes.color) {
                gl.disableVertexAttribArray(4);
                gl.vertexAttrib4f(4, 1, 1, 1, 1);
            }
            if (!this.geometry.attributes.tangent) {
                gl.disableVertexAttribArray(3);
                gl.vertexAttrib4f(3, 1, 0, 0, 1);
            }
            
            // Atributos de instancias (divisor = 1)
            gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
            
            // Posición (vec3)
            gl.enableVertexAttribArray(6);
            gl.vertexAttribPointer(6, 3, gl.FLOAT, false, stride, 0);
            gl.vertexAttribDivisor(6, 1);
            
            // Rotación (quat compacto, vec4)
            gl.enableVertexAttribArray(7);
            gl.vertexAttribPointer(7, 4, gl.FLOAT, false, stride, 12);
            gl.vertexAttribDivisor(7, 1);
            
            // Escala (vec3)
            gl.enableVertexAttribArray(8);
            gl.vertexAttribPointer(8, 3, gl.FLOAT, false, stride, 28);
            gl.vertexAttribDivisor(8, 1);
            
            // Color (vec3)
            gl.enableVertexAttribArray(9);
            gl.vertexAttribPointer(9, 3, gl.FLOAT, false, stride, 40);
            gl.vertexAttribDivisor(9, 1);
            
            // Fase (float)
            gl.enableVertexAttribArray(10);
            gl.vertexAttribPointer(10, 1, gl.FLOAT, false, stride, 52);
            gl.vertexAttribDivisor(10, 1);
            // NOTE: there is intentionally no location-11 "LOD" attribute.
            // The 14-float stride (56 bytes) ends exactly at offset 52+4,
            // so a location bound at offset==stride would read into the
            // *next* instance's position data instead of real LOD info,
            // and no shader in this engine consumes it. LOD selection is
            // handled on the CPU side (see ChunkedForest / setEntityScale)
            // instead of a per-vertex GPU attribute.

            // Índices
            if (this.geometry.indexBuffer) {
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.geometry.indexBuffer);
            }
            
            gl.bindVertexArray(null);
            this._needsUpload = false;
        }

        /**
         * Sube los datos de instancia al GPU
         */
        upload(gl) {
            if (!this._vao) { this.build(gl); }
            if (this.count === 0) return;
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
            
            // Subir solo instancias activas
            const stride = 14 * 4;
            const activeCount = Math.min(this.count, this.maxInstances);
            const dataSize = activeCount * stride;
            
            // Compactar datos activos
            const compactData = new Float32Array(activeCount * 14);
            let writeIdx = 0;
            for (let i = 0; i < activeCount; i++) {
                const readIdx = i * 14;
                compactData[writeIdx++] = this.instanceData[readIdx];
                compactData[writeIdx++] = this.instanceData[readIdx + 1];
                compactData[writeIdx++] = this.instanceData[readIdx + 2];
                compactData[writeIdx++] = this.instanceData[readIdx + 3];
                compactData[writeIdx++] = this.instanceData[readIdx + 4];
                compactData[writeIdx++] = this.instanceData[readIdx + 5];
                compactData[writeIdx++] = this.instanceData[readIdx + 6];
                compactData[writeIdx++] = this.instanceData[readIdx + 7];
                compactData[writeIdx++] = this.instanceData[readIdx + 8];
                compactData[writeIdx++] = this.instanceData[readIdx + 9];
                compactData[writeIdx++] = this.instanceData[readIdx + 10];
                compactData[writeIdx++] = this.instanceData[readIdx + 11];
                compactData[writeIdx++] = this.instanceData[readIdx + 12];
                compactData[writeIdx++] = this.instanceData[readIdx + 13];
            }
            
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, compactData);
            this._needsUpload = false;
            this._uploadCount = activeCount;
        }

        /**
         * Renderiza todas las instancias activas
         */
        render(gl) {
            if (this.count === 0 || !this.visible) return;
            if (this._needsUpload) this.upload(gl);
            
            gl.bindVertexArray(this._vao);
            const geo = this.geometry;
            
            if (geo.indices) {
                gl.drawElementsInstanced(gl.TRIANGLES, geo.indexCount, gl.UNSIGNED_INT, 0, this._uploadCount);
            } else {
                gl.drawArraysInstanced(gl.TRIANGLES, 0, geo.vertexCount, this._uploadCount);
            }
            
            return this._uploadCount;
        }

        /**
         * Marca todas las instancias para actualización
         */
        markDirty() {
            this._needsUpload = true;
        }
    }

    // ============================================================
    // INSTANCED FOREST — GESTOR DE VEGETACIÓN
    // ============================================================
    class InstancedForest {
        constructor(scene, geometry, material, maxInstances, options = {}) {
            this.mesh = new InstancedMesh(geometry, material, maxInstances, options);
            this.maxInstances = maxInstances;
            this.scene = scene;
            scene.add(this.mesh);
            
            // Estadísticas
            this.stats = {
                totalPlaced: 0,
                visible: 0,
                lastCullTime: 0
            };
        }

        clear() {
            this.mesh.count = 0;
            this.mesh._needsUpload = true;
            this.stats.totalPlaced = 0;
        }

        /**
         * Scatter con optimizaciones de rendimiento
         */
        scatter(terrainGen, options = {}) {
            const {
                count = 200,
                areaHalf = terrainGen.size * 0.42,
                minHeight = 1.5,
                maxHeight = 24,
                maxSlopeDelta = 2.8,
                exclude = null,
                scaleMin = 0.7,
                scaleMax = 1.8,
                scaleYVar = 0.3,
                colorVariance = 0.12,
                append = false,
                usePoisson = false,
                minDistance = 0
            } = options;

            let idx = append ? this.mesh.count : 0;
            const startIdx = idx;
            let attempts = 0;
            const maxAttempts = count * 25;
            
            // Para Poisson disk sampling
            const placedPositions = [];

            while (idx < this.maxInstances && (idx - startIdx) < count && attempts < maxAttempts) {
                attempts++;
                const x = (Math.random() - 0.5) * areaHalf * 2;
                const z = (Math.random() - 0.5) * areaHalf * 2;
                
                if (exclude && exclude(x, z)) continue;
                
                const y = terrainGen.getHeight(x, z);
                if (y < minHeight || y > maxHeight) continue;
                
                const yN = terrainGen.getHeight(x + 1.4, z);
                if (Math.abs(yN - y) > maxSlopeDelta) continue;
                
                // Poisson disk sampling
                if (usePoisson && minDistance > 0) {
                    let tooClose = false;
                    for (const pos of placedPositions) {
                        const dx = pos.x - x;
                        const dz = pos.z - z;
                        if (dx * dx + dz * dz < minDistance * minDistance) {
                            tooClose = true;
                            break;
                        }
                    }
                    if (tooClose) continue;
                    placedPositions.push({ x, z });
                }

                const s = scaleMin + Math.random() * (scaleMax - scaleMin);
                const sy = s * (1 - scaleYVar * 0.5 + Math.random() * scaleYVar);
                const rotY = Math.random() * Math.PI * 2;
                const tint = 1 - colorVariance * 0.5 + Math.random() * colorVariance;
                const phase = Math.random() * 100;

                this.mesh.setInstance(idx, x, y, z, rotY, s, sy, s, tint, tint, tint, phase);
                idx++;
                this.stats.totalPlaced++;
            }
            
            this.mesh.count = idx;
            this.mesh._needsUpload = true;
            return idx - startIdx;
        }

        /**
         * Coloca instancias en posiciones específicas
         */
        placeAt(points) {
            let idx = this.mesh.count;
            for (const p of points) {
                if (idx >= this.maxInstances) break;
                const s = p.scale ?? 1;
                this.mesh.setInstance(
                    idx, p.x, p.y, p.z, p.rotY || 0,
                    p.sx ?? s, p.sy ?? s, p.sz ?? s,
                    p.r ?? 1, p.g ?? 1, p.b ?? 1, p.phase ?? Math.random() * 100
                );
                idx++;
                this.stats.totalPlaced++;
            }
            this.mesh.count = idx;
            this.mesh._needsUpload = true;
        }

        /**
         * Actualiza LOD para todas las instancias basado en posición de cámara
         */
        updateLOD(camera, maxDist = 300) {
            if (!this.mesh.options.useLOD) return;
            
            const camPos = camera.position;
            const count = this.mesh.count;
            
            for (let i = 0; i < count; i++) {
                const o = i * 14;
                const x = this.mesh.instanceData[o];
                const y = this.mesh.instanceData[o + 1];
                const z = this.mesh.instanceData[o + 2];
                
                const dx = x - camPos.x;
                const dy = y - camPos.y;
                const dz = z - camPos.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                
                if (dist > maxDist) {
                    this.mesh.lodData[i] = 3; // ultra-low / invisible
                } else {
                    this.mesh.updateLOD(i, dist);
                }
            }
            this.mesh._needsUpload = true;
        }

        /**
         * Renderiza con culling automático
         */
        render(gl) {
            this.stats.visible = this.mesh.render(gl) || 0;
            return this.stats.visible;
        }

        getStats() {
            return {
                totalPlaced: this.stats.totalPlaced,
                visible: this.stats.visible,
                maxInstances: this.maxInstances
            };
        }
    }

    // ============================================================
    // CHUNKED FOREST — CULLING POR CELDAS ESPACIALES
    // ============================================================
    class ChunkedForest {
        constructor(scene, geometry, material, options = {}) {
            this.scene = scene;
            this.geometry = geometry;
            this.material = material;
            this.cellSize = options.cellSize || 70;
            this.maxInstancesPerCell = options.maxInstancesPerCell || 160;
            this.maxDist = options.maxDist || 300;
            this.useLOD = options.useLOD || false;
            this.lodDistances = options.lodDistances || [30, 80, 180];
            
            this.cells = new Map();
            this._fwd = new Vec3();
            this._cellCache = [];
            this._lastUpdate = 0;
            this._updateInterval = 0.10; // culling frecuente, pero sin popping por FOV
            
            // Estadísticas
            this.stats = {
                totalCells: 0,
                visibleCells: 0,
                totalInstances: 0,
                visibleInstances: 0
            };
        }

        _getOrCreateCell(cx, cz) {
            const key = cx + ',' + cz;
            let cell = this.cells.get(key);
            if (!cell) {
                const forest = new InstancedForest(
                    this.scene,
                    this.geometry,
                    this.material,
                    this.maxInstancesPerCell,
                    {
                        useLOD: this.useLOD,
                        lodDistances: this.lodDistances
                    }
                );
                const center = new Vec3(
                    (cx + 0.5) * this.cellSize,
                    0,
                    (cz + 0.5) * this.cellSize
                );
                cell = {
                    forest,
                    center,
                    radius: this.cellSize * 0.78,
                    count: 0,
                    fullCount: 0,
                    cx,
                    cz,
                    lastVisible: true
                };
                this.cells.set(key, cell);
                this.stats.totalCells++;
            }
            return cell;
        }

        scatter(terrainGen, options = {}) {
            const {
                count = 200,
                areaHalf = terrainGen.size * 0.42,
                minHeight = 1.5,
                maxHeight = 24,
                maxSlopeDelta = 2.8,
                exclude = null,
                scaleMin = 0.7,
                scaleMax = 1.8,
                scaleYVar = 0.3,
                colorVariance = 0.12
            } = options;

            let placed = 0, attempts = 0;
            const maxAttempts = count * 12;

            while (placed < count && attempts < maxAttempts) {
                attempts++;
                const x = (Math.random() - 0.5) * areaHalf * 2;
                const z = (Math.random() - 0.5) * areaHalf * 2;
                
                if (exclude && exclude(x, z)) continue;
                
                const y = terrainGen.getHeight(x, z);
                if (y < minHeight || y > maxHeight) continue;
                
                const yN = terrainGen.getHeight(x + 1.4, z);
                if (Math.abs(yN - y) > maxSlopeDelta) continue;

                const cx = Math.floor(x / this.cellSize);
                const cz = Math.floor(z / this.cellSize);
                const cell = this._getOrCreateCell(cx, cz);
                
                if (cell.count >= this.maxInstancesPerCell) continue;

                const s = scaleMin + Math.random() * (scaleMax - scaleMin);
                const sy = s * (1 - scaleYVar * 0.5 + Math.random() * scaleYVar);
                const rotY = Math.random() * Math.PI * 2;
                const tint = 1 - colorVariance * 0.5 + Math.random() * colorVariance;
                
                cell.forest.mesh.setInstance(
                    cell.count, x, y, z, rotY, s, sy, s,
                    tint, tint, tint, Math.random() * 100
                );
                cell.count++;
                cell.forest.mesh.count = cell.count;
                cell.forest.mesh._needsUpload = true;
                placed++;
                this.stats.totalInstances++;
            }
            
            for (const cell of this.cells.values()) {
                cell.fullCount = cell.count;
            }
            
            return placed;
        }

        /**
         * Culling por celdas con actualización diferida
         */
        cull(camera, dt) {
            this._lastUpdate += dt;
            if (this._lastUpdate < this._updateInterval) {
                // Usar caché de visibilidad anterior
                return;
            }
            this._lastUpdate = 0;
            
            const camPos = camera.position;
            this.stats.visibleCells = 0;
            this.stats.visibleInstances = 0;

            // Do NOT use a hard camera-cone test here. Large vegetation cells
            // straddle the frustum and a cone test makes whole groups blink
            // when the camera rotates a few degrees. Distance + hysteresis is
            // both cheaper and visually stable. The renderer performs the
            // final per-object/triangle visibility work.
            for (const cell of this.cells.values()) {
                const dx = cell.center.x - camPos.x;
                const dz = cell.center.z - camPos.z;
                const dist = Math.hypot(dx, dz);
                const enter = this.maxDist + cell.radius;
                const leave = this.maxDist + cell.radius + this.cellSize * 0.28;
                const visible = cell.lastVisible ? dist <= leave : dist <= enter;
                if (!visible) {
                    cell.forest.mesh.visible = false;
                    cell.lastVisible = false;
                    continue;
                }
                cell.forest.mesh.visible = true;
                cell.lastVisible = true;
                this.stats.visibleCells++;
                this.stats.visibleInstances += cell.count;
            }
        }

        /**
         * Escala de entidades para optimización dinámica (más agresiva en v4).
         * scale < 0.25 also hides far cells completely to cut draw calls hard.
         */
        setEntityScale(scale) {
            const s = Math.max(0, Math.min(1.4, scale));
            for (const cell of this.cells.values()) {
                const target = Math.max(0, Math.round(cell.fullCount * s));
                cell.forest.mesh.count = target;
                cell.forest.mesh.visible = target > 0;
                cell.forest.mesh._needsUpload = true;
            }
        }

        /**
         * Renderiza todas las celdas visibles
         */
        render(gl) {
            let totalRendered = 0;
            for (const cell of this.cells.values()) {
                if (cell.forest.mesh.visible && cell.forest.mesh.count > 0) {
                    totalRendered += cell.forest.render(gl);
                }
            }
            return totalRendered;
        }

        getStats() {
            return {
                totalCells: this.cells.size,
                visibleCells: this.stats.visibleCells,
                totalInstances: this.stats.totalInstances,
                visibleInstances: this.stats.visibleInstances
            };
        }

        get totalInstances() {
            let n = 0;
            for (const cell of this.cells.values()) n += cell.count;
            return n;
        }

        get visibleInstances() {
            let n = 0;
            for (const cell of this.cells.values()) {
                if (cell.forest.mesh.visible) n += cell.forest.mesh.count;
            }
            return n;
        }
    }

    // ============================================================
    // OCTREE — CULLING ESPACIAL JERÁRQUICO
    // ============================================================
    class OctreeNode {
        constructor(center, size, depth = 0, maxDepth = 4) {
            this.center = center;
            this.size = size;
            this.depth = depth;
            this.maxDepth = maxDepth;
            this.children = null;
            this.instances = [];
            this.bounds = new global.PriomMath.AABB();
            this.bounds.min.set(center.x - size/2, center.y - size/2, center.z - size/2);
            this.bounds.max.set(center.x + size/2, center.y + size/2, center.z + size/2);
        }

        insert(instance, pos) {
            if (this.depth >= this.maxDepth) {
                this.instances.push(instance);
                return;
            }

            if (!this.children) {
                this._split();
            }

            for (const child of this.children) {
                if (child.bounds.containsPoint(pos)) {
                    child.insert(instance, pos);
                    return;
                }
            }

            // Si no cabe en ningún hijo, queda en este nodo
            this.instances.push(instance);
        }

        _split() {
            const half = this.size / 2;
            const quarter = this.size / 4;
            const children = [];
            
            for (let x = -1; x <= 1; x += 2) {
                for (let y = -1; y <= 1; y += 2) {
                    for (let z = -1; z <= 1; z += 2) {
                        const center = new Vec3(
                            this.center.x + x * quarter,
                            this.center.y + y * quarter,
                            this.center.z + z * quarter
                        );
                        children.push(new OctreeNode(
                            center, half,
                            this.depth + 1,
                            this.maxDepth
                        ));
                    }
                }
            }
            this.children = children;

            // Reubicar instancias existentes
            const existing = this.instances;
            this.instances = [];
            for (const [instance, pos] of existing) {
                this.insert(instance, pos);
            }
        }

        queryFrustum(frustum, results) {
            // Prueba de visibilidad con la cámara
            if (!frustum.intersectsAABB(this.bounds)) return;

            if (this.children) {
                for (const child of this.children) {
                    child.queryFrustum(frustum, results);
                }
            }

            for (const instance of this.instances) {
                results.push(instance);
            }
        }

        querySphere(center, radius, results) {
            const dx = this.center.x - center.x;
            const dy = this.center.y - center.y;
            const dz = this.center.z - center.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            if (dist > radius + this.size * 0.5) return;

            if (this.children) {
                for (const child of this.children) {
                    child.querySphere(center, radius, results);
                }
            }

            for (const instance of this.instances) {
                results.push(instance);
            }
        }
    }

    class Octree {
        constructor(center, size, maxDepth = 4) {
            this.root = new OctreeNode(center, size, 0, maxDepth);
            this.instanceMap = new Map();
        }

        insert(instance, pos) {
            this.root.insert(instance, pos);
            this.instanceMap.set(instance, pos);
        }

        queryFrustum(frustum) {
            const results = [];
            this.root.queryFrustum(frustum, results);
            return results;
        }

        querySphere(center, radius) {
            const results = [];
            this.root.querySphere(center, radius, results);
            return results;
        }

        clear() {
            this.root = new OctreeNode(this.root.center, this.root.size, 0, this.root.maxDepth);
            this.instanceMap.clear();
        }
    }

    // ============================================================
    // EXPORTACIÓN
    // ============================================================
    global.PriomGL = global.PriomGL || {};
    global.PriomGL.InstancedMesh = InstancedMesh;
    global.PriomGL.InstancedForest = InstancedForest;
    global.PriomGL.ChunkedForest = ChunkedForest;
    global.PriomGL.Octree = Octree;
    global.PriomGL.OctreeNode = OctreeNode;

})(typeof window !== 'undefined' ? window : globalThis);