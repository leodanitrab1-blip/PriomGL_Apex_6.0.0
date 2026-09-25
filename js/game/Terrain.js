/**
 * PriomGL Procedural Terrain - Multi-octave noise heightmap with LOD-ready geometry
 */
(function(global) {
    'use strict';

    const { Vec3, Color } = global.PriomMath;
    const { Geometry, Material, Mesh } = global.PriomGL;

    class TerrainGenerator {
        constructor(options = {}) {
            this.size = options.size || 400;
            this.segments = options.segments || 192;
            this.maxHeight = options.maxHeight || 32;
            // A world is only "procedural" if it's actually different each
            // time — previously the seed defaulted to a fixed 42, so every
            // single load produced the exact same mountain. Now it's random
            // per session unless the caller explicitly asks for a specific
            // seed (useful for sharing/reproducing a world later).
            this.seed = options.seed !== undefined ? options.seed : Math.floor(Math.random() * 1000000);
            this.moistureSeedOffset = 7331.5;
            this._waterLevel = null; // computed lazily on first query
            this._riverSeed = this.seed * 0.777 + 91.3;
        }

        _hash(x, z, seedOffset = 0) {
            let n = Math.sin(x * 127.1 + z * 311.7 + (this.seed + seedOffset) * 0.1) * 43758.5453123;
            return n - Math.floor(n);
        }

        _noise(x, z, seedOffset = 0) {
            const ix = Math.floor(x), iz = Math.floor(z);
            const fx = x - ix, fz = z - iz;
            const ux = fx * fx * (3 - 2 * fx);
            const uz = fz * fz * (3 - 2 * fz);
            const a = this._hash(ix, iz, seedOffset);
            const b = this._hash(ix + 1, iz, seedOffset);
            const c = this._hash(ix, iz + 1, seedOffset);
            const d = this._hash(ix + 1, iz + 1, seedOffset);
            return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
        }

        _fbm(x, z, octaves = 6, seedOffset = 0) {
            let v = 0, a = 0.5, f = 1;
            for (let i = 0; i < octaves; i++) {
                v += a * this._noise(x * f, z * f, seedOffset);
                a *= 0.5;
                f *= 2.03;
            }
            return v;
        }

        _ridged(x, z, octaves = 4, seedOffset = 0) {
            let v = 0, a = 0.5, f = 1;
            for (let i = 0; i < octaves; i++) {
                const n = 1.0 - Math.abs(this._noise(x * f, z * f, seedOffset) * 2 - 1);
                v += a * n * n;
                a *= 0.5;
                f *= 2.1;
            }
            return v;
        }

        // Domain warping: sample the height field at a position that's
        // itself been displaced by a lower-frequency noise field. This is
        // what turns "obviously tiled Perlin noise" into ridgelines and
        // valleys that read as actually eroded terrain instead of a blob.
        _warp(x, z) {
            const s = 0.006;
            const wx = this._fbm(x * s + 4.2, z * s - 8.1, 4, 100) * 2 - 1;
            const wz = this._fbm(x * s - 3.7, z * s + 6.4, 4, 200) * 2 - 1;
            const warpStrength = this.size * 0.09;
            return [x + wx * warpStrength, z + wz * warpStrength];
        }

        // 0..1 field, independent from height — drives biome variety
        // (forest vs. dry scree vs. lush meadow) instead of vegetation just
        // being scattered uniformly regardless of terrain character.
        getMoisture(x, z) {
            const s = 0.0035;
            return this._fbm(x * s + 50, z * s - 50, 4, 900) ** 0.85;
        }

        // Distance (signed, meters) to the nearest point of the procedural
        // river's meandering centerline. Used both to carve the channel and
        // to know where the water plane should actually sit.
        _riverDistance(x, z) {
            // The river runs roughly along X, meandering in Z with noise,
            // so it always crosses the whole map instead of being a token
            // pond in a corner.
            const t = x * 0.01;
            const meander = (this._fbm(t * 3 + this._riverSeed, 0, 4, 500) - 0.5) * this.size * 0.55;
            const centerZ = meander;
            return z - centerZ;
        }

        getHeight(x, z) {
            const [wx, wz] = this._warp(x, z);
            const s = 0.008;
            let h = this._fbm(wx * s, wz * s, 6) * this.maxHeight;
            // Ridges for mountains
            const ridge = this._ridged(wx * s * 0.6 + 20, wz * s * 0.6 + 10, 5);
            h += ridge * this.maxHeight * 0.55;
            // Valley carving
            const valley = this._fbm(wx * s * 0.3, wz * s * 0.3, 3);
            h *= 0.7 + valley * 0.5;
            // Flatten near center a bit for playable area
            const dist = Math.sqrt(x * x + z * z);
            const flatten = Math.max(0, 1 - dist / (this.size * 0.35));
            h *= 1.0 - flatten * 0.25;

            // Carve the river channel: a smooth trench that always bottoms
            // out below the water plane, with gently sloped banks so it
            // reads as a real valley instead of a slot cut into the ground.
            const riverD = this._riverDistance(x, z);
            const riverWidth = 9 + this._fbm(x * 0.02, z * 0.02, 2, 700) * 6;
            const bank = Math.abs(riverD) / (riverWidth * 2.2);
            if (bank < 1) {
                const carve = (1 - bank * bank) ** 2;
                h = h * (1 - carve) + (-1.5) * carve;
            }

            return Math.max(h, -2);
        }

        getSlope(x, z, sample = 1.2) {
            const h0 = this.getHeight(x, z);
            const hx = this.getHeight(x + sample, z);
            const hz = this.getHeight(x, z + sample);
            return (Math.abs(hx - h0) + Math.abs(hz - h0)) / (sample * 2);
        }

        // Returns a coarse biome classification used to bias vegetation
        // scattering so forests, scree fields and meadows actually occupy
        // different, moisture/altitude-appropriate regions instead of trees
        // and rocks being sprinkled uniformly at random everywhere.
        getBiome(x, z) {
            const h = this.getHeight(x, z);
            const slope = this.getSlope(x, z);
            const moisture = this.getMoisture(x, z);
            const altitude01 = Math.max(0, Math.min(1, h / this.maxHeight));
            let name = 'meadow';
            if (h < 0.6) name = 'riverbank';
            else if (altitude01 > 0.72) name = 'alpine_rock';
            else if (slope > 0.55) name = 'scree';
            else if (moisture > 0.55) name = 'forest';
            else if (moisture < 0.3) name = 'dry_scrub';
            return { height: h, slope, moisture, altitude01, name };
        }

        // Average terrain height near the river channel — the water plane
        // sits just above this so it works for whatever seed generated the
        // session, instead of a hardcoded 1.1 that could sit awkwardly
        // above or below the actual carved terrain on a different seed.
        getWaterLevel() {
            if (this._waterLevel !== null) return this._waterLevel;
            let sum = 0, n = 0;
            for (let x = -this.size * 0.45; x <= this.size * 0.45; x += this.size * 0.05) {
                const centerZ = -this._riverDistance(x, 0);
                sum += this.getHeight(x, centerZ);
                n++;
            }
            this._waterLevel = (n ? sum / n : 0) + 0.9;
            return this._waterLevel;
        }

        generate() {
            const seg = this.segments;
            const size = this.size;
            const half = size / 2;
            const positions = new Float32Array((seg + 1) * (seg + 1) * 3);
            const normals = new Float32Array((seg + 1) * (seg + 1) * 3);
            const uvs = new Float32Array((seg + 1) * (seg + 1) * 2);
            const heights = new Float32Array((seg + 1) * (seg + 1));
            const indices = new Uint32Array(seg * seg * 6);

            let p = 0, u = 0, h = 0;
            for (let iz = 0; iz <= seg; iz++) {
                for (let ix = 0; ix <= seg; ix++) {
                    const x = (ix / seg) * size - half;
                    const z = (iz / seg) * size - half;
                    const y = this.getHeight(x, z);
                    positions[p++] = x;
                    positions[p++] = y;
                    positions[p++] = z;
                    heights[h++] = y;
                    uvs[u++] = ix / seg;
                    uvs[u++] = iz / seg;
                }
            }

            // Indices
            let i = 0;
            for (let iz = 0; iz < seg; iz++) {
                for (let ix = 0; ix < seg; ix++) {
                    const a = iz * (seg + 1) + ix;
                    const b = a + 1;
                    const c = a + (seg + 1);
                    const d = c + 1;
                    indices[i++] = a; indices[i++] = c; indices[i++] = b;
                    indices[i++] = b; indices[i++] = c; indices[i++] = d;
                }
            }

            // Smooth normals
            const tmpN = new Float32Array(positions.length);
            for (let t = 0; t < indices.length; t += 3) {
                const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
                const ax = positions[i1] - positions[i0], ay = positions[i1 + 1] - positions[i0 + 1], az = positions[i1 + 2] - positions[i0 + 2];
                const bx = positions[i2] - positions[i0], by = positions[i2 + 1] - positions[i0 + 1], bz = positions[i2 + 2] - positions[i0 + 2];
                let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                nx /= len; ny /= len; nz /= len;
                for (const ii of [i0, i1, i2]) {
                    tmpN[ii] += nx; tmpN[ii + 1] += ny; tmpN[ii + 2] += nz;
                }
            }
            for (let n = 0; n < tmpN.length; n += 3) {
                const l = Math.sqrt(tmpN[n] ** 2 + tmpN[n + 1] ** 2 + tmpN[n + 2] ** 2) || 1;
                normals[n] = tmpN[n] / l;
                normals[n + 1] = tmpN[n + 1] / l;
                normals[n + 2] = tmpN[n + 2] / l;
            }

            const geo = new Geometry();
            geo.setAttribute('position', positions, 3)
               .setAttribute('normal', normals, 3)
               .setAttribute('uv', uvs, 2)
               .setAttribute('height', heights, 1)
               .setIndex(indices);

            const mat = new Material({
                shader: 'terrain',
                albedo: new Color(0.4, 0.55, 0.25),
                roughness: 0.85
            });

            const mesh = new Mesh(geo, mat);
            mesh.name = 'Terrain';
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { generator: this };
            return mesh;
        }
    }

    // Simple vegetation (instanced-like trees via individual meshes for simplicity)
    class Vegetation {
        static createTree(Primitives, Material, Mesh, Color) {
            const group = new global.PriomGL.Object3D();
            // Trunk
            const trunkGeo = Primitives.cylinder(0.18, 0.28, 2.2, 7, 1);
            const trunkMat = new Material({ albedo: new Color(0.28, 0.18, 0.1), roughness: 0.9, metallic: 0 });
            const trunk = new Mesh(trunkGeo, trunkMat);
            trunk.position.y = 1.1;
            group.add(trunk);
            // Foliage layers
            const foliageMat = new Material({ albedo: new Color(0.12, 0.32, 0.1), roughness: 0.75 });
            for (let i = 0; i < 3; i++) {
                const r = 1.4 - i * 0.3;
                const h = 1.6 - i * 0.25;
                const cone = new Mesh(Primitives.cone(r, h, 8), foliageMat);
                cone.position.y = 2.4 + i * 0.9;
                group.add(cone);
            }
            return group;
        }

        static createRock(Primitives, Material, Mesh, Color) {
            const geo = Primitives.sphere(0.6 + Math.random() * 0.5, 7, 5);
            // Distort
            const pos = geo.attributes.position.data;
            for (let i = 0; i < pos.length; i += 3) {
                const n = Math.sin(pos[i] * 5 + pos[i + 2] * 3) * 0.15;
                pos[i] *= 1 + n;
                pos[i + 1] *= 0.7 + Math.random() * 0.3;
                pos[i + 2] *= 1 + n;
            }
            geo.computeNormals();
            const mat = new Material({
                albedo: new Color(0.35 + Math.random() * 0.1, 0.33, 0.3),
                roughness: 0.85 + Math.random() * 0.1,
                metallic: 0.05
            });
            return new Mesh(geo, mat);
        }

        // ---- Merged single-buffer geometries for GPU instancing ----
        // (used by InstancedEntities so a whole forest costs one draw call)
        // Deterministic pseudo-random helper so each tree *variant* gets a
        // fixed, reproducible asymmetry baked into its shared mesh (all
        // instances of that variant reuse the same buffer — that's what
        // keeps thousands of trees to a handful of draw calls), instead of
        // relying only on RNG noise from Math.random() at build time.
        static _seededRand(seed) {
            let s = seed * 374761393;
            return () => {
                s = (s * 1274126177 + 907633515) | 0;
                return ((s >>> 0) / 4294967296);
            };
        }

        // Perturbs a primitive's vertices radially with low-frequency noise
        // so a cone/sphere silhouette reads as foliage instead of a smooth
        // toy shape — same trick buildRockGeometryMerged already used, now
        // shared so trees get it too.
        static _perturbRadial(geo, rand, strength = 0.16, freq = 3.2) {
            const pos = geo.attributes.position.data;
            const nrm = geo.attributes.normal && geo.attributes.normal.data;
            const ox = rand() * 40, oz = rand() * 40;
            for (let i = 0; i < pos.length; i += 3) {
                const n = Math.sin((pos[i] + ox) * freq) * Math.cos((pos[i + 2] + oz) * freq * 1.3)
                    + Math.sin((pos[i + 1] + ox) * freq * 0.7) * 0.5;
                const k = 1 + n * strength;
                pos[i] *= k; pos[i + 2] *= k;
            }
            geo.computeNormals();
            return geo;
        }

        static _anchorGeometryToGround(geo) {
            const pos = geo?.attributes?.position?.data;
            if (!pos || !pos.length) return geo;
            let minY = Infinity;
            for (let i = 1; i < pos.length; i += 3) minY = Math.min(minY, pos[i]);
            if (!Number.isFinite(minY) || Math.abs(minY) < 1e-5) return geo;
            for (let i = 1; i < pos.length; i += 3) pos[i] -= minY;
            // Bounds are relative to the new origin.
            if (geo.__boundsHeight) geo.__boundsHeight -= minY;
            return geo;
        }

        static buildTreeGeometryMerged(Primitives, GeometryMerger, variant = 0) {
            const rand = this._seededRand(variant * 97 + 13);
            const barkTone = 0.9 + variant * 0.05;
            const trunkColor = [0.30 * barkTone, 0.19 * barkTone, 0.11 * barkTone];

            // Trunk: root flare at the base + a gentle two-segment lean
            // instead of one perfectly straight, perfectly vertical
            // cylinder. Real trunks are rarely dead-straight, and a hard
            // cylinder silhouette is one of the biggest "toy tree" cues.
            const lean = (rand() - 0.5) * 0.22;
            const parts = [
                { // root flare — short, wide cone-ish base
                    geometry: Primitives.cylinder(0.22, 0.42, 0.5, 7, 1),
                    position: [0, 0.25, 0], color: trunkColor.map(c => c * 0.85)
                },
                { // lower trunk
                    geometry: Primitives.cylinder(0.19, 0.23, 1.3, 7, 1),
                    position: [0, 1.15, 0], color: trunkColor
                },
                { // upper trunk, leaning slightly off-axis from the lower one
                    geometry: Primitives.cylinder(0.10, 0.18, 1.1, 6, 1),
                    position: [lean * 1.3, 2.3, lean * 0.7],
                    axis: [0, 0, 1], angle: lean * 0.5,
                    color: trunkColor.map(c => c * 1.05)
                }
            ];

            if (variant === 3) {
                // Deciduous/broadleaf silhouette: an irregular cluster of
                // overlapping noise-perturbed blobs instead of stacked
                // cones — reads as a round leafy canopy from any angle,
                // and no two lobes are the same size/position.
                const greenBase = [0.14, 0.34, 0.10];
                const canopyCenter = [lean * 2.0, 3.5, lean * 1.1];
                const lobeCount = 6;
                for (let i = 0; i < lobeCount; i++) {
                    const ang = (i / lobeCount) * Math.PI * 2 + rand() * 0.6;
                    const rad = 0.55 + rand() * 0.35;
                    const lobeR = 0.85 + rand() * 0.55;
                    const geo = this._perturbRadial(Primitives.sphere(lobeR, 7, 6), rand, 0.22, 2.6);
                    parts.push({
                        geometry: geo,
                        position: [
                            canopyCenter[0] + Math.cos(ang) * rad,
                            canopyCenter[1] + (rand() - 0.3) * 0.9,
                            canopyCenter[2] + Math.sin(ang) * rad
                        ],
                        color: greenBase.map(c => Math.min(1, c * (0.85 + rand() * 0.3)))
                    });
                }
                const geo = this._anchorGeometryToGround(GeometryMerger.mergeRigid(parts));
                geo.__boundsRadius = 2.0;
                geo.__boundsHeight = 5.2;
                return geo;
            }

            // Conifer silhouette: 4-5 asymmetric, noise-roughened layers
            // instead of 3 perfectly centered, perfectly smooth cones.
            // Each layer's center drifts a little from the one below (a
            // real conifer's crown is never perfectly coaxial with its
            // trunk) and the cone surface itself is radially perturbed so
            // the outline reads as foliage, not a traffic cone.
            const greenBase = variant === 1 ? [0.16, 0.30, 0.12] : variant === 2 ? [0.10, 0.34, 0.16] : [0.12, 0.32, 0.10];
            const layers = 5;
            let cx = lean * 1.6, cz = lean * 0.9;
            for (let i = 0; i < layers; i++) {
                const t = i / (layers - 1);
                const r = (1.55 - t * 0.95) * (0.9 + rand() * 0.2);
                const h = (1.5 - t * 0.55) * (0.9 + rand() * 0.25);
                cx += (rand() - 0.5) * 0.22;
                cz += (rand() - 0.5) * 0.22;
                const geo = this._perturbRadial(Primitives.cone(r, h, 8), rand, 0.14, 3.5);
                parts.push({
                    geometry: geo,
                    position: [cx, 2.35 + i * 0.82, cz],
                    color: greenBase.map(c => Math.min(1, c * (1 - i * 0.05) * (0.92 + rand() * 0.16)))
                });
            }
            const geo = this._anchorGeometryToGround(GeometryMerger.mergeRigid(parts));
            geo.__boundsRadius = 1.7;
            geo.__boundsHeight = 5.2;
            return geo;
        }

        static buildRockGeometryMerged(Primitives, GeometryMerger) {
            // Low segment count on purpose: combined with flat shading
            // below, fewer/bigger facets read as an actual chunk of stone.
            // The smooth, high-poly, smooth-shaded sphere this used to be
            // built from is exactly why rocks looked like rubber pebbles
            // instead of rock — smooth shading hides facets no matter how
            // much the surface is displaced underneath it.
            const base = Primitives.sphere(0.85, 7, 5);
            const pos = base.attributes.position.data;
            const rand = this._seededRand(7);
            const ox = rand() * 50, oz = rand() * 50, oy = rand() * 50;
            for (let i = 0; i < pos.length; i += 3) {
                const n = Math.sin((pos[i] + ox) * 4.2) * Math.cos((pos[i + 2] + oz) * 3.1)
                    + Math.sin((pos[i + 1] + oy) * 5.5) * 0.4;
                pos[i] *= 1 + n * 0.22;
                pos[i + 1] *= 0.58 + Math.abs(n) * 0.12;
                pos[i + 2] *= 1 + n * 0.22;
            }
            base.computeNormals();
            base.toFlatShaded();
            const geo = this._anchorGeometryToGround(GeometryMerger.merge([{ geometry: base, color: [0.42, 0.40, 0.37] }]));
            geo.__boundsRadius = 0.9;
            geo.__boundsHeight = 1.1;
            return geo;
        }

        // ---- Simple flower/bush clump for meadow dressing (also instanced) ----
        static buildBushGeometryMerged(Primitives, GeometryMerger) {
            const parts = [];
            const lobes = 3;
            for (let i = 0; i < lobes; i++) {
                // Spread the lobes around a ring instead of stacking three
                // identical spheres on the exact same origin (the previous
                // code computed `ang` but never used it, so a "bush" was
                // really just one wasted-overdraw sphere in disguise).
                const ang = (i / lobes) * Math.PI * 2 + 0.4;
                const r = 0.16;
                const lobeScale = 0.78 + (i % 2) * 0.14;
                parts.push({
                    geometry: Primitives.sphere(0.32 * lobeScale, 6, 5),
                    position: [Math.cos(ang) * r, 0.22 + (i % 2) * 0.08, Math.sin(ang) * r],
                    color: [0.13 + i * 0.015, 0.28 + i * 0.02, 0.10]
                });
            }
            // Small central lobe to fill the gap between the three outer ones.
            parts.push({ geometry: Primitives.sphere(0.24, 6, 5), position: [0, 0.3, 0], color: [0.15, 0.31, 0.12] });
            const geo = this._anchorGeometryToGround(GeometryMerger.mergeRigid(parts));
            geo.__boundsRadius = 0.5;
            geo.__boundsHeight = 0.6;
            return geo;
        }
    }

    global.PriomGL.TerrainGenerator = TerrainGenerator;
    global.PriomGL.Vegetation = Vegetation;

})(typeof window !== 'undefined' ? window : globalThis);
