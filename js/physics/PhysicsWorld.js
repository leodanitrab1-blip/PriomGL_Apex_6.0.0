/**
 * PriomGL Physics World - Lightweight but capable rigid-body & particle physics
 * Custom engine, no external libs. Suitable for games + cinematic simulation.
 */
(function(global) {
    'use strict';

    const { Vec3, Quat, Mat4, AABB } = global.PriomMath;

    class RigidBody {
        constructor(options = {}) {
            this.position = options.position ? options.position.clone() : new Vec3();
            this.velocity = options.velocity ? options.velocity.clone() : new Vec3();
            this.acceleration = new Vec3();
            this.rotation = options.rotation ? options.rotation.clone() : new Quat();
            this.angularVelocity = options.angularVelocity ? options.angularVelocity.clone() : new Vec3();
            this.mass = options.mass ?? 1;
            this.invMass = this.mass > 0 ? 1 / this.mass : 0;
            this.restitution = options.restitution ?? 0.3;
            this.friction = options.friction ?? 0.4;
            this.radius = options.radius ?? 0.5; // sphere approximation for speed
            this.isStatic = options.isStatic || false;
            this.isTrigger = options.isTrigger || false;
            this.onGround = false;
            this.userData = options.userData || null;
            this.active = true;
        }

        applyForce(f) {
            if (this.isStatic || this.invMass === 0) return;
            this.acceleration.addScaled(f, this.invMass);
        }

        applyImpulse(imp) {
            if (this.isStatic || this.invMass === 0) return;
            this.velocity.addScaled(imp, this.invMass);
        }
    }

    class PhysicsWorld {
        constructor(options = {}) {
            this.gravity = options.gravity || new Vec3(0, -18.5, 0);
            this.bodies = [];
            this.groundY = options.groundY ?? 0;
            this.getHeight = options.getHeight || ((x, z) => this.groundY);
            this.damping = options.damping ?? 0.998;
            this.airDamping = options.airDamping ?? 0.999;
            this.maxSubSteps = 4;
            this.fixedDt = 1 / 60;
            this.accumulator = 0;
            this.contacts = [];
        }

        add(body) {
            this.bodies.push(body);
            return body;
        }

        remove(body) {
            const i = this.bodies.indexOf(body);
            if (i >= 0) this.bodies.splice(i, 1);
        }

        step(dt) {
            this.accumulator += Math.min(dt, 0.05);
            let steps = 0;
            while (this.accumulator >= this.fixedDt && steps < this.maxSubSteps) {
                this._integrate(this.fixedDt);
                this._collideTerrain(this.fixedDt);
                this._collideBodies();
                this.accumulator -= this.fixedDt;
                steps++;
            }
        }

        _integrate(dt) {
            for (const b of this.bodies) {
                if (!b.active || b.isStatic) continue;
                b.acceleration.add(this.gravity);
                b.velocity.addScaled(b.acceleration, dt);
                // Damping
                const damp = b.onGround ? this.damping : this.airDamping;
                b.velocity.mul(damp);
                b.position.addScaled(b.velocity, dt);
                // Simple angular (spin)
                if (b.angularVelocity.lengthSq() > 1e-6) {
                    const ang = b.angularVelocity.length() * dt;
                    const axis = b.angularVelocity.clone().normalize();
                    const dq = new Quat().setFromAxisAngle(axis, ang);
                    b.rotation.multiply(dq).normalize();
                }
                b.acceleration.set(0, 0, 0);
                b.onGround = false;
            }
        }

        // Terrain collision — was a flat "push straight up + fixed friction"
        // model, so the player could stand comfortably on a near-vertical
        // cliff face. This now estimates the real local surface normal from
        // the height field and makes bodies slide down anything steeper
        // than a walkable slope, with friction that scales down as terrain
        // gets steeper (loose scree feels looser than a gentle meadow).
        _collideTerrain(dt) {
            const eps = 0.6;
            const g = this.gravity;
            for (const b of this.bodies) {
                if (!b.active || b.isStatic) continue;
                const h = this.getHeight(b.position.x, b.position.z);
                const bottom = b.position.y - b.radius;
                if (bottom < h) {
                    const penetration = h - bottom;
                    b.position.y += penetration;

                    const hX1 = this.getHeight(b.position.x + eps, b.position.z);
                    const hX2 = this.getHeight(b.position.x - eps, b.position.z);
                    const hZ1 = this.getHeight(b.position.x, b.position.z + eps);
                    const hZ2 = this.getHeight(b.position.x, b.position.z - eps);
                    const dhdx = (hX1 - hX2) / (2 * eps);
                    const dhdz = (hZ1 - hZ2) / (2 * eps);
                    const nlen = Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
                    const nx = -dhdx / nlen, ny = 1 / nlen, nz = -dhdz / nlen;
                    const slope = 1 - ny; // 0 = flat ground, ~1 = vertical wall

                    if (b.velocity.y < 0) {
                        b.velocity.y = -b.velocity.y * b.restitution;
                        if (Math.abs(b.velocity.y) < 0.8) b.velocity.y = 0;
                    }

                    const walkable = b.maxWalkableSlope ?? 0.62; // ~52°
                    if (slope > walkable) {
                        // Too steep to stand on: slide downhill along the
                        // slope's own fall line (gravity projected onto the
                        // slope plane), with friction easing off the
                        // steeper it gets — this is what stops the player
                        // (and animals) from just parking on a cliff face.
                        const gDotN = g.x * nx + g.y * ny + g.z * nz;
                        let slideX = g.x - nx * gDotN;
                        let slideZ = g.z - nz * gDotN;
                        const slideLen = Math.sqrt(slideX * slideX + slideZ * slideZ) || 1;
                        slideX /= slideLen; slideZ /= slideLen;
                        const slideFactor = Math.min(1, (slope - walkable) * 3.2);
                        b.velocity.x += slideX * slideFactor * 9 * dt;
                        b.velocity.z += slideZ * slideFactor * 9 * dt;
                        const looseFriction = b.friction * Math.max(0.1, 1 - slideFactor * 0.85);
                        b.velocity.x *= (1 - looseFriction);
                        b.velocity.z *= (1 - looseFriction);
                    } else {
                        b.velocity.x *= (1 - b.friction);
                        b.velocity.z *= (1 - b.friction);
                    }
                    b.onGround = true;
                    b.groundNormal = b.groundNormal || new Vec3();
                    b.groundNormal.set(nx, ny, nz);
                    b.groundSlope = slope;
                } else {
                    b.groundNormal = null;
                    b.groundSlope = 0;
                }
            }
        }

        _collideBodies() {
            const n = this.bodies.length;
            for (let i = 0; i < n; i++) {
                const a = this.bodies[i];
                if (!a.active) continue;
                for (let j = i + 1; j < n; j++) {
                    const b = this.bodies[j];
                    if (!b.active) continue;
                    if (a.isStatic && b.isStatic) continue;

                    const dx = b.position.x - a.position.x;
                    const dy = b.position.y - a.position.y;
                    const dz = b.position.z - a.position.z;
                    const distSq = dx * dx + dy * dy + dz * dz;
                    const minDist = a.radius + b.radius;
                    if (distSq >= minDist * minDist || distSq < 1e-8) continue;

                    const dist = Math.sqrt(distSq);
                    const nx = dx / dist, ny = dy / dist, nz = dz / dist;
                    const penetration = minDist - dist;

                    // Separate
                    const totalInv = a.invMass + b.invMass;
                    if (totalInv <= 0) continue;
                    const corr = penetration / totalInv;
                    if (!a.isStatic) {
                        a.position.x -= nx * corr * a.invMass;
                        a.position.y -= ny * corr * a.invMass;
                        a.position.z -= nz * corr * a.invMass;
                    }
                    if (!b.isStatic) {
                        b.position.x += nx * corr * b.invMass;
                        b.position.y += ny * corr * b.invMass;
                        b.position.z += nz * corr * b.invMass;
                    }

                    // Impulse
                    const rvx = b.velocity.x - a.velocity.x;
                    const rvy = b.velocity.y - a.velocity.y;
                    const rvz = b.velocity.z - a.velocity.z;
                    const velAlongNormal = rvx * nx + rvy * ny + rvz * nz;
                    if (velAlongNormal > 0) continue;

                    const e = Math.min(a.restitution, b.restitution);
                    let jImp = -(1 + e) * velAlongNormal / totalInv;
                    const ix = jImp * nx, iy = jImp * ny, iz = jImp * nz;
                    if (!a.isStatic) {
                        a.velocity.x -= ix * a.invMass;
                        a.velocity.y -= iy * a.invMass;
                        a.velocity.z -= iz * a.invMass;
                    }
                    if (!b.isStatic) {
                        b.velocity.x += ix * b.invMass;
                        b.velocity.y += iy * b.invMass;
                        b.velocity.z += iz * b.invMass;
                    }
                }
            }
        }

        // Utility: raycast height
        raycastHeight(x, z) {
            return this.getHeight(x, z);
        }
    }

    // Simple particle system integrated with physics feel
    class ParticleEmitter {
        constructor(options = {}) {
            this.position = options.position || new Vec3();
            this.maxParticles = options.max || 500;
            this.rate = options.rate || 50; // per second
            this.life = options.life || 2.0;
            this.lifeVar = options.lifeVar || 0.5;
            this.speed = options.speed || 2;
            this.speedVar = options.speedVar || 1;
            this.gravity = options.gravity !== undefined ? options.gravity : -4;
            this.color = options.color || [1, 1, 1];
            this.colorEnd = options.colorEnd || [1, 1, 1];
            this.size = options.size || 0.15;
            this.sizeEnd = options.sizeEnd || 0.01;
            this.spread = options.spread || 0.6;
            this.active = true;
            this.acc = 0;
            // SOA for performance
            this.px = new Float32Array(this.maxParticles);
            this.py = new Float32Array(this.maxParticles);
            this.pz = new Float32Array(this.maxParticles);
            this.vx = new Float32Array(this.maxParticles);
            this.vy = new Float32Array(this.maxParticles);
            this.vz = new Float32Array(this.maxParticles);
            this.lifeArr = new Float32Array(this.maxParticles);
            this.maxLife = new Float32Array(this.maxParticles);
            this.alive = new Uint8Array(this.maxParticles);
            this.count = 0;
        }

        emit(n = 1) {
            for (let k = 0; k < n; k++) {
                let i = -1;
                for (let j = 0; j < this.maxParticles; j++) {
                    if (!this.alive[j]) { i = j; break; }
                }
                if (i < 0) return;
                this.alive[i] = 1;
                this.px[i] = this.position.x + (Math.random() - 0.5) * 0.3;
                this.py[i] = this.position.y;
                this.pz[i] = this.position.z + (Math.random() - 0.5) * 0.3;
                const theta = Math.random() * Math.PI * 2;
                const phi = (Math.random() - 0.5) * this.spread;
                const sp = this.speed + (Math.random() - 0.5) * this.speedVar;
                this.vx[i] = Math.cos(theta) * Math.cos(phi) * sp;
                this.vy[i] = Math.sin(phi) * sp + Math.random() * 1.5;
                this.vz[i] = Math.sin(theta) * Math.cos(phi) * sp;
                const l = this.life + (Math.random() - 0.5) * this.lifeVar;
                this.lifeArr[i] = l;
                this.maxLife[i] = l;
                this.count = Math.max(this.count, i + 1);
            }
        }

        update(dt) {
            if (!this.active) return;
            this.acc += this.rate * dt;
            while (this.acc >= 1) {
                this.emit(1);
                this.acc -= 1;
            }
            for (let i = 0; i < this.count; i++) {
                if (!this.alive[i]) continue;
                this.lifeArr[i] -= dt;
                if (this.lifeArr[i] <= 0) {
                    this.alive[i] = 0;
                    continue;
                }
                this.vy[i] += this.gravity * dt;
                this.px[i] += this.vx[i] * dt;
                this.py[i] += this.vy[i] * dt;
                this.pz[i] += this.vz[i] * dt;
            }
        }

        // Fill a buffer for GPU upload: x,y,z, life01, size
        fillBuffer(buffer, max) {
            let w = 0;
            for (let i = 0; i < this.count && w < max; i++) {
                if (!this.alive[i]) continue;
                const t = 1 - this.lifeArr[i] / this.maxLife[i];
                const s = this.size + (this.sizeEnd - this.size) * t;
                buffer[w * 5] = this.px[i];
                buffer[w * 5 + 1] = this.py[i];
                buffer[w * 5 + 2] = this.pz[i];
                buffer[w * 5 + 3] = t;
                buffer[w * 5 + 4] = s;
                w++;
            }
            return w;
        }
    }

    global.PriomGL.PhysicsWorld = PhysicsWorld;
    global.PriomGL.RigidBody = RigidBody;
    global.PriomGL.ParticleEmitter = ParticleEmitter;

})(typeof window !== 'undefined' ? window : globalThis);
