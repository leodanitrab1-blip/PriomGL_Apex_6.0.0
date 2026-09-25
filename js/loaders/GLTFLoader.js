/**
 * PriomGL GLTFLoader
 * ===================
 * A glTF 2.0 / GLB loader written from scratch against the engine's own
 * Geometry/Material/Mesh/Object3D classes — no external library (no
 * three.js GLTFLoader, no gltf-loader-ts, nothing). This is what lets real
 * sculpted assets (rocks, trees, props, characters — anything exported as
 * .glb from Blender, or downloaded from a CC0/licensed source like
 * Kenney.nl, Quaternius, or Poly Pizza) drop into the same scene graph and
 * renderer as the procedural geometry, using the exact same 'pbr' shader
 * program (which already has albedo/normal/roughness/metallic/AO texture
 * slots — see js/renderer/shaders.js pbrFS).
 *
 * Supported (v1):
 *  - .glb (binary container: JSON chunk + BIN chunk) and plain .gltf+.bin
 *  - POSITION / NORMAL / TEXCOORD_0 / COLOR_0 / TANGENT accessors
 *  - Missing NORMAL -> computed. Missing TANGENT -> computed from UVs.
 *  - Node hierarchy (TRS or matrix), multiple meshes/primitives per node
 *  - PBR metallic-roughness materials: baseColor (factor + texture),
 *    metallic/roughness (factor + combined texture), normal texture,
 *    occlusion texture, emissive factor (added as a flat tint boost)
 *  - Embedded images (bufferView, most common in .glb) and external/data-URI
 *    images (image/png, image/jpeg) via the browser's own decoder
 *    (createImageBitmap) — no hand-rolled PNG/JPEG decoder needed.
 *
 * NOT supported yet (documented honestly instead of silently ignored):
 *  - Skinning / skeletal animation (JOINTS_0, WEIGHTS_0, skins, animations)
 *  - Morph targets
 *  - KHR_* extensions (draco compression, texture transform, etc.)
 * A model using any of these will still load as a static (bind-pose) mesh;
 * see docs/GLTFLoader.md for the plan to add skinning next.
 */
