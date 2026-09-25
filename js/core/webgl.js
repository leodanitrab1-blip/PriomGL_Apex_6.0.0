/**
 * PriomGL WebGL2 Core Utilities
 * Shader compilation, buffer management, texture helpers - pure WebGL2
 */
(function(global) {
    'use strict';

    const root = typeof window !== 'undefined' ? window : global;
    const { Vec3, Mat4, Color } = root.PriomMath;

    class GLUtils {
        static createShader(gl, type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const info = gl.getShaderInfoLog(shader);
                gl.deleteShader(shader);
                throw new Error('Shader compile error: ' + info + '\nSource:\n' + source.substring(0, 500));
            }
            return shader;
        }

        static createProgram(gl, vsSource, fsSource, attribLocations = null) {
            const vs = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
            const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
            const program = gl.createProgram();
            gl.attachShader(program, vs);
            gl.attachShader(program, fs);
            if (attribLocations) {
                for (const [name, loc] of Object.entries(attribLocations)) {
                    gl.bindAttribLocation(program, loc, name);
                }
            }
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                const info = gl.getProgramInfoLog(program);
                gl.deleteProgram(program);
                throw new Error('Program link error: ' + info);
            }
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            return program;
        }

        static getUniforms(gl, program) {
            const uniforms = {};
            const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
            for (let i = 0; i < count; i++) {
                const info = gl.getActiveUniform(program, i);
                const name = info.name.replace(/\[0\]$/, '');
                uniforms[name] = gl.getUniformLocation(program, info.name);
            }
            return uniforms;
        }

        static getAttributes(gl, program) {
            const attrs = {};
            const count = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
            for (let i = 0; i < count; i++) {
                const info = gl.getActiveAttrib(program, i);
                attrs[info.name] = gl.getAttribLocation(program, info.name);
            }
            return attrs;
        }

        static createBuffer(gl, data, usage = gl.STATIC_DRAW) {
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, data, usage);
            return buffer;
        }

        static createIndexBuffer(gl, data, usage = gl.STATIC_DRAW) {
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, usage);
            return buffer;
        }

        static createVAO(gl) {
            return gl.createVertexArray();
        }

        static createTexture(gl, options = {}) {
            const {
                width = 1, height = 1,
                data = null,
                internalFormat = gl.RGBA8,
                format = gl.RGBA,
                type = gl.UNSIGNED_BYTE,
                minFilter = gl.LINEAR_MIPMAP_LINEAR,
                magFilter = gl.LINEAR,
                wrapS = gl.REPEAT,
                wrapT = gl.REPEAT,
                anisotropy = 16,
                generateMipmaps = true,
                flipY = false
            } = options;

            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);

            if (data) {
                gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
            } else {
                gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
            }

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);

            const ext = gl.getExtension('EXT_texture_filter_anisotropic') ||
                        gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
            if (ext && anisotropy > 1) {
                const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
                gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(anisotropy, max));
            }

            if (generateMipmaps && data) {
                gl.generateMipmap(gl.TEXTURE_2D);
            }

            return tex;
        }

        static createDepthTexture(gl, width, height) {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return tex;
        }

        static createCubeTexture(gl, size = 1) {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
            for (let i = 0; i < 6; i++) {
                gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            }
            gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
            return tex;
        }

        static createFramebuffer(gl, colorTex, depthTex = null, width, height) {
            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
            if (depthTex) {
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
            } else {
                const rb = gl.createRenderbuffer();
                gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
                gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb);
            }
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                console.error('Framebuffer incomplete:', status);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return fbo;
        }

        static createMultisampleFBO(gl, width, height, samples = 4) {
            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            const colorRB = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, colorRB);
            gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colorRB);
            const depthRB = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
            gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, width, height);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depthRB);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return { fbo, colorRB, depthRB };
        }

        static checkExtensions(gl) {
            const exts = {
                anisotropic: gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic'),
                colorBufferFloat: gl.getExtension('EXT_color_buffer_float'),
                textureFloatLinear: gl.getExtension('OES_texture_float_linear'),
                drawBuffers: true,
                instanced: true,
                depthTexture: true,
                derivatives: true
            };
            return exts;
        }

        static fullScreenQuadVAO(gl) {
            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);
            const verts = new Float32Array([
                -1, -1, 0, 0,
                 1, -1, 1, 0,
                -1,  1, 0, 1,
                 1,  1, 1, 1
            ]);
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
            gl.bindVertexArray(null);
            return vao;
        }
    }

    // Procedural texture generaors
    class TextureFactory {
        static noise(gl, size = 256, scale = 4) {
            const data = new Uint8Array(size * size * 4);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;
                    const n = this._fbm(x / size * scale, y / size * scale, 5);
                    const v = Math.floor(n * 255);
                    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
                }
            }
            return GLUtils.createTexture(gl, { width: size, height: size, data, generateMipmaps: true });
        }

        static _hash(x, y) {
            let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
            return n - Math.floor(n);
        }

        static _noise(x, y) {
            const ix = Math.floor(x), iy = Math.floor(y);
            const fx = x - ix, fy = y - iy;
            const ux = fx * fx * (3 - 2 * fx);
            const uy = fy * fy * (3 - 2 * fy);
            const a = this._hash(ix, iy);
            const b = this._hash(ix + 1, iy);
            const c = this._hash(ix, iy + 1);
            const d = this._hash(ix + 1, iy + 1);
            return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
        }

        static _fbm(x, y, octaves = 4) {
            let v = 0, a = 0.5, f = 1;
            for (let i = 0; i < octaves; i++) {
                v += a * this._noise(x * f, y * f);
                a *= 0.5; f *= 2;
            }
            return v;
        }

        static grass(gl, size = 512) {
            const data = new Uint8Array(size * size * 4);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;
                    const n = this._fbm(x / 32, y / 32, 6);
                    const n2 = this._fbm(x / 8 + 10, y / 8 + 20, 3);
                    // Fine micro-detail octave — visible as individual
                    // blade-scale mottling at close range instead of only
                    // the two broad noise layers above (which mostly wash
                    // out to a near-flat average once the tonemap and
                    // mip-filtering get to them).
                    const n3 = this._fbm(x / 2.2 + 5, y / 2.2 + 5, 2);
                    const green = 0.20 + n * 0.42 + n2 * 0.14 + n3 * 0.09;
                    data[i] = Math.floor(Math.min(1, 0.12 + n * 0.13 + n3 * 0.05) * 255);
                    data[i + 1] = Math.floor(Math.min(1, green) * 255);
                    data[i + 2] = Math.floor(Math.min(1, 0.06 + n * 0.06 + n3 * 0.03) * 255);
                    data[i + 3] = 255;
                }
            }
            return GLUtils.createTexture(gl, { width: size, height: size, data, anisotropy: 16 });
        }

        static rock(gl, size = 512) {
            const data = new Uint8Array(size * size * 4);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;
                    const n = this._fbm(x / 40, y / 40, 5);
                    const n2 = this._fbm(x / 8, y / 8, 4);
                    const n3 = this._fbm(x / 2.5, y / 2.5, 2);
                    const v = Math.min(1, 0.28 + n * 0.32 + n2 * 0.18 + n3 * 0.1);
                    data[i] = Math.floor(v * 255);
                    data[i + 1] = Math.floor(v * 0.95 * 255);
                    data[i + 2] = Math.floor(v * 0.9 * 255);
                    data[i + 3] = 255;
                }
            }
            return GLUtils.createTexture(gl, { width: size, height: size, data, anisotropy: 16 });
        }

        static normalFromHeight(gl, heightTex, size) {
            const data = new Uint8Array(size * size * 4);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;
                    const s = 0.02;
                    const hL = this._fbm((x - 1) / size * 4, y / size * 4, 4);
                    const hR = this._fbm((x + 1) / size * 4, y / size * 4, 4);
                    const hD = this._fbm(x / size * 4, (y - 1) / size * 4, 4);
                    const hU = this._fbm(x / size * 4, (y + 1) / size * 4, 4);
                    let nx = (hL - hR) * 8;
                    let ny = (hD - hU) * 8;
                    let nz = 1.0;
                    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                    nx /= len; ny /= len; nz /= len;
                    data[i] = Math.floor((nx * 0.5 + 0.5) * 255);
                    data[i + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
                    data[i + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
                    data[i + 3] = 255;
                }
            }
            return GLUtils.createTexture(gl, { width: size, height: size, data, anisotropy: 8 });
        }

        static roughnessMap(gl, size = 256, base = 0.6) {
            const data = new Uint8Array(size * size * 4);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;
                    const n = this._fbm(x / 20, y / 20, 4);
                    const r = Math.min(1, Math.max(0.1, base + (n - 0.5) * 0.4));
                    const v = Math.floor(r * 255);
                    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
                }
            }
            return GLUtils.createTexture(gl, { width: size, height: size, data });
        }
    }

    root.PriomGL = root.PriomGL || {};
    root.PriomGL.GLUtils = GLUtils;
    root.PriomGL.TextureFactory = TextureFactory;

})(typeof window !== 'undefined' ? window : global);