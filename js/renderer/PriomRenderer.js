/**
 * PriomGL Renderer - Custom WebGL2 Engine Core
 * Zero Three.js. Pure WebGL2 with PBR, CSM, PostFX, procedural everything.
 * Designed for ultra-realistic outdoor scenes.
 */
(function(global) {
    'use strict';

    const { Vec3, Vec2, Quat, Mat4, Color, AABB } = global.PriomMath;
    const { GLUtils, TextureFactory } = global.PriomGL;
    const Shaders = global.PriomGL.Shaders;

    // ============== GEOMETRY ==============
    class Geometry {
        constructor() {
            this.attributes = {};
            this.indices = null;
            this.vao = null;
            this.indexCount = 0;
            this.vertexCount = 0;
            this.drawMode = null; // set later
        }
        setAttribute(name, data, size) {
            this.attributes[name] = { data: data instanceof Float32Array ? data : new Float32Array(data), size };
            return this;
        }
        setIndex(indices) {
            this.indices = indices instanceof Uint32Array ? indices : new Uint32Array(indices);
            this.indexCount = this.indices.length;
            return this;
        }
        computeNormals() {
            // Simple flat-ish normals if not provided
            if (!this.attributes.position || !this.indices) return this;
            const pos = this.attributes.position.data;
            const idx = this.indices;
            const normals = new Float32Array(pos.length);
            for (let i = 0; i < idx.length; i += 3) {
                const i0 = idx[i] * 3, i1 = idx[i + 1] * 3, i2 = idx[i + 2] * 3;
                const ax = pos[i1] - pos[i0], ay = pos[i1 + 1] - pos[i0 + 1], az = pos[i1 + 2] - pos[i0 + 2];
                const bx = pos[i2] - pos[i0], by = pos[i2 + 1] - pos[i0 + 1], bz = pos[i2 + 2] - pos[i0 + 2];
                let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                nx /= len; ny /= len; nz /= len;
                for (const ii of [i0, i1, i2]) {
                    normals[ii] += nx; normals[ii + 1] += ny; normals[ii + 2] += nz;
                }
            }
            for (let i = 0; i < normals.length; i += 3) {
                const l = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2) || 1;
                normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
            }
            this.setAttribute('normal', normals, 3);
            return this;
        }
        // Duplicates every vertex per-triangle so each face gets its own
        // unshared normal — real low-poly rocks read as faceted chunks of
        // stone with this; the shared/averaged normals from computeNormals()
        // instead make any noise-displaced sphere look like a smooth,
        // rubbery blob no matter how much the surface is perturbed.
        toFlatShaded() {
            if (!this.attributes.position || !this.indices) return this;
            const pos = this.attributes.position.data;
            const uv = this.attributes.uv && this.attributes.uv.data;
            const color = this.attributes.color && this.attributes.color.data;
            const idx = this.indices;
            const outPos = new Float32Array(idx.length * 3);
            const outNrm = new Float32Array(idx.length * 3);
            const outUv = new Float32Array(idx.length * 2);
            const outColor = color ? new Float32Array(idx.length * 3) : null;
            for (let t = 0; t < idx.length; t += 3) {
                const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
                const ax = pos[i1] - pos[i0], ay = pos[i1 + 1] - pos[i0 + 1], az = pos[i1 + 2] - pos[i0 + 2];
                const bx = pos[i2] - pos[i0], by = pos[i2 + 1] - pos[i0 + 1], bz = pos[i2 + 2] - pos[i0 + 2];
                let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                nx /= len; ny /= len; nz /= len;
                for (let k = 0; k < 3; k++) {
                    const srcI = idx[t + k] * 3, dstI = (t + k) * 3;
                    outPos[dstI] = pos[srcI]; outPos[dstI + 1] = pos[srcI + 1]; outPos[dstI + 2] = pos[srcI + 2];
                    outNrm[dstI] = nx; outNrm[dstI + 1] = ny; outNrm[dstI + 2] = nz;
                    if (uv) { const srcUv = idx[t + k] * 2, dstUv = (t + k) * 2; outUv[dstUv] = uv[srcUv]; outUv[dstUv + 1] = uv[srcUv + 1]; }
                    if (color) { outColor[dstI] = color[srcI]; outColor[dstI + 1] = color[srcI + 1]; outColor[dstI + 2] = color[srcI + 2]; }
                }
            }
            const newIdx = new Uint32Array(idx.length);
            for (let i = 0; i < idx.length; i++) newIdx[i] = i;
            this.setAttribute('position', outPos, 3);
            this.setAttribute('normal', outNrm, 3);
            this.setAttribute('uv', outUv, 2);
            if (outColor) this.setAttribute('color', outColor, 3);
            this.setIndex(newIdx);
            return this;
        }
        build(gl) {
            this.vao = GLUtils.createVAO(gl);
            gl.bindVertexArray(this.vao);
            const locs = { position: 0, normal: 1, uv: 2, tangent: 3, color: 4, height: 5 };
            for (const [name, attr] of Object.entries(this.attributes)) {
                const loc = locs[name];
                if (loc === undefined) continue;
                const buf = GLUtils.createBuffer(gl, attr.data);
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, attr.size, gl.FLOAT, false, 0, 0);
                attr.buffer = buf;
            }
            // CRÍTICO: si la geometría no trae 'color' por vértice, la
            // ubicación 4 queda deshabilitada y WebGL usa su valor "current"
            // por defecto, que es (0,0,0,1) — el shader PBR multiplica
            // albedo *= vColor, así que sin este fallback CUALQUIER malla
            // sin color explícito (rocas, hitos, la mayoría de la escena)
            // se vería completamente negra pese a tener albedo/luz correctos.
            if (!this.attributes.color) {
                gl.disableVertexAttribArray(4);
                gl.vertexAttrib4f(4, 1, 1, 1, 1);
            }
            if (!this.attributes.tangent) {
                gl.disableVertexAttribArray(3);
                gl.vertexAttrib4f(3, 1, 0, 0, 1);
            }
            if (this.indices) {
                this.indexBuffer = GLUtils.createIndexBuffer(gl, this.indices);
            }
            this.vertexCount = this.attributes.position ? this.attributes.position.data.length / 3 : 0;
            gl.bindVertexArray(null);
            this.drawMode = gl.TRIANGLES;
            return this;
        }
    }

    // Merge several {geometry, offsetY, colorRGB} parts into a single Geometry,
    // needed for GPU instancing (one draw call per type instead of N meshes).
    class GeometryMerger {
        static merge(parts) {
            const positions = [], normals = [], uvs = [], colors = [];
            const indices = [];
            let vBase = 0;
            for (const part of parts) {
                const g = part.geometry;
                const pos = g.attributes.position.data;
                const nrm = (g.attributes.normal && g.attributes.normal.data) || null;
                const uv = (g.attributes.uv && g.attributes.uv.data) || null;
                const oy = part.offsetY || 0;
                const sx = part.scale ? part.scale[0] : 1;
                const sy = part.scale ? part.scale[1] : 1;
                const sz = part.scale ? part.scale[2] : 1;
                const [cr, cg, cb] = part.color || [1, 1, 1];
                const vCount = pos.length / 3;
                for (let i = 0; i < vCount; i++) {
                    positions.push(pos[i*3] * sx, pos[i*3+1] * sy + oy, pos[i*3+2] * sz);
                    if (nrm) normals.push(nrm[i*3], nrm[i*3+1], nrm[i*3+2]);
                    else normals.push(0, 1, 0);
                    if (uv) uvs.push(uv[i*2], uv[i*2+1]);
                    else uvs.push(0, 0);
                    colors.push(cr, cg, cb);
                }
                if (g.indices) {
                    for (let i = 0; i < g.indices.length; i++) indices.push(g.indices[i] + vBase);
                } else {
                    for (let i = 0; i < vCount; i++) indices.push(i + vBase);
                }
                vBase += vCount;
            }
            const geo = new Geometry();
            geo.setAttribute('position', positions, 3)
               .setAttribute('normal', normals, 3)
               .setAttribute('uv', uvs, 2)
               .setAttribute('color', colors, 3)
               .setIndex(indices);
            return geo;
        }

        /**
         * Like merge(), but each part carries a *full* rigid transform
         * (position + axis-angle rotation + non-uniform scale) baked into
         * the vertices/normals, not just a Y offset. This is what turns a
         * whole animal's static anatomy (torso, neck, head, muzzle, ears,
         * antlers...) — previously one WebGL draw call *per part* — into
         * a single draw call with everything already in the right place,
         * without needing a real skeleton/bone system.
         *
         * part: { geometry, position:[x,y,z], axis:[x,y,z], angle, scale:[x,y,z], color:[r,g,b] }
         * Rotation uses the exact same axis-angle → quaternion → matrix
         * convention as Quat.setFromAxisAngle in core/math.js, so a part
         * merged this way looks identical to the same geometry attached
         * as a child Object3D with that rotation.
         */
        static mergeRigid(parts) {
            const positions = [], normals = [], uvs = [], colors = [];
            const indices = [];
            let vBase = 0;
            for (const part of parts) {
                const g = part.geometry;
                const pos = g.attributes.position.data;
                const nrm = (g.attributes.normal && g.attributes.normal.data) || null;
                const uv = (g.attributes.uv && g.attributes.uv.data) || null;
                const [px, py, pz] = part.position || [0, 0, 0];
                const [sx, sy, sz] = part.scale || [1, 1, 1];
                const [cr, cg, cb] = part.color || [1, 1, 1];
                // For lighting to look right after a non-uniform scale (used
                // constantly here: every animal torso/rump/head, every
                // tree's leaf-blobs, are stretched spheres), normals must be
                // transformed by the INVERSE of the scale, not the scale
                // itself — and the code below used to apply no scale to the
                // normal at all (only the rotation), which is only correct
                // for scale===[1,1,1]. On a body part squashed/stretched
                // like `bodyLen/bodyHeight` (often 2×+ on one axis) that
                // desyncs the normal from the true surface enough that, at
                // grazing/from-behind angles, N·V goes negative for large
                // patches of the surface — i.e. the lighting model treats
                // perfectly visible front-facing geometry as facing away,
                // so it comes out essentially unlit/black against a bright
                // sky and reads as "missing" even though the triangles are
                // there. Inverse-scale + renormalize is the standard fix.
                const isx = sx !== 0 ? 1 / sx : 1, isy = sy !== 0 ? 1 / sy : 1, isz = sz !== 0 ? 1 / sz : 1;

                // axis-angle -> quaternion -> 3x3 rotation matrix (same
                // formula as instancedVS's quatToMat3 in shaders.js).
                let m00 = 1, m01 = 0, m02 = 0, m10 = 0, m11 = 1, m12 = 0, m20 = 0, m21 = 0, m22 = 1;
                if (part.axis && part.angle) {
                    const [ax, ay, az] = part.axis;
                    const alen = Math.hypot(ax, ay, az) || 1;
                    const half = part.angle * 0.5, s = Math.sin(half);
                    const x = (ax / alen) * s, y = (ay / alen) * s, z = (az / alen) * s, w = Math.cos(half);
                    const x2 = x + x, y2 = y + y, z2 = z + z;
                    const xx = x * x2, xy = x * y2, xz = x * z2;
                    const yy = y * y2, yz = y * z2, zz = z * z2;
                    const wx = w * x2, wy = w * y2, wz = w * z2;
                    m00 = 1 - (yy + zz); m01 = xy - wz;       m02 = xz + wy;
                    m10 = xy + wz;       m11 = 1 - (xx + zz); m12 = yz - wx;
                    m20 = xz - wy;       m21 = yz + wx;       m22 = 1 - (xx + yy);
                }

                const vCount = pos.length / 3;
                for (let i = 0; i < vCount; i++) {
                    const vx = pos[i * 3] * sx, vy = pos[i * 3 + 1] * sy, vz = pos[i * 3 + 2] * sz;
                    positions.push(
                        m00 * vx + m01 * vy + m02 * vz + px,
                        m10 * vx + m11 * vy + m12 * vz + py,
                        m20 * vx + m21 * vy + m22 * vz + pz
                    );
                    if (nrm) {
                        const nx = nrm[i * 3] * isx, ny = nrm[i * 3 + 1] * isy, nz = nrm[i * 3 + 2] * isz;
                        let rnx = m00 * nx + m01 * ny + m02 * nz;
                        let rny = m10 * nx + m11 * ny + m12 * nz;
                        let rnz = m20 * nx + m21 * ny + m22 * nz;
                        const nlen = Math.hypot(rnx, rny, rnz) || 1;
                        normals.push(rnx / nlen, rny / nlen, rnz / nlen);
                    } else normals.push(0, 1, 0);
                    if (uv) uvs.push(uv[i * 2], uv[i * 2 + 1]);
                    else uvs.push(0, 0);
                    colors.push(cr, cg, cb);
                }
                if (g.indices) {
                    for (let i = 0; i < g.indices.length; i++) indices.push(g.indices[i] + vBase);
                } else {
                    for (let i = 0; i < vCount; i++) indices.push(i + vBase);
                }
                vBase += vCount;
            }
            const geo = new Geometry();
            geo.setAttribute('position', positions, 3)
               .setAttribute('normal', normals, 3)
               .setAttribute('uv', uvs, 2)
               .setAttribute('color', colors, 3)
               .setIndex(indices);
            return geo;
        }
    }

    // Primitive generators
    class Primitives {
        static plane(w = 1, h = 1, segX = 1, segY = 1) {
            const geo = new Geometry();
            const positions = [], normals = [], uvs = [], indices = [];
            for (let y = 0; y <= segY; y++) {
                for (let x = 0; x <= segX; x++) {
                    const u = x / segX, v = y / segY;
                    positions.push((u - 0.5) * w, 0, (v - 0.5) * h);
                    normals.push(0, 1, 0);
                    uvs.push(u, v);
                }
            }
            for (let y = 0; y < segY; y++) {
                for (let x = 0; x < segX; x++) {
                    const a = y * (segX + 1) + x;
                    const b = a + 1, c = a + (segX + 1), d = c + 1;
                    indices.push(a, c, b, b, c, d);
                }
            }
            geo.setAttribute('position', positions, 3).setAttribute('normal', normals, 3)
               .setAttribute('uv', uvs, 2).setIndex(indices);
            return geo;
        }

        static box(w = 1, h = 1, d = 1) {
            const geo = new Geometry();
            const hw = w / 2, hh = h / 2, hd = d / 2;
            const positions = [
                // front
                -hw,-hh, hd,  hw,-hh, hd,  hw, hh, hd, -hw, hh, hd,
                // back
                 hw,-hh,-hd, -hw,-hh,-hd, -hw, hh,-hd,  hw, hh,-hd,
                // top
                -hw, hh, hd,  hw, hh, hd,  hw, hh,-hd, -hw, hh,-hd,
                // bottom
                -hw,-hh,-hd,  hw,-hh,-hd,  hw,-hh, hd, -hw,-hh, hd,
                // right
                 hw,-hh, hd,  hw,-hh,-hd,  hw, hh,-hd,  hw, hh, hd,
                // left
                -hw,-hh,-hd, -hw,-hh, hd, -hw, hh, hd, -hw, hh,-hd
            ];
            const normals = [
                0,0,1, 0,0,1, 0,0,1, 0,0,1,
                0,0,-1,0,0,-1,0,0,-1,0,0,-1,
                0,1,0, 0,1,0, 0,1,0, 0,1,0,
                0,-1,0,0,-1,0,0,-1,0,0,-1,0,
                1,0,0, 1,0,0, 1,0,0, 1,0,0,
                -1,0,0,-1,0,0,-1,0,0,-1,0,0
            ];
            const uvs = [];
            for (let i = 0; i < 6; i++) uvs.push(0,0, 1,0, 1,1, 0,1);
            const indices = [];
            for (let i = 0; i < 6; i++) {
                const o = i * 4;
                indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
            }
            geo.setAttribute('position', positions, 3).setAttribute('normal', normals, 3)
               .setAttribute('uv', uvs, 2).setIndex(indices);
            return geo;
        }

        static sphere(radius = 1, segW = 32, segH = 16) {
            const geo = new Geometry();
            const positions = [], normals = [], uvs = [], indices = [];
            for (let y = 0; y <= segH; y++) {
                const v = y / segH;
                const phi = v * Math.PI;
                for (let x = 0; x <= segW; x++) {
                    const u = x / segW;
                    const theta = u * Math.PI * 2;
                    const nx = Math.sin(phi) * Math.cos(theta);
                    const ny = Math.cos(phi);
                    const nz = Math.sin(phi) * Math.sin(theta);
                    positions.push(nx * radius, ny * radius, nz * radius);
                    normals.push(nx, ny, nz);
                    uvs.push(u, v);
                }
            }
            for (let y = 0; y < segH; y++) {
                for (let x = 0; x < segW; x++) {
                    const a = y * (segW + 1) + x;
                    const b = a + segW + 1;
                    indices.push(a, b, a + 1, b, b + 1, a + 1);
                }
            }
            geo.setAttribute('position', positions, 3).setAttribute('normal', normals, 3)
               .setAttribute('uv', uvs, 2).setIndex(indices);
            return geo;
        }

        static cylinder(radiusTop = 0.5, radiusBottom = 0.5, height = 1, radial = 16, heightSeg = 1, caps = true) {
            const geo = new Geometry();
            const positions = [], normals = [], uvs = [], indices = [];
            for (let y = 0; y <= heightSeg; y++) {
                const v = y / heightSeg;
                const r = radiusBottom + (radiusTop - radiusBottom) * v;
                const py = (v - 0.5) * height;
                for (let x = 0; x <= radial; x++) {
                    const u = x / radial;
                    const theta = u * Math.PI * 2;
                    const nx = Math.cos(theta), nz = Math.sin(theta);
                    positions.push(nx * r, py, nz * r);
                    normals.push(nx, 0, nz);
                    uvs.push(u, v);
                }
            }
            for (let y = 0; y < heightSeg; y++) {
                for (let x = 0; x < radial; x++) {
                    const a = y * (radial + 1) + x;
                    const b = a + radial + 1;
                    indices.push(a, b, a + 1, b, b + 1, a + 1);
                }
            }

            // Watertight end caps: without these, cones/trunks are hollow
            // shells and any grazing/low-angle or below view exposes the
            // open interior — closing them makes silhouettes read solid
            // from every viewing direction, which matters a lot for trees.
            if (caps) {
                const addCap = (radius, py, isTop) => {
                    if (radius <= 0.0005) return; // apex point, nothing to cap
                    const center = positions.length / 3;
                    positions.push(0, py, 0);
                    normals.push(0, isTop ? 1 : -1, 0);
                    uvs.push(0.5, 0.5);
                    const ringStart = positions.length / 3;
                    for (let x = 0; x <= radial; x++) {
                        const u = x / radial;
                        const theta = u * Math.PI * 2;
                        const nx = Math.cos(theta), nz = Math.sin(theta);
                        positions.push(nx * radius, py, nz * radius);
                        normals.push(0, isTop ? 1 : -1, 0);
                        uvs.push(0.5 + nx * 0.5, 0.5 + nz * 0.5);
                    }
                    for (let x = 0; x < radial; x++) {
                        const a = ringStart + x, b = ringStart + x + 1;
                        if (isTop) indices.push(center, a, b);
                        else indices.push(center, b, a);
                    }
                };
                addCap(radiusBottom, -height / 2, false);
                addCap(radiusTop, height / 2, true);
            }

            geo.setAttribute('position', positions, 3).setAttribute('normal', normals, 3)
               .setAttribute('uv', uvs, 2).setIndex(indices);
            return geo;
        }

        static cone(radius = 0.5, height = 1, radial = 12) {
            return this.cylinder(0.001, radius, height, radial, 1);
        }
    }

    // ============== MATERIAL ==============
    class Material {
        constructor(options = {}) {
            this.albedo = options.albedo || new Color(0.8, 0.8, 0.8);
            this.metallic = options.metallic ?? 0.0;
            this.roughness = options.roughness ?? 0.5;
            this.ao = options.ao ?? 1.0;
            this.albedoMap = options.albedoMap || null;
            this.normalMap = options.normalMap || null;
            this.roughnessMap = options.roughnessMap || null;
            this.metallicMap = options.metallicMap || null;
            this.aoMap = options.aoMap || null;
            this.transparent = options.transparent || false;
            this.opacity = options.opacity ?? 1.0;
            this.side = options.side || 'front'; // front, back, double
            this.shader = options.shader || 'pbr';
            // 0 generic, 1 fur/skin, 2 vegetation/bark, 3 stone.
            // Enables lightweight procedural micro-variation without external textures.
            this.natureType = options.natureType ?? 0;
            this.textureFamily = options.textureFamily || null;
        }
    }

    // ============== MESH / OBJECT3D ==============
    class Object3D {
        constructor() {
            this.position = new Vec3();
            this.rotation = new Quat();
            this.scale = new Vec3(1, 1, 1);
            this.matrix = new Mat4();
            this.matrixWorld = new Mat4();
            this.parent = null;
            this.children = [];
            this.visible = true;
            this.name = '';
            this.matrixNeedsUpdate = true;
        }
        add(child) {
            if (child.parent) child.parent.remove(child);
            child.parent = this;
            this.children.push(child);
            return this;
        }
        remove(child) {
            const i = this.children.indexOf(child);
            if (i >= 0) { this.children.splice(i, 1); child.parent = null; }
            return this;
        }
        updateMatrix() {
            this.matrix.compose(this.position, this.rotation, this.scale);
            this.matrixNeedsUpdate = false;
        }
        updateMatrixWorld(force = false) {
            if (this.matrixNeedsUpdate || force) this.updateMatrix();
            if (this.parent) {
                this.matrixWorld.copy(this.parent.matrixWorld).multiply(this.matrix);
            } else {
                this.matrixWorld.copy(this.matrix);
            }
            for (const c of this.children) c.updateMatrixWorld(force);
        }
        traverse(fn) {
            fn(this);
            for (const c of this.children) c.traverse(fn);
        }
    }

    class Mesh extends Object3D {
        constructor(geometry, material) {
            super();
            this.geometry = geometry;
            this.material = material;
            this.castShadow = true;
            this.receiveShadow = true;
            this.frustumCulled = true;
        }
    }

    // ============== INSTANCED MESH (GPU instancing for vegetation, rocks, debris) ==============
    // Instance transforms are packed as 3xVec4 rows of an affine 3x4 matrix
    // (rotation+scale in .xyz, translation in .w) plus a vec4 color/phase, to
    // keep this cheap: 10 floats/instance instead of a full 4x4 (16 floats).
    class InstancedMesh extends Object3D {
        constructor(geometry, material, maxInstances) {
            super();
            this.geometry = geometry;
            this.material = material;
            this.castShadow = true;
            this.receiveShadow = true;
            this.isInstanced = true;
            this.maxInstances = maxInstances;
            this.count = 0;
            // 3 rows * 4 floats + 4 floats color/phase = 16 floats/instance
            this.instanceData = new Float32Array(maxInstances * 16);
            this._buffer = null;
            this._needsUpload = true;
        }
        // Sets instance i's transform from position/quaternion(yaw only fast-path)/uniform-ish scale + tint + phase
        setInstance(i, x, y, z, rotY, sx, sy, sz, r = 1, g = 1, b = 1, phase = 0) {
            const o = i * 16;
            const c = Math.cos(rotY), s = Math.sin(rotY);
            // Rotation about Y combined with non-uniform scale, packed as row-major 3x3 * scale
            this.instanceData[o + 0] = c * sx;  this.instanceData[o + 1] = 0; this.instanceData[o + 2] = s * sz; this.instanceData[o + 3] = x;
            this.instanceData[o + 4] = 0;       this.instanceData[o + 5] = sy; this.instanceData[o + 6] = 0;      this.instanceData[o + 7] = y;
            this.instanceData[o + 8] = -s * sx; this.instanceData[o + 9] = 0; this.instanceData[o + 10] = c * sz; this.instanceData[o + 11] = z;
            this.instanceData[o + 12] = r; this.instanceData[o + 13] = g; this.instanceData[o + 14] = b; this.instanceData[o + 15] = phase;
        }
        build(gl) {
            if (!this.geometry.vao) this.geometry.build(gl);
            this._buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
            this._vao = gl.createVertexArray();
            gl.bindVertexArray(this._vao);
            // Re-bind the base geometry attributes into this VAO too
            for (const [name, attr] of Object.entries(this.geometry.attributes)) {
                const locs = { position: 0, normal: 1, uv: 2, tangent: 3, color: 4 };
                const loc = locs[name];
                if (loc === undefined) continue;
                gl.bindBuffer(gl.ARRAY_BUFFER, attr.buffer);
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, attr.size, gl.FLOAT, false, 0, 0);
            }
            if (!this.geometry.attributes.color) {
                gl.disableVertexAttribArray(4);
                gl.vertexAttrib4f(4, 1, 1, 1, 1);
            }
            if (!this.geometry.attributes.tangent) {
                gl.disableVertexAttribArray(3);
                gl.vertexAttrib4f(3, 1, 0, 0, 1);
            }
            if (this.geometry.indexBuffer) {
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.geometry.indexBuffer);
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
            const stride = 16 * 4;
            for (let r = 0; r < 3; r++) {
                gl.enableVertexAttribArray(6 + r);
                gl.vertexAttribPointer(6 + r, 4, gl.FLOAT, false, stride, r * 16);
                gl.vertexAttribDivisor(6 + r, 1);
            }
            gl.enableVertexAttribArray(9);
            gl.vertexAttribPointer(9, 4, gl.FLOAT, false, stride, 12 * 4);
            gl.vertexAttribDivisor(9, 1);
            gl.bindVertexArray(null);
            this._needsUpload = false;
        }
        upload(gl) {
            if (!this._vao) { this.build(gl); }
            gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, this.count * 16));
            this._needsUpload = false;
        }
    }

    // ============== CAMERA ==============
    class PerspectiveCamera extends Object3D {
        constructor(fov = 60, aspect = 1, near = 0.1, far = 2000) {
            super();
            this.fov = fov;
            this.aspect = aspect;
            this.near = near;
            this.far = far;
            this.projectionMatrix = new Mat4();
            this.viewMatrix = new Mat4();
            this.up = new Vec3(0, 1, 0);
            this.target = new Vec3();
            this.updateProjection();
        }
        // Extracts world-space forward direction (local -Z) directly from
        // matrixWorld, valid in both FPS mode (quaternion-driven) and
        // cinematic autopilot (lookAt-driven) since both keep matrixWorld
        // in sync. Used by vegetation frustum culling.
        getForward(out) {
            const e = this.matrixWorld.e;
            const v = out || new Vec3();
            v.set(-e[8], -e[9], -e[10]);
            return v.normalize();
        }
        updateProjection() {
            this.projectionMatrix.makePerspective(this.fov, this.aspect, this.near, this.far);
        }
        lookAt(target) {
            this.target.copy(target);
            this.matrixWorld.lookAt(this.position, target, this.up);
            // Sync the quaternion too: render() calls updateView() every
            // frame, which recomposes matrixWorld from position/rotation/
            // scale. Without this, that recompute clobbered the orientation
            // set here with whatever `rotation` was previously (identity by
            // default) the moment a single frame passed — the cinematic fly
            // camera would silently always face world -Z instead of the
            // intended target.
            this.rotation.setFromRotationMat4(this.matrixWorld);
            this.viewMatrix.copy(this.matrixWorld).invert();
        }
        updateView() {
            this.updateMatrixWorld(true);
            this.viewMatrix.copy(this.matrixWorld).invert();
        }
    }

    // ============== LIGHTS ==============
    class DirectionalLight {
        constructor(color = new Color(1, 0.98, 0.92), intensity = 3.5) {
            this.color = color;
            this.intensity = intensity;
            this.direction = new Vec3(-0.4, -0.85, -0.3).normalize();
            this.castShadow = true;
            this.shadowMapSize = 2048;
            this.cascades = 4;
            this.cascadeSplits = [30, 80, 200, 600];
        }
    }

    // ============== SCENE ==============
    class Scene extends Object3D {
        constructor() {
            super();
            this.background = new Color(0.4, 0.6, 0.9);
            this.fogColor = new Color(0.55, 0.7, 0.85);
            this.fogDensity = 0.0018;
            this.ambientColor = new Color(0.25, 0.28, 0.35);
            this.sun = new DirectionalLight();
            this.pointLights = []; // { position: Vec3, color: Color, intensity, radius }
        }
    }

    // ============== MAIN RENDERER ==============
    class PriomRenderer {
        constructor(canvas, options = {}) {
            this.canvas = canvas;
            const ctxOpts = {
                alpha: false,
                depth: true,
                stencil: true,
                antialias: false, // we do our own
                powerPreference: 'high-performance',
                premultipliedAlpha: false
            };
            this.gl = canvas.getContext('webgl2', ctxOpts);
            if (!this.gl) throw new Error('WebGL2 not supported');
            const gl = this.gl;
            this.extensions = GLUtils.checkExtensions(gl);
            this.width = 0;
            this.height = 0;
            this.pixelRatio = Math.min(window.devicePixelRatio || 1, options.maxPixelRatio || 2);
            this.exposure = options.exposure || 1.35;
            this.time = 0;
            this.frame = 0;

            // Stats
            this.stats = { drawCalls: 0, triangles: 0, programs: 0 };

            this._initPrograms();
            this._initShadowMaps();
            this._initPost();
            this._initDefaultTextures();

            gl.enable(gl.DEPTH_TEST);
            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);
            gl.frontFace(gl.CCW);
            gl.depthFunc(gl.LEQUAL);

            this.resize();
            window.addEventListener('resize', () => this.resize());
        }

        _initPrograms() {
            const gl = this.gl;
            this.programs = {};
            const create = (name, vs, fs) => {
                const p = GLUtils.createProgram(gl, vs, fs);
                this.programs[name] = {
                    program: p,
                    uniforms: GLUtils.getUniforms(gl, p),
                    attrs: GLUtils.getAttributes(gl, p)
                };
            };
            create('pbr', Shaders.pbrVS, Shaders.pbrFS);
            create('instanced', Shaders.instancedVS, Shaders.pbrFS);
            create('shadow', Shaders.shadowVS, Shaders.shadowFS);
            create('shadowInstanced', Shaders.shadowInstancedVS, Shaders.shadowFS);
            create('sky', Shaders.skyVS, Shaders.skyFS);
            create('water', Shaders.waterVS, Shaders.waterFS);
            create('terrain', Shaders.terrainVS, Shaders.terrainFS);
            create('bloomExtract', Shaders.postVS, Shaders.bloomExtractFS);
            create('blur', Shaders.postVS, Shaders.blurFS);
            create('godRays', Shaders.postVS, Shaders.godRaysFS);
            create('ssao', Shaders.postVS, Shaders.ssaoFS);
            create('composite', Shaders.postVS, Shaders.compositeFS);
        }

        _initShadowMaps() {
            const gl = this.gl;
            // 1536 instead of 2048: ~44% less shadow fill-rate cost across the
            // 4 cascades with a barely perceptible sharpness difference — this
            // was one of the two biggest FPS sinks on mobile GPUs.
            const size = 1536;
            this.shadowMaps = [];
            this.shadowFBOs = [];
            this.lightVP = [new Mat4(), new Mat4(), new Mat4(), new Mat4()];
            // Pre-flattened scratch buffers reused every frame (zero per-frame
            // allocation, zero getUniformLocation calls — see _bindPBRCommon).
            this._lightVPFlat = new Float32Array(64);
            this._shadowTexUnits = new Int32Array([5, 6, 7, 8]);
            this._cascadeSplitsFlat = new Float32Array(4);
            this._plPosFlat = new Float32Array(8 * 3);
            this._plColorFlat = new Float32Array(8 * 3);
            this._plIntensityFlat = new Float32Array(8);
            this._plRadiusFlat = new Float32Array(8);
            for (let i = 0; i < 4; i++) {
                const depthTex = GLUtils.createDepthTexture(gl, size, size);
                const fbo = gl.createFramebuffer();
                gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
                gl.drawBuffers([gl.NONE]);
                gl.readBuffer(gl.NONE);
                this.shadowMaps.push(depthTex);
                this.shadowFBOs.push(fbo);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            this.shadowSize = size;
        }

        _initPost() {
            const gl = this.gl;
            this.quadVAO = GLUtils.fullScreenQuadVAO(gl);
            // Scene HDR target
            this.sceneTex = null;
            this.sceneFBO = null;
            this.sceneDepthTex = null;
            this.bloomTex = [null, null];
            this.bloomFBO = [null, null];
            this.ssaoEnabled = true;
            // Bloom and god rays used to have no toggle at all in this
            // pipeline (unlike SSAO): they ran their full extract+blur (or
            // sun-projection+blur) passes on every single frame regardless
            // of device tier. That's fine on desktop but is real, avoidable
            // GPU cost on a phone — exactly the kind of thing that should be
            // the first thing to go before shadow cascades/resolution, not
            // something that's simply impossible to turn off. See _postProcess()
            // for where these are actually skipped now, and
            // MetaOptimizerAI/PriomEngine's mobile-rescue fallback for where
            // they get switched off automatically.
            this.bloomEnabled = true;
            this.godRaysEnabled = true;
            this._resizePost(1, 1);
        }

        _resizePost(w, h) {
            const gl = this.gl;
            const createRT = (ww, hh, filter = gl.LINEAR) => {
                const tex = GLUtils.createTexture(gl, {
                    width: ww, height: hh,
                    internalFormat: gl.RGBA16F,
                    format: gl.RGBA,
                    type: gl.HALF_FLOAT,
                    minFilter: filter,
                    magFilter: filter,
                    wrapS: gl.CLAMP_TO_EDGE,
                    wrapT: gl.CLAMP_TO_EDGE,
                    generateMipmaps: false
                });
                const fbo = GLUtils.createFramebuffer(gl, tex, null, ww, hh);
                return { tex, fbo };
            };
            // Cleanup old GPU resources before replacing (avoids leaking a
            // texture+FBO pair every time the canvas resizes, e.g. mobile
            // orientation change or the OptimizerAI adjusting pixel ratio).
            const destroyRT = (tex, fbo) => {
                if (tex) gl.deleteTexture(tex);
                if (fbo) gl.deleteFramebuffer(fbo);
            };
            destroyRT(this.sceneTex, this.sceneFBO);
            if (this.sceneDepthTex) gl.deleteTexture(this.sceneDepthTex);
            if (this.bloomTex) for (let i = 0; i < this.bloomTex.length; i++) destroyRT(this.bloomTex[i], this.bloomFBO[i]);
            destroyRT(this.godRaysTex, this.godRaysFBO);
            destroyRT(this.ssaoTex, this.ssaoFBO);

            // The scene target gets a REAL depth texture (not just a
            // renderbuffer) so SSAO can read it back and reconstruct
            // view-space position/normals — a renderbuffer's depth can only
            // be used by the GPU's own depth test, never sampled in a shader.
            this.sceneTex = GLUtils.createTexture(gl, {
                width: w, height: h, internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT,
                minFilter: gl.LINEAR, magFilter: gl.LINEAR, wrapS: gl.CLAMP_TO_EDGE, wrapT: gl.CLAMP_TO_EDGE, generateMipmaps: false
            });
            this.sceneDepthTex = GLUtils.createDepthTexture(gl, w, h);
            this.sceneFBO = GLUtils.createFramebuffer(gl, this.sceneTex, this.sceneDepthTex, w, h);

            const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
            this.bloomTex = []; this.bloomFBO = [];
            for (let i = 0; i < 2; i++) {
                const b = createRT(bw, bh);
                this.bloomTex[i] = b.tex;
                this.bloomFBO[i] = b.fbo;
            }
            const gw = Math.max(1, w >> 2), gh = Math.max(1, h >> 2);
            const gr = createRT(gw, gh);
            this.godRaysTex = gr.tex;
            this.godRaysFBO = gr.fbo;
            // SSAO at quarter-res too — it's a low-frequency effect, doesn't
            // need full resolution, and this keeps it cheap on mobile.
            const sr = createRT(gw, gh, gl.LINEAR);
            this.ssaoTex = sr.tex;
            this.ssaoFBO = sr.fbo;
            this.postW = w; this.postH = h;
        }

        _initDefaultTextures() {
            const gl = this.gl;
            this.textures = {
                white: GLUtils.createTexture(gl, { width: 1, height: 1, data: new Uint8Array([255,255,255,255]), generateMipmaps: false }),
                normal: GLUtils.createTexture(gl, { width: 1, height: 1, data: new Uint8Array([128,128,255,255]), generateMipmaps: false }),
                grass: TextureFactory.grass(gl, 512),
                rock: TextureFactory.rock(gl, 512),
                snow: (() => {
                    const d = new Uint8Array(256 * 256 * 4);
                    for (let i = 0; i < d.length; i += 4) { d[i]=240; d[i+1]=245; d[i+2]=250; d[i+3]=255; }
                    return GLUtils.createTexture(gl, { width: 256, height: 256, data: d });
                })(),
                noiseNormal: TextureFactory.normalFromHeight(gl, null, 256),
                roughness: TextureFactory.roughnessMap(gl, 256, 0.55)
            };
            // Sky dome geo
            this.skyGeo = Primitives.sphere(1, 32, 16).build(gl);
            // Water plane
            this.waterGeo = Primitives.plane(400, 400, 128, 128).build(gl);
        }

        resize() {
            const w = this.canvas.clientWidth;
            const h = this.canvas.clientHeight;
            if (w === 0 || h === 0) return;
            this.width = Math.floor(w * this.pixelRatio);
            this.height = Math.floor(h * this.pixelRatio);
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            this.gl.viewport(0, 0, this.width, this.height);
            this._resizePost(this.width, this.height);
        }

        _updateCascades(camera, sun) {
            // Simplified cascaded shadow matrices
            const splits = sun.cascadeSplits;
            const center = camera.position.clone();
            for (let i = 0; i < 4; i++) {
                const near = i === 0 ? 1 : splits[i - 1];
                const far = splits[i];
                const size = far * 1.2;
                const lightPos = new Vec3().copy(center).addScaled(sun.direction, -far * 0.5);
                const lightView = new Mat4().lookAt(lightPos, center, new Vec3(0, 1, 0));
                lightView.invert();
                const lightProj = new Mat4().makeOrthographic(-size, size, -size, size, 1, far * 2.5);
                this.lightVP[i].copy(lightProj).multiply(lightView);
                this._lightVPFlat.set(this.lightVP[i].e, i * 16);
            }
            this._cascadeSplitsFlat.set(splits);
        }

        _renderShadows(scene, meshes, instancedMeshes) {
            const gl = this.gl;
            gl.viewport(0, 0, this.shadowSize, this.shadowSize);
            gl.enable(gl.DEPTH_TEST);
            gl.cullFace(gl.FRONT); // peter panning reduction

            const progStatic = this.programs.shadow;
            const progInst = this.programs.shadowInstanced;

            // Adaptive cascade updates: under load (OptimizerAI's shadow
            // scale drops), the far cascades — which barely change frame to
            // frame anyway — stop re-rendering every frame and just keep
            // showing their last valid content. Cascade 0 (nearest, most
            // visible) always updates. This is a real GPU-time saving, not
            // a cosmetic toggle: skipped cascades cost zero draw calls.
            const scale = this.shadowCascadeScale !== undefined ? this.shadowCascadeScale : 1.0;
            const activeCascades = Math.max(1, Math.min(4, Math.round(1 + scale * 3)));

            for (let c = 0; c < 4; c++) {
                if (c >= activeCascades && c !== 0) continue;
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBOs[c]);
                gl.clear(gl.DEPTH_BUFFER_BIT);

                gl.useProgram(progStatic.program);
                gl.uniformMatrix4fv(progStatic.uniforms.uLightVP, false, this.lightVP[c].e);
                for (const mesh of meshes) {
                    if (!mesh.castShadow || !mesh.visible) continue;
                    gl.uniformMatrix4fv(progStatic.uniforms.uModel, false, mesh.matrixWorld.e);
                    this._drawMesh(mesh);
                }

                if (instancedMeshes.length) {
                    gl.useProgram(progInst.program);
                    gl.uniformMatrix4fv(progInst.uniforms.uLightVP, false, this.lightVP[c].e);
                    for (const im of instancedMeshes) {
                        if (!im.castShadow || !im.visible || im.count === 0) continue;
                        this._drawInstanced(im);
                    }
                }
            }
            gl.cullFace(gl.BACK);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        _drawMesh(mesh) {
            const gl = this.gl;
            const geo = mesh.geometry;
            if (!geo.vao) geo.build(gl);
            gl.bindVertexArray(geo.vao);
            if (geo.indices) {
                gl.drawElements(geo.drawMode || gl.TRIANGLES, geo.indexCount, gl.UNSIGNED_INT, 0);
                this.stats.triangles += geo.indexCount / 3;
            } else {
                gl.drawArrays(geo.drawMode || gl.TRIANGLES, 0, geo.vertexCount);
                this.stats.triangles += geo.vertexCount / 3;
            }
            this.stats.drawCalls++;
        }

        _drawInstanced(im) {
            const gl = this.gl;
            if (im._needsUpload || !im._vao) im.upload(gl);
            if (im.count === 0) return;
            gl.bindVertexArray(im._vao);
            const geo = im.geometry;
            if (geo.indices) {
                gl.drawElementsInstanced(gl.TRIANGLES, geo.indexCount, gl.UNSIGNED_INT, 0, im.count);
                this.stats.triangles += (geo.indexCount / 3) * im.count;
            } else {
                gl.drawArraysInstanced(gl.TRIANGLES, 0, geo.vertexCount, im.count);
                this.stats.triangles += (geo.vertexCount / 3) * im.count;
            }
            this.stats.drawCalls++;
        }

        _bindPBRCommon(prog, scene, camera) {
            const gl = this.gl;
            const u = prog.uniforms;
            gl.uniformMatrix4fv(u.uView, false, camera.viewMatrix.e);
            gl.uniformMatrix4fv(u.uProj, false, camera.projectionMatrix.e);
            gl.uniform3fv(u.uCameraPos, [camera.position.x, camera.position.y, camera.position.z]);
            gl.uniform3fv(u.uSunDir, [scene.sun.direction.x, scene.sun.direction.y, scene.sun.direction.z]);
            gl.uniform3fv(u.uSunColor, [scene.sun.color.r, scene.sun.color.g, scene.sun.color.b]);
            gl.uniform1f(u.uSunIntensity, scene.sun.intensity);
            gl.uniform3fv(u.uAmbientColor, [scene.ambientColor.r, scene.ambientColor.g, scene.ambientColor.b]);
            gl.uniform1f(u.uExposure, this.exposure);
            gl.uniform3fv(u.uFogColor, [scene.fogColor.r, scene.fogColor.g, scene.fogColor.b]);
            gl.uniform1f(u.uFogDensity, scene.fogDensity);
            gl.uniform1f(u.uTime, this.time);
            if (u.uUseNeuralTonemap) gl.uniform1i(u.uUseNeuralTonemap, this.useNeuralTonemap ? 1 : 0);
            if (u.uWindDir) gl.uniform3fv(u.uWindDir, [scene.wind ? scene.wind.x : 1, 0, scene.wind ? scene.wind.z : 0.3]);
            if (u.uWindStrength) gl.uniform1f(u.uWindStrength, scene.windStrength || 0.06);

            // Batched cascade/shadow/point-light uniforms — one gl.uniform*v call
            // per array instead of one gl.getUniformLocation() + one gl.uniform*
            // PER ELEMENT PER MATERIAL PASS. That old pattern was doing ~44
            // driver-side string-hashed location lookups per pass, 3-4 passes
            // per frame — the single biggest cause of the 1-10 FPS seen on
            // mobile. WebGL guarantees array uniform elements sit at
            // consecutive locations starting at the array's base location, so
            // the whole array can be uploaded in one call using that base
            // location (already cached in `u` at program-link time).
            for (let i = 0; i < 4; i++) {
                gl.activeTexture(gl.TEXTURE5 + i);
                gl.bindTexture(gl.TEXTURE_2D, this.shadowMaps[i]);
            }
            gl.uniformMatrix4fv(u.uLightVP, false, this._lightVPFlat);
            gl.uniform1iv(u.uShadowMap, this._shadowTexUnits);
            gl.uniform1fv(u.uCascadeSplits, this._cascadeSplitsFlat);

            // Point lights (fires, magic orb, torches...) — capped at 8, cheapest closest ones first
            const lights = scene.pointLights || [];
            const n = Math.min(lights.length, 8);
            gl.uniform1i(u.uNumPointLights, n);
            if (n > 0) {
                const pos = this._plPosFlat, col = this._plColorFlat, inten = this._plIntensityFlat, rad = this._plRadiusFlat;
                for (let i = 0; i < n; i++) {
                    const pl = lights[i];
                    pos[i * 3] = pl.position.x; pos[i * 3 + 1] = pl.position.y; pos[i * 3 + 2] = pl.position.z;
                    col[i * 3] = pl.color.r; col[i * 3 + 1] = pl.color.g; col[i * 3 + 2] = pl.color.b;
                    inten[i] = pl.intensity;
                    rad[i] = pl.radius;
                }
                gl.uniform3fv(u.uPointLightPos, pos);
                gl.uniform3fv(u.uPointLightColor, col);
                gl.uniform1fv(u.uPointLightIntensity, inten);
                gl.uniform1fv(u.uPointLightRadius, rad);
            }
        }

        render(scene, camera) {
            const gl = this.gl;
            this.stats.drawCalls = 0;
            this.stats.triangles = 0;
            this.frame++;

            camera.aspect = this.width / this.height;
            camera.updateProjection();
            camera.updateView();
            scene.updateMatrixWorld(true);

            // Collect meshes
            const meshes = [];
            const waters = [];
            const terrains = [];
            const instancedMeshes = [];
            scene.traverse(obj => {
                if (obj.isInstanced && obj.visible) {
                    instancedMeshes.push(obj);
                } else if (obj instanceof Mesh && obj.visible) {
                    if (obj.material && obj.material.shader === 'water') waters.push(obj);
                    else if (obj.material && obj.material.shader === 'terrain') terrains.push(obj);
                    else meshes.push(obj);
                }
            });

            this._updateCascades(camera, scene.sun);
            this._renderShadows(scene, [...meshes, ...terrains], instancedMeshes);

            // === MAIN PASS to HDR target ===
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO);
            gl.viewport(0, 0, this.width, this.height);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.disable(gl.BLEND);

            // Sky
            this._renderSky(scene, camera);

            // Terrain
            if (terrains.length) {
                const prog = this.programs.terrain;
                gl.useProgram(prog.program);
                this._bindPBRCommon(prog, scene, camera);
                gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.textures.grass);
                gl.uniform1i(prog.uniforms.uGrassMap, 0);
                gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.textures.rock);
                gl.uniform1i(prog.uniforms.uRockMap, 1);
                gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.textures.snow);
                gl.uniform1i(prog.uniforms.uSnowMap, 2);
                gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.textures.noiseNormal);
                gl.uniform1i(prog.uniforms.uNormalMap, 3);
                for (const mesh of terrains) {
                    const gen = mesh.userData && mesh.userData.generator;
                    const maxH = gen ? gen.maxHeight : 32;
                    gl.uniform1f(prog.uniforms.uSnowLine, maxH * 0.6);
                    gl.uniform1f(prog.uniforms.uTreeLine, maxH * 0.78);
                    const normalMat = new Mat4().getNormalMatrix(mesh.matrixWorld);
                    gl.uniformMatrix4fv(prog.uniforms.uModel, false, mesh.matrixWorld.e);
                    gl.uniformMatrix4fv(prog.uniforms.uNormalMat, false, normalMat.e);
                    this._drawMesh(mesh);
                }
            }

            // Opaque PBR meshes
            {
                const prog = this.programs.pbr;
                gl.useProgram(prog.program);
                this._bindPBRCommon(prog, scene, camera);
                for (const mesh of meshes) {
                    const mat = mesh.material;
                    const normalMat = new Mat4().getNormalMatrix(mesh.matrixWorld);
                    gl.uniformMatrix4fv(prog.uniforms.uModel, false, mesh.matrixWorld.e);
                    gl.uniformMatrix4fv(prog.uniforms.uNormalMat, false, normalMat.e);
                    gl.uniform3fv(prog.uniforms.uAlbedo, [mat.albedo.r, mat.albedo.g, mat.albedo.b]);
                    gl.uniform1f(prog.uniforms.uMetallic, mat.metallic);
                    gl.uniform1f(prog.uniforms.uRoughness, mat.roughness);
                    gl.uniform1f(prog.uniforms.uAO, mat.ao);
                    if (prog.uniforms.uNatureType) gl.uniform1i(prog.uniforms.uNatureType, mat.natureType || 0);
                    const useAlbedo = !!mat.albedoMap;
                    gl.uniform1i(prog.uniforms.uUseAlbedoMap, useAlbedo ? 1 : 0);
                    gl.uniform1i(prog.uniforms.uUseNormalMap, mat.normalMap ? 1 : 0);
                    gl.uniform1i(prog.uniforms.uUseRoughnessMap, mat.roughnessMap ? 1 : 0);
                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, mat.albedoMap || this.textures.white);
                    gl.uniform1i(prog.uniforms.uAlbedoMap, 0);
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, mat.normalMap || this.textures.normal);
                    gl.uniform1i(prog.uniforms.uNormalMap, 1);
                    gl.activeTexture(gl.TEXTURE2);
                    gl.bindTexture(gl.TEXTURE_2D, mat.roughnessMap || this.textures.roughness);
                    gl.uniform1i(prog.uniforms.uRoughnessMap, 2);
                    this._drawMesh(mesh);
                }
            }

            // Instanced meshes (vegetation, rocks — GPU instancing, few draw calls)
            if (instancedMeshes.length) {
                const prog = this.programs.instanced;
                gl.useProgram(prog.program);
                this._bindPBRCommon(prog, scene, camera);
                for (const im of instancedMeshes) {
                    if (im.count === 0) continue;
                    const mat = im.material;
                    gl.uniform3fv(prog.uniforms.uAlbedo, [mat.albedo.r, mat.albedo.g, mat.albedo.b]);
                    gl.uniform1f(prog.uniforms.uMetallic, mat.metallic);
                    gl.uniform1f(prog.uniforms.uRoughness, mat.roughness);
                    gl.uniform1f(prog.uniforms.uAO, mat.ao);
                    gl.uniform1i(prog.uniforms.uUseAlbedoMap, mat.albedoMap ? 1 : 0);
                    gl.uniform1i(prog.uniforms.uUseNormalMap, mat.normalMap ? 1 : 0);
                    gl.uniform1i(prog.uniforms.uUseRoughnessMap, mat.roughnessMap ? 1 : 0);
                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, mat.albedoMap || this.textures.white);
                    gl.uniform1i(prog.uniforms.uAlbedoMap, 0);
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, mat.normalMap || this.textures.normal);
                    gl.uniform1i(prog.uniforms.uNormalMap, 1);
                    gl.activeTexture(gl.TEXTURE2);
                    gl.bindTexture(gl.TEXTURE_2D, mat.roughnessMap || this.textures.roughness);
                    gl.uniform1i(prog.uniforms.uRoughnessMap, 2);
                    this._drawInstanced(im);
                }
            }

            // Water (transparent)
            if (waters.length) {
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                gl.depthMask(false);
                const prog = this.programs.water;
                gl.useProgram(prog.program);
                gl.uniformMatrix4fv(prog.uniforms.uView, false, camera.viewMatrix.e);
                gl.uniformMatrix4fv(prog.uniforms.uProj, false, camera.projectionMatrix.e);
                gl.uniform3fv(prog.uniforms.uCameraPos, [camera.position.x, camera.position.y, camera.position.z]);
                gl.uniform3fv(prog.uniforms.uSunDir, [scene.sun.direction.x, scene.sun.direction.y, scene.sun.direction.z]);
                gl.uniform3fv(prog.uniforms.uSunColor, [scene.sun.color.r, scene.sun.color.g, scene.sun.color.b]);
                gl.uniform1f(prog.uniforms.uTime, this.time);
                gl.uniform1f(prog.uniforms.uWaveScale, 1.0);
                gl.uniform3fv(prog.uniforms.uFogColor, [scene.fogColor.r, scene.fogColor.g, scene.fogColor.b]);
                gl.uniform1f(prog.uniforms.uFogDensity, scene.fogDensity);
                if (prog.uniforms.uUseNeuralTonemap) gl.uniform1i(prog.uniforms.uUseNeuralTonemap, this.useNeuralTonemap ? 1 : 0);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, this.textures.noiseNormal);
                gl.uniform1i(prog.uniforms.uNormalMap, 0);
                for (const mesh of waters) {
                    gl.uniformMatrix4fv(prog.uniforms.uModel, false, mesh.matrixWorld.e);
                    this._drawMesh(mesh);
                }
                gl.depthMask(true);
                gl.disable(gl.BLEND);
            }

            // === POST PROCESS ===
            this._postProcess(scene, camera);

            // Present
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.width, this.height);
        }

        _renderSky(scene, camera) {
            const gl = this.gl;
            const prog = this.programs.sky;
            gl.useProgram(prog.program);
            gl.depthFunc(gl.LEQUAL);
            gl.uniformMatrix4fv(prog.uniforms.uView, false, camera.viewMatrix.e);
            gl.uniformMatrix4fv(prog.uniforms.uProj, false, camera.projectionMatrix.e);
            gl.uniform3fv(prog.uniforms.uSunDir, [scene.sun.direction.x, scene.sun.direction.y, scene.sun.direction.z]);
            gl.uniform1f(prog.uniforms.uTime, this.time);
            gl.uniform1f(prog.uniforms.uTurbidity, 2.5);
            gl.bindVertexArray(this.skyGeo.vao);
            gl.drawElements(gl.TRIANGLES, this.skyGeo.indexCount, gl.UNSIGNED_INT, 0);
            this.stats.drawCalls++;
            gl.depthFunc(gl.LESS);
        }

        _postProcess(scene, camera) {
            const gl = this.gl;
            // Bloom extract
            if (this.bloomEnabled) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFBO[0]);
            gl.viewport(0, 0, this.postW >> 1, this.postH >> 1);
            gl.disable(gl.DEPTH_TEST);
            let prog = this.programs.bloomExtract;
            gl.useProgram(prog.program);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
            gl.uniform1i(prog.uniforms.uScene, 0);
            gl.uniform1f(prog.uniforms.uThreshold, 0.85);
            gl.bindVertexArray(this.quadVAO);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Blur horizontal + vertical (ping-pong)
            for (let p = 0; p < 2; p++) {
                prog = this.programs.blur;
                gl.useProgram(prog.program);
                // H
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFBO[1]);
                gl.bindTexture(gl.TEXTURE_2D, this.bloomTex[0]);
                gl.uniform1i(prog.uniforms.uTexture, 0);
                gl.uniform2f(prog.uniforms.uDirection, 1, 0);
                gl.uniform1f(prog.uniforms.uRadius, 1.5);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                // V
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFBO[0]);
                gl.bindTexture(gl.TEXTURE_2D, this.bloomTex[1]);
                gl.uniform2f(prog.uniforms.uDirection, 0, 1);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
            } else {
                gl.disable(gl.DEPTH_TEST);
            }

            // ---- God rays: project sun world position to screen space ----
            let sunScreen = [0.5, 0.5], sunVisible = 0;
            if (this.godRaysEnabled && scene && camera) {
                const sunWorldPos = new Vec3().copy(camera.position).addScaled(scene.sun.direction, -400);
                const ve = camera.viewMatrix.e, pe = camera.projectionMatrix.e;
                const x = sunWorldPos.x, y = sunWorldPos.y, z = sunWorldPos.z;
                // world -> view
                const vx = ve[0]*x + ve[4]*y + ve[8]*z + ve[12];
                const vy = ve[1]*x + ve[5]*y + ve[9]*z + ve[13];
                const vz = ve[2]*x + ve[6]*y + ve[10]*z + ve[14];
                const vw = ve[3]*x + ve[7]*y + ve[11]*z + ve[15];
                // view -> clip
                const cx = pe[0]*vx + pe[4]*vy + pe[8]*vz + pe[12]*vw;
                const cy = pe[1]*vx + pe[5]*vy + pe[9]*vz + pe[13]*vw;
                const cw = pe[3]*vx + pe[7]*vy + pe[11]*vz + pe[15]*vw;
                if (cw > 0.1) {
                    const ndcX = cx / cw, ndcY = cy / cw;
                    sunScreen = [ndcX * 0.5 + 0.5, ndcY * 0.5 + 0.5];
                    const inView = sunScreen[0] > -0.2 && sunScreen[0] < 1.2 && sunScreen[1] > -0.2 && sunScreen[1] < 1.2;
                    const elevation = -scene.sun.direction.y;
                    sunVisible = inView && elevation > -0.05 ? Math.min(1, elevation * 2.5 + 0.15) : 0;
                }
            }
            if (this.godRaysEnabled) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.godRaysFBO);
            gl.viewport(0, 0, Math.max(1, this.postW >> 2), Math.max(1, this.postH >> 2));
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            if (sunVisible > 0.01) {
                let prog = this.programs.godRays;
                gl.useProgram(prog.program);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
                gl.uniform1i(prog.uniforms.uScene, 0);
                gl.uniform2fv(prog.uniforms.uSunScreenPos, sunScreen);
                gl.uniform1f(prog.uniforms.uSunVisible, sunVisible);
                gl.uniform1f(prog.uniforms.uExposure, 0.85);
                gl.uniform1f(prog.uniforms.uDecay, 0.965);
                gl.uniform1f(prog.uniforms.uDensity, 0.9);
                gl.uniform1f(prog.uniforms.uWeight, 0.42);
                gl.bindVertexArray(this.quadVAO);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
            }

            // ---- SSAO: real ambient occlusion from the depth buffer ----
            if (this.ssaoEnabled) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssaoFBO);
                gl.viewport(0, 0, Math.max(1, this.postW >> 2), Math.max(1, this.postH >> 2));
                prog = this.programs.ssao;
                gl.useProgram(prog.program);
                this._invProj = this._invProj || new Mat4();
                this._invProj.copy(camera.projectionMatrix).invert();
                gl.uniformMatrix4fv(prog.uniforms.uInvProj, false, this._invProj.e);
                gl.uniformMatrix4fv(prog.uniforms.uProj, false, camera.projectionMatrix.e);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, this.sceneDepthTex);
                gl.uniform1i(prog.uniforms.uDepth, 0);
                gl.uniform2f(prog.uniforms.uResolution, this.postW >> 2, this.postH >> 2);
                gl.uniform1f(prog.uniforms.uRadius, 1.4);
                gl.uniform1f(prog.uniforms.uIntensity, this._metaSSAOIntensity || 1.1);
                gl.bindVertexArray(this.quadVAO);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }

            // Composite to screen
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.width, this.height);
            prog = this.programs.composite;
            gl.useProgram(prog.program);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
            gl.uniform1i(prog.uniforms.uScene, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.bloomTex[0]);
            gl.uniform1i(prog.uniforms.uBloom, 1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this.godRaysTex);
            gl.uniform1i(prog.uniforms.uGodRays, 2);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, this.ssaoTex);
            gl.uniform1i(prog.uniforms.uSSAO, 3);
            gl.uniform1i(prog.uniforms.uUseSSAO, this.ssaoEnabled ? 1 : 0);
            gl.uniform1f(prog.uniforms.uSSAOStrength, this._metaSSAOStrength || 0.65);
            gl.uniform1i(prog.uniforms.uUnderwater, (scene && scene.waterLevel !== undefined && camera.position.y < scene.waterLevel) ? 1 : 0);
            // Forcing these to 0 (rather than just skipping the extract/blur
            // draws above) matters: bloomTex/godRaysTex are only *written*
            // when their pass runs, so with the pass skipped they'd still
            // hold whatever was in them from the last time it *did* run (or
            // uninitialized/black on the very first frame) — multiplying by
            // a 0 strength here is what actually guarantees "disabled" means
            // no contribution at all, not "stale contribution".
            const bloomStr = this.bloomEnabled ? 0.55 * (this._metaBloomBoost || 1.0) : 0;
            gl.uniform1f(prog.uniforms.uBloomStrength, bloomStr);
            gl.uniform1f(prog.uniforms.uGodRayStrength, this.godRaysEnabled ? (this._metaGodRayBoost || 1.0) : 0);
            gl.uniform1f(prog.uniforms.uVignette, this._metaVignette || 0.35);
            gl.uniform1f(prog.uniforms.uSaturation, this._metaSaturation || 1.08);
            const shadowTint = this._metaColdShadow || [0.92, 0.98, 1.05];
            const highTint = this._metaWarmHighlight || [1.05, 1.0, 0.9];
            gl.uniform3fv(prog.uniforms.uColorGradeShadow, shadowTint);
            gl.uniform3fv(prog.uniforms.uColorGradeHighlight, highTint);
            gl.uniform1f(prog.uniforms.uTime, this.time);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.enable(gl.DEPTH_TEST);
        }

        setSize(w, h) {
            this.canvas.style.width = w + 'px';
            this.canvas.style.height = h + 'px';
            this.resize();
        }
    }

    // Export everything
    global.PriomGL = Object.assign(global.PriomGL || {}, {
        Geometry, Primitives, Material, Object3D, Mesh, InstancedMesh, GeometryMerger,
        PerspectiveCamera, DirectionalLight, Scene, PriomRenderer,
        Color, Vec3, Vec2, Quat, Mat4
    });

})(typeof window !== 'undefined' ? window : globalThis);