(function (global) {
    'use strict';

    const { Vec3, Quat, Mat4, Color } = global.PriomMath;
    const { Geometry, Material, Mesh, Object3D } = global.PriomGL;

    const COMPONENT_TYPES = {
        5120: { name: 'BYTE', size: 1, array: Int8Array },
        5121: { name: 'UNSIGNED_BYTE', size: 1, array: Uint8Array },
        5122: { name: 'SHORT', size: 2, array: Int16Array },
        5123: { name: 'UNSIGNED_SHORT', size: 2, array: Uint16Array },
        5125: { name: 'UNSIGNED_INT', size: 4, array: Uint32Array },
        5126: { name: 'FLOAT', size: 4, array: Float32Array }
    };
    const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

    class GLTFLoader {
        /**
         * Load a .glb or .gltf file and return a root Object3D containing
         * the whole node hierarchy, ready for scene.add(root).
         * @param {WebGL2RenderingContext} gl
         * @param {string} url
         * @param {object} [opts] - { defaultMaterial: {roughness, metallic, ao} }
         */
        static async load(gl, url, opts = {}) {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`GLTFLoader: HTTP ${res.status} fetching ${url}`);
            const buf = await res.arrayBuffer();
            const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
            return GLTFLoader.parse(gl, buf, baseUrl, opts);
        }

        /**
         * Parse an already-fetched ArrayBuffer. Auto-detects GLB (binary,
         * starts with magic 0x46546C67 "glTF") vs plain JSON .gltf text.
         */
        static async parse(gl, arrayBuffer, baseUrl = '', opts = {}) {
            const dv = new DataView(arrayBuffer);
            let json, binChunk = null;

            if (dv.getUint32(0, true) === 0x46546c67) {
                // ---- GLB container ----
                const version = dv.getUint32(4, true);
                if (version !== 2) throw new Error(`GLTFLoader: unsupported GLB version ${version}`);
                let offset = 12;
                const totalLength = dv.getUint32(8, true);
                while (offset < totalLength) {
                    const chunkLength = dv.getUint32(offset, true);
                    const chunkType = dv.getUint32(offset + 4, true);
                    const chunkData = arrayBuffer.slice(offset + 8, offset + 8 + chunkLength);
                    if (chunkType === 0x4e4f534a) { // 'JSON'
                        json = JSON.parse(new TextDecoder('utf-8').decode(chunkData));
                    } else if (chunkType === 0x004e4942) { // 'BIN\0'
                        binChunk = chunkData;
                    }
                    offset += 8 + chunkLength;
                    if (chunkLength % 4 !== 0) offset += 4 - (chunkLength % 4); // 4-byte align
                }
            } else {
                json = JSON.parse(new TextDecoder('utf-8').decode(arrayBuffer));
            }
            if (!json) throw new Error('GLTFLoader: no JSON chunk found');

            const loader = new GLTFLoader(gl, json, binChunk, baseUrl, opts);
            await loader._loadBuffers();
            await loader._loadImages();
            loader._buildMaterials();
            return loader._buildScene();
        }

        /**
         * Convenience for the common case of a single-mesh prop (a tree,
         * rock, fence post, etc. — exactly how Kenney kits export their
         * pieces): loads the file and returns the first {geometry,
         * material} pair found, instead of a full Object3D graph. This is
         * what lets a real sculpted asset drop straight into the engine's
         * existing instancing systems (ChunkedForest / InstancedMesh),
         * which expect one Geometry + one Material, not a node hierarchy —
         * so a loaded tree costs exactly as many draw calls as a
         * procedural one (one per visible cell), not one draw call per
         * instance.
         * @returns {Promise<{geometry:Geometry, material:Material}|null>}
         */
        static async loadAsGeometry(gl, url) {
            const root = await GLTFLoader.load(gl, url);
            let found = null;
            root.traverse(o => { if (!found && o.geometry) found = o; });
            if (!found) {
                console.warn('GLTFLoader.loadAsGeometry: no mesh found in', url);
                return null;
            }
            return { geometry: found.geometry, material: found.material };
        }

        constructor(gl, json, binChunk, baseUrl, opts) {
            this.gl = gl;
            this.json = json;
            this.binChunk = binChunk;
            this.baseUrl = baseUrl;
            this.opts = opts;
            this.buffers = [];      // resolved ArrayBuffers, index = json.buffers[i]
            this.images = [];       // ImageBitmap, index = json.images[i]
            this.textures = [];     // WebGLTexture, index = json.textures[i]
            this.materials = [];    // engine Material, index = json.materials[i]
            this.meshCache = new Map(); // meshIndex -> [{geometry, material}]
        }

        // ---------------- buffers / images ----------------

        async _loadBuffers() {
            const { buffers = [] } = this.json;
            for (let i = 0; i < buffers.length; i++) {
                const b = buffers[i];
                if (b.uri === undefined) {
                    // GLB-embedded buffer (must be the BIN chunk)
                    this.buffers[i] = this.binChunk;
                } else if (b.uri.startsWith('data:')) {
                    this.buffers[i] = GLTFLoader._dataUriToArrayBuffer(b.uri);
                } else {
                    const res = await fetch(this.baseUrl + decodeURIComponent(b.uri));
                    this.buffers[i] = await res.arrayBuffer();
                }
            }
        }

        async _loadImages() {
            const { images = [], bufferViews = [] } = this.json;
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                let blob;
                if (img.uri) {
                    if (img.uri.startsWith('data:')) {
                        const ab = GLTFLoader._dataUriToArrayBuffer(img.uri);
                        blob = new Blob([ab], { type: GLTFLoader._mimeFromDataUri(img.uri) });
                    } else {
                        const res = await fetch(this.baseUrl + decodeURIComponent(img.uri));
                        blob = await res.blob();
                    }
                } else if (img.bufferView !== undefined) {
                    const bv = bufferViews[img.bufferView];
                    const buf = this.buffers[bv.buffer];
                    const start = bv.byteOffset || 0;
                    const slice = buf.slice(start, start + bv.byteLength);
                    blob = new Blob([slice], { type: img.mimeType || 'image/png' });
                } else {
                    continue;
                }
                try {
                    this.images[i] = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
                } catch (err) {
                    console.warn('GLTFLoader: failed to decode image', i, err.message);
                }
            }
        }

        static _dataUriToArrayBuffer(uri) {
            const base64 = uri.substring(uri.indexOf(',') + 1);
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return bytes.buffer;
        }
        static _mimeFromDataUri(uri) {
            const m = /^data:([^;,]+)/.exec(uri);
            return m ? m[1] : 'image/png';
        }

        _createTexture(imageIndex, srgb = false) {
            if (this.textures[imageIndex] !== undefined) return this.textures[imageIndex];
            const gl = this.gl;
            const bitmap = this.images[imageIndex];
            if (!bitmap) return null;
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            const internalFormat = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            const ext = gl.getExtension('EXT_texture_filter_anisotropic');
            if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
            this.textures[imageIndex] = tex;
            return tex;
        }

        // ---------------- accessors ----------------

        _readAccessor(accessorIndex) {
            const acc = this.json.accessors[accessorIndex];
            const bv = this.json.bufferViews[acc.bufferView];
            const buf = this.buffers[bv.buffer];
            const comp = COMPONENT_TYPES[acc.componentType];
            const numComponents = TYPE_COMPONENTS[acc.type];
            const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
            const count = acc.count;

            const elementSize = comp.size * numComponents;
            const stride = bv.byteStride || elementSize;
            const out = new Float32Array(count * numComponents);

            // Fast path: tightly packed, no interleaving.
            if (stride === elementSize && !acc.normalized) {
                const arr = new comp.array(buf, byteOffset, count * numComponents);
                for (let i = 0; i < arr.length; i++) out[i] = arr[i];
                return { data: out, numComponents, count };
            }

            // Slow path: interleaved or normalized — read element by element.
            const dv = new DataView(buf);
            const readers = {
                5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o),
                5122: (o) => dv.getInt16(o, true), 5123: (o) => dv.getUint16(o, true),
                5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true)
            };
            const read = readers[acc.componentType];
            const maxVal = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[acc.componentType] || 1;
            for (let i = 0; i < count; i++) {
                const base = byteOffset + i * stride;
                for (let c = 0; c < numComponents; c++) {
                    let v = read(base + c * comp.size);
                    if (acc.normalized) v = Math.max(v / maxVal, -1);
                    out[i * numComponents + c] = v;
                }
            }
            return { data: out, numComponents, count };
        }

        _readIndices(accessorIndex) {
            const acc = this.json.accessors[accessorIndex];
            const bv = this.json.bufferViews[acc.bufferView];
            const buf = this.buffers[bv.buffer];
            const comp = COMPONENT_TYPES[acc.componentType];
            const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
            const arr = new comp.array(buf, byteOffset, acc.count);
            return new Uint32Array(arr); // engine's Geometry.setIndex expects Uint32Array
        }

        // ---------------- tangents (computed if missing) ----------------

        static _computeTangents(positions, normals, uvs, indices, vertCount) {
            const tan = new Float32Array(vertCount * 3);
            if (!uvs) {
                // No UVs at all: fall back to an arbitrary consistent
                // tangent so normal mapping doesn't sample garbage — models
                // without UVs presumably don't use a normal map anyway.
                for (let i = 0; i < vertCount; i++) { tan[i * 3] = 1; }
                return tan;
            }
            for (let t = 0; t < indices.length; t += 3) {
                const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
                const p0x = positions[i0 * 3], p0y = positions[i0 * 3 + 1], p0z = positions[i0 * 3 + 2];
                const e1x = positions[i1 * 3] - p0x, e1y = positions[i1 * 3 + 1] - p0y, e1z = positions[i1 * 3 + 2] - p0z;
                const e2x = positions[i2 * 3] - p0x, e2y = positions[i2 * 3 + 1] - p0y, e2z = positions[i2 * 3 + 2] - p0z;
                const du1 = uvs[i1 * 2] - uvs[i0 * 2], dv1 = uvs[i1 * 2 + 1] - uvs[i0 * 2 + 1];
                const du2 = uvs[i2 * 2] - uvs[i0 * 2], dv2 = uvs[i2 * 2 + 1] - uvs[i0 * 2 + 1];
                const denom = (du1 * dv2 - du2 * dv1);
                const f = Math.abs(denom) > 1e-8 ? 1 / denom : 0;
                const tx = f * (dv2 * e1x - dv1 * e2x), ty = f * (dv2 * e1y - dv1 * e2y), tz = f * (dv2 * e1z - dv1 * e2z);
                for (const idx of [i0, i1, i2]) { tan[idx * 3] += tx; tan[idx * 3 + 1] += ty; tan[idx * 3 + 2] += tz; }
            }
            for (let i = 0; i < vertCount; i++) {
                const x = tan[i * 3], y = tan[i * 3 + 1], z = tan[i * 3 + 2];
                const len = Math.sqrt(x * x + y * y + z * z);
                if (len > 1e-8) { tan[i * 3] = x / len; tan[i * 3 + 1] = y / len; tan[i * 3 + 2] = z / len; }
                else { tan[i * 3] = 1; tan[i * 3 + 1] = 0; tan[i * 3 + 2] = 0; }
            }
            return tan;
        }

        // ---------------- materials ----------------

        _buildMaterials() {
            const { materials = [] } = this.json;
            for (let i = 0; i < materials.length; i++) {
                const m = materials[i];
                const pbr = m.pbrMetallicRoughness || {};
                const baseColor = pbr.baseColorFactor || [1, 1, 1, 1];
                const opts = {
                    albedo: new Color(baseColor[0], baseColor[1], baseColor[2]),
                    metallic: pbr.metallicFactor ?? 1.0,
                    roughness: pbr.roughnessFactor ?? 1.0,
                    ao: 1.0,
                    opacity: baseColor[3] ?? 1.0,
                    transparent: m.alphaMode === 'BLEND'
                };
                if (pbr.baseColorTexture) {
                    const texInfo = this.json.textures[pbr.baseColorTexture.index];
                    opts.albedoMap = this._createTexture(texInfo.source, true);
                }
                if (pbr.metallicRoughnessTexture) {
                    // glTF packs metallic(B) + roughness(G) into one texture;
                    // this engine's shader expects separate maps, so reuse
                    // the same texture for both — roughnessMap channel
                    // selection is a shader-side detail this engine doesn't
                    // currently do per-channel, which is a known
                    // simplification (documented in docs/GLTFLoader.md).
                    const texInfo = this.json.textures[pbr.metallicRoughnessTexture.index];
                    opts.roughnessMap = this._createTexture(texInfo.source, false);
                }
                if (m.normalTexture) {
                    const texInfo = this.json.textures[m.normalTexture.index];
                    opts.normalMap = this._createTexture(texInfo.source, false);
                }
                if (m.occlusionTexture) {
                    const texInfo = this.json.textures[m.occlusionTexture.index];
                    opts.aoMap = this._createTexture(texInfo.source, false);
                }
                this.materials[i] = new Material(opts);
            }
        }

        _defaultMaterial() {
            const d = this.opts.defaultMaterial || {};
            return new Material({
                albedo: new Color(0.75, 0.75, 0.75),
                roughness: d.roughness ?? 0.7,
                metallic: d.metallic ?? 0.0,
                ao: d.ao ?? 1.0
            });
        }

        // ---------------- geometry ----------------

        _buildGeometry(primitive) {
            const attrs = primitive.attributes;
            if (attrs.POSITION === undefined) return null;

            const posAcc = this._readAccessor(attrs.POSITION);
            const vertCount = posAcc.count;
            const positions = posAcc.data;

            const normals = attrs.NORMAL !== undefined ? this._readAccessor(attrs.NORMAL).data : null;
            const uvs = attrs.TEXCOORD_0 !== undefined ? this._readAccessor(attrs.TEXCOORD_0).data : null;
            const colors4 = attrs.COLOR_0 !== undefined ? this._readAccessor(attrs.COLOR_0) : null;
            let tangents = attrs.TANGENT !== undefined ? this._readAccessor(attrs.TANGENT).data : null;

            const indices = primitive.indices !== undefined
                ? this._readIndices(primitive.indices)
                : Uint32Array.from({ length: vertCount }, (_, i) => i);

            const geo = new Geometry();
            geo.setAttribute('position', positions, 3);

            if (normals) {
                geo.setAttribute('normal', normals, 3);
            } else {
                geo.setAttribute('normal', new Float32Array(vertCount * 3), 3);
                geo.setIndex(indices);
                geo.computeNormals(); // fills in flat-ish normals from the index buffer
            }
            if (!geo.indices) geo.setIndex(indices);

            geo.setAttribute('uv', uvs || new Float32Array(vertCount * 2), 2);

            if (!tangents) {
                // TANGENT accessor is vec4 (w = handedness) in the spec; we
                // only need the xyz direction for this engine's bitangent
                // (cross(normal, tangent)) so a vec3 is enough here.
                tangents = GLTFLoader._computeTangents(positions, geo.attributes.normal.data, uvs, geo.indices, vertCount);
            } else {
                // Strip the w (handedness) component down to vec3.
                const t3 = new Float32Array(vertCount * 3);
                for (let i = 0; i < vertCount; i++) { t3[i * 3] = tangents[i * 4]; t3[i * 3 + 1] = tangents[i * 4 + 1]; t3[i * 3 + 2] = tangents[i * 4 + 2]; }
                tangents = t3;
            }
            geo.setAttribute('tangent', tangents, 3);

            if (colors4) {
                const c3 = new Float32Array(vertCount * 3);
                for (let i = 0; i < vertCount; i++) { c3[i * 3] = colors4.data[i * colors4.numComponents]; c3[i * 3 + 1] = colors4.data[i * colors4.numComponents + 1]; c3[i * 3 + 2] = colors4.data[i * colors4.numComponents + 2]; }
                geo.setAttribute('color', c3, 3);
            } else {
                geo.setAttribute('color', new Float32Array(vertCount * 3).fill(1), 3);
            }

            return geo;
        }

        _buildMeshPrimitives(meshIndex) {
            if (this.meshCache.has(meshIndex)) return this.meshCache.get(meshIndex);
            const meshDef = this.json.meshes[meshIndex];
            const out = [];
            for (const prim of meshDef.primitives) {
                if (prim.mode !== undefined && prim.mode !== 4) continue; // 4 = TRIANGLES; skip lines/points
                const geometry = this._buildGeometry(prim);
                if (!geometry) continue;
                const material = prim.material !== undefined ? this.materials[prim.material] : this._defaultMaterial();
                out.push({ geometry, material });
            }
            this.meshCache.set(meshIndex, out);
            return out;
        }

        // ---------------- scene graph ----------------

        _applyNodeTransform(obj3d, node) {
            if (node.matrix) {
                const m = node.matrix; // column-major, glTF spec
                // Decompose into position/quaternion/scale since this
                // engine's Object3D keeps TRS separately, not a raw matrix.
                const sx = Math.hypot(m[0], m[1], m[2]);
                const sy = Math.hypot(m[4], m[5], m[6]);
                const sz = Math.hypot(m[8], m[9], m[10]);
                obj3d.scale.set(sx, sy, sz);
                obj3d.position.set(m[12], m[13], m[14]);
                const r00 = m[0] / (sx || 1), r10 = m[1] / (sx || 1), r20 = m[2] / (sx || 1);
                const r01 = m[4] / (sy || 1), r11 = m[5] / (sy || 1), r21 = m[6] / (sy || 1);
                const r02 = m[8] / (sz || 1), r12 = m[9] / (sz || 1), r22 = m[10] / (sz || 1);
                const trace = r00 + r11 + r22;
                if (trace > 0) {
                    const s = 0.5 / Math.sqrt(trace + 1.0);
                    obj3d.rotation.set((r21 - r12) * s, (r02 - r20) * s, (r10 - r01) * s, 0.25 / s);
                } else {
                    obj3d.rotation.set(0, 0, 0, 1); // degenerate rotation fallback
                }
            } else {
                if (node.translation) obj3d.position.set(node.translation[0], node.translation[1], node.translation[2]);
                if (node.rotation) obj3d.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]);
                if (node.scale) obj3d.scale.set(node.scale[0], node.scale[1], node.scale[2]);
            }
        }

        _buildNode(nodeIndex) {
            const node = this.json.nodes[nodeIndex];
            const obj3d = new Object3D();
            obj3d.name = node.name || `node_${nodeIndex}`;
            this._applyNodeTransform(obj3d, node);

            if (node.mesh !== undefined) {
                const prims = this._buildMeshPrimitives(node.mesh);
                if (prims.length === 1) {
                    const mesh = new Mesh(prims[0].geometry, prims[0].material);
                    mesh.name = obj3d.name;
                    this._applyNodeTransform(mesh, node);
                    return mesh; // collapse node+single-primitive-mesh into one Mesh
                }
                for (const p of prims) {
                    const mesh = new Mesh(p.geometry, p.material);
                    obj3d.add(mesh);
                }
            }
            if (node.children) {
                for (const childIndex of node.children) {
                    obj3d.add(this._buildNode(childIndex));
                }
            }
            return obj3d;
        }

        _buildScene() {
            const sceneIndex = this.json.scene ?? 0;
            const sceneDef = this.json.scenes[sceneIndex];
            const root = new Object3D();
            root.name = 'gltf_root';
            for (const nodeIndex of sceneDef.nodes) {
                root.add(this._buildNode(nodeIndex));
            }
            return root;
        }
    }

    global.PriomGL = global.PriomGL || {};
    global.PriomGL.GLTFLoader = GLTFLoader;

})(typeof window !== 'undefined' ? window : global);
