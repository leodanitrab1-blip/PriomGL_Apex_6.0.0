/**
 * PriomGL GPU-friendly Particle System
 * Rain, snow, fire, leaves, dust - cinematic VFX
 */
(function(global) {
    'use strict';

    const { GLUtils } = global.PriomGL;
    const { Vec3 } = global.PriomMath;

    const particleVS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition; // quad corner -0.5..0.5
layout(location=1) in vec3 aPos;      // world position
layout(location=2) in float aLife;    // 0..1
layout(location=3) in float aSize;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uColorStart;
uniform vec3 uColorEnd;
out vec2 vUv;
out vec4 vColor;
void main() {
    vUv = aPosition.xy + 0.5;
    float fade = 1.0 - aLife;
    fade *= smoothstep(0.0, 0.15, aLife) * smoothstep(1.0, 0.7, aLife);
    vColor = vec4(mix(uColorStart, uColorEnd, aLife), fade);
    // Billboard
    vec3 camRight = vec3(uView[0][0], uView[1][0], uView[2][0]);
    vec3 camUp    = vec3(uView[0][1], uView[1][1], uView[2][1]);
    vec3 world = aPos + (camRight * aPosition.x + camUp * aPosition.y) * aSize;
    gl_Position = uProj * uView * vec4(world, 1.0);
}`;

    const particleFS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vColor;
out vec4 fragColor;
void main() {
    vec2 c = vUv - 0.5;
    float d = length(c);
    float alpha = smoothstep(0.5, 0.15, d) * vColor.a;
    if(alpha < 0.01) discard;
    fragColor = vec4(vColor.rgb, alpha);
}`;

    class ParticleSystem {
        constructor(renderer, maxParticles = 2000) {
            this.renderer = renderer;
            this.gl = renderer.assetGL || renderer.gl;
            this.max = maxParticles;
            this.emitters = [];
            this._initGPU();
        }

        _initGPU() {
            const gl = this.gl;
            this.program = GLUtils.createProgram(gl, particleVS, particleFS);
            this.uniforms = GLUtils.getUniforms(gl, this.program);

            // Quad
            const quad = new Float32Array([-0.5,-0.5,0, 0.5,-0.5,0, -0.5,0.5,0, 0.5,0.5,0]);
            this.quadBuf = GLUtils.createBuffer(gl, quad);

            // Instance data: pos.xyz, life, size  (5 floats)
            this.instanceData = new Float32Array(this.max * 5);
            this.instanceBuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
            gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

            this.vao = gl.createVertexArray();
            gl.bindVertexArray(this.vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 0);
            gl.vertexAttribDivisor(1, 1);
            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 12);
            gl.vertexAttribDivisor(2, 1);
            gl.enableVertexAttribArray(3);
            gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 20, 16);
            gl.vertexAttribDivisor(3, 1);
            gl.bindVertexArray(null);
        }

        addEmitter(emitter) {
            this.emitters.push(emitter);
            return emitter;
        }

        update(dt) {
            for (const e of this.emitters) e.update(dt);
        }

        // Renders emitters grouped by their (colorStart,colorEnd,blend) so each
        // visual "kind" (fire/rain/snow/...) gets its own correct colors and
        // blend mode instead of one hardcoded fire-orange draw for everything.
        render(camera, scale = 1) {
            const gl = this.gl;
            gl.depthMask(false);
            gl.useProgram(this.program);
            gl.uniformMatrix4fv(this.uniforms.uView, false, camera.viewMatrix.e);
            gl.uniformMatrix4fv(this.uniforms.uProj, false, camera.projectionMatrix.e);
            gl.bindVertexArray(this.vao);

            // Group emitters that share visual params to minimize state changes
            const groups = new Map();
            for (const e of this.emitters) {
                if (!e.active) continue;
                const cs = e.color || [1, 1, 1];
                const ce = e.colorEnd || cs;
                const blend = e.blendMode || 'additive';
                const key = blend + '|' + cs.join(',') + '|' + ce.join(',');
                if (!groups.has(key)) groups.set(key, { cs, ce, blend, emitters: [] });
                groups.get(key).emitters.push(e);
            }

            let currentBlend = null;
            for (const group of groups.values()) {
                let total = 0;
                for (const e of group.emitters) {
                    const n = e.fillBuffer(this.instanceData.subarray(total * 5), Math.floor((this.max - total) * scale));
                    total += n;
                    if (total * 5 >= this.instanceData.length) break;
                }
                if (total === 0) continue;

                gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, total * 5));

                if (currentBlend !== group.blend) {
                    gl.enable(gl.BLEND);
                    if (group.blend === 'alpha') gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive: fire, embers, magic
                    currentBlend = group.blend;
                }

                gl.uniform3fv(this.uniforms.uColorStart, group.cs);
                gl.uniform3fv(this.uniforms.uColorEnd, group.ce);
                gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, total);
            }

            gl.bindVertexArray(null);
            gl.depthMask(true);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.disable(gl.BLEND);
        }

        // Presets
        static createRain(ParticleEmitter, center, area = 80) {
            const e = new ParticleEmitter({
                position: center,
                max: 800,
                rate: 200,
                life: 1.8,
                lifeVar: 0.5,
                speed: 2,
                speedVar: 1,
                gravity: -25,
                size: 0.08,
                sizeEnd: 0.04,
                spread: 0.1
            });
            e._isRain = true;
            e.color = [0.65, 0.75, 0.92];
            e.colorEnd = [0.55, 0.68, 0.88];
            e.blendMode = 'alpha';
            e.fillBuffer = function(buffer, max) {
                // Custom spread over area
                let w = 0;
                for (let i = 0; i < this.count && w < max; i++) {
                    if (!this.alive[i]) continue;
                    const t = 1 - this.lifeArr[i] / this.maxLife[i];
                    buffer[w*5] = this.px[i];
                    buffer[w*5+1] = this.py[i];
                    buffer[w*5+2] = this.pz[i];
                    buffer[w*5+3] = t;
                    buffer[w*5+4] = 0.06;
                    w++;
                }
                return w;
            };
            // Override emit for rain volume
            const origEmit = e.emit.bind(e);
            e.emit = function(n) {
                for (let k = 0; k < n; k++) {
                    let i = -1;
                    for (let j = 0; j < this.maxParticles; j++) if (!this.alive[j]) { i = j; break; }
                    if (i < 0) return;
                    this.alive[i] = 1;
                    this.px[i] = center.x + (Math.random() - 0.5) * area;
                    this.py[i] = center.y + 25 + Math.random() * 15;
                    this.pz[i] = center.z + (Math.random() - 0.5) * area;
                    this.vx[i] = (Math.random() - 0.5) * 2;
                    this.vy[i] = -18 - Math.random() * 8;
                    this.vz[i] = (Math.random() - 0.5) * 2;
                    const l = 1.5 + Math.random();
                    this.lifeArr[i] = l;
                    this.maxLife[i] = l;
                    this.count = Math.max(this.count, i + 1);
                }
            };
            return e;
        }

        static createSnow(ParticleEmitter, center, area = 90) {
            const e = new ParticleEmitter({
                position: center,
                max: 600,
                rate: 80,
                life: 6,
                lifeVar: 2,
                speed: 0.8,
                gravity: -1.2,
                size: 0.12,
                sizeEnd: 0.08,
                spread: 1.5
            });
            e.color = [1.0, 1.0, 1.0];
            e.colorEnd = [0.9, 0.94, 1.0];
            e.blendMode = 'alpha';
            const orig = e.emit.bind(e);
            e.emit = function(n) {
                for (let k = 0; k < n; k++) {
                    let i = -1;
                    for (let j = 0; j < this.maxParticles; j++) if (!this.alive[j]) { i = j; break; }
                    if (i < 0) return;
                    this.alive[i] = 1;
                    this.px[i] = center.x + (Math.random() - 0.5) * area;
                    this.py[i] = center.y + 20 + Math.random() * 20;
                    this.pz[i] = center.z + (Math.random() - 0.5) * area;
                    this.vx[i] = (Math.random() - 0.5) * 1.5;
                    this.vy[i] = -0.8 - Math.random();
                    this.vz[i] = (Math.random() - 0.5) * 1.5;
                    const l = 5 + Math.random() * 4;
                    this.lifeArr[i] = l;
                    this.maxLife[i] = l;
                    this.count = Math.max(this.count, i + 1);
                }
            };
            return e;
        }

        static createFire(ParticleEmitter, pos) {
            const e = new ParticleEmitter({
                position: pos.clone(),
                max: 120,
                rate: 40,
                life: 1.2,
                lifeVar: 0.4,
                speed: 3,
                speedVar: 2,
                gravity: 2.5,
                size: 0.35,
                sizeEnd: 0.05,
                spread: 0.8
            });
            e.color = [1, 0.9, 0.6];
            e.colorEnd = [1, 0.3, 0.05];
            e.blendMode = 'additive';
            return e;
        }
    }

    global.PriomGL.ParticleSystem = ParticleSystem;

})(typeof window !== 'undefined' ? window : globalThis);
