/**
 * PriomGL Math Library - High performance math for the custom engine
 * Pure JS, no external deps. Optimized for WebGL2 engines.
 */
(function(global) {
    'use strict';

    // En navegador, global = window
    const root = typeof window !== 'undefined' ? window : global;

    const EPSILON = 1e-6;
    const DEG2RAD = Math.PI / 180;
    const RAD2DEG = 180 / Math.PI;

    // ============== VECTOR3 ==============
    class Vec3 {
        constructor(x = 0, y = 0, z = 0) {
            this.x = x; this.y = y; this.z = z;
        }
        set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
        copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
        clone() { return new Vec3(this.x, this.y, this.z); }
        add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
        addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
        sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
        mul(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
        div(s) { const inv = 1 / s; this.x *= inv; this.y *= inv; this.z *= inv; return this; }
        dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
        cross(v) {
            const x = this.y * v.z - this.z * v.y;
            const y = this.z * v.x - this.x * v.z;
            const z = this.x * v.y - this.y * v.x;
            this.x = x; this.y = y; this.z = z;
            return this;
        }
        length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
        lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
        normalize() {
            const len = this.length();
            if (len > EPSILON) { const inv = 1 / len; this.x *= inv; this.y *= inv; this.z *= inv; }
            return this;
        }
        lerp(v, t) {
            this.x += (v.x - this.x) * t;
            this.y += (v.y - this.y) * t;
            this.z += (v.z - this.z) * t;
            return this;
        }
        distanceTo(v) {
            const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        distanceToSq(v) {
            const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
            return dx * dx + dy * dy + dz * dz;
        }
        min(v) { this.x = Math.min(this.x, v.x); this.y = Math.min(this.y, v.y); this.z = Math.min(this.z, v.z); return this; }
        max(v) { this.x = Math.max(this.x, v.x); this.y = Math.max(this.y, v.y); this.z = Math.max(this.z, v.z); return this; }
        applyMatrix4(m) {
            const x = this.x, y = this.y, z = this.z;
            const e = m.e;
            const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
            this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
            this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
            this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
            return this;
        }
        applyMatrix3(m) {
            const x = this.x, y = this.y, z = this.z;
            const e = m.e;
            this.x = e[0] * x + e[3] * y + e[6] * z;
            this.y = e[1] * x + e[4] * y + e[7] * z;
            this.z = e[2] * x + e[5] * y + e[8] * z;
            return this;
        }
        transformDirection(m) {
            const x = this.x, y = this.y, z = this.z;
            const e = m.e;
            this.x = e[0] * x + e[4] * y + e[8] * z;
            this.y = e[1] * x + e[5] * y + e[9] * z;
            this.z = e[2] * x + e[6] * y + e[10] * z;
            return this.normalize();
        }
        equals(v) { return Math.abs(this.x - v.x) < EPSILON && Math.abs(this.y - v.y) < EPSILON && Math.abs(this.z - v.z) < EPSILON; }
        fromArray(a, o = 0) { this.x = a[o]; this.y = a[o + 1]; this.z = a[o + 2]; return this; }
        toArray(a = [], o = 0) { a[o] = this.x; a[o + 1] = this.y; a[o + 2] = this.z; return a; }
        static add(a, b) { return new Vec3(a.x + b.x, a.y + b.y, a.z + b.z); }
        static sub(a, b) { return new Vec3(a.x - b.x, a.y - b.y, a.z - b.z); }
        static cross(a, b) { return new Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
        static lerp(a, b, t) { return new Vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
    }

    // ============== VECTOR2 ==============
    class Vec2 {
        constructor(x = 0, y = 0) { this.x = x; this.y = y; }
        set(x, y) { this.x = x; this.y = y; return this; }
        copy(v) { this.x = v.x; this.y = v.y; return this; }
        clone() { return new Vec2(this.x, this.y); }
        add(v) { this.x += v.x; this.y += v.y; return this; }
        sub(v) { this.x -= v.x; this.y -= v.y; return this; }
        mul(s) { this.x *= s; this.y *= s; return this; }
        length() { return Math.sqrt(this.x * this.x + this.y * this.y); }
        normalize() { const l = this.length(); if (l > EPSILON) { this.x /= l; this.y /= l; } return this; }
        fromArray(a, o = 0) { this.x = a[o]; this.y = a[o + 1]; return this; }
        toArray(a = [], o = 0) { a[o] = this.x; a[o + 1] = this.y; return a; }
    }

    // ============== QUATERNION ==============
    class Quat {
        constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
        set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
        copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
        clone() { return new Quat(this.x, this.y, this.z, this.w); }
        identity() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; return this; }
        setFromAxisAngle(axis, angle) {
            const half = angle * 0.5, s = Math.sin(half);
            this.x = axis.x * s; this.y = axis.y * s; this.z = axis.z * s; this.w = Math.cos(half);
            return this;
        }
        setFromEuler(x, y, z, order = 'YXZ') {
            const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
            const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
            if (order === 'YXZ') {
                this.x = s1 * c2 * c3 + c1 * s2 * s3;
                this.y = c1 * s2 * c3 - s1 * c2 * s3;
                this.z = c1 * c2 * s3 - s1 * s2 * c3;
                this.w = c1 * c2 * c3 + s1 * s2 * s3;
            } else {
                this.x = s1 * c2 * c3 + c1 * s2 * s3;
                this.y = c1 * s2 * c3 - s1 * c2 * s3;
                this.z = c1 * c2 * s3 + s1 * s2 * c3;
                this.w = c1 * c2 * c3 - s1 * s2 * s3;
            }
            return this;
        }
        // Extracts the rotation quaternion equivalent to a Mat4's upper-left
        // 3x3 (column-major: col0=e[0..2], col1=e[4..6], col2=e[8..10]).
        // Needed anywhere a matrix is built directly (e.g. Mat4.lookAt) but
        // callers still rely on updateMatrix()'s position/rotation/scale
        // compose() each frame — without this, that recompute silently
        // overwrites the lookAt orientation with whatever `rotation` was
        // before (identity by default), snapping the camera to face
        // world -Z regardless of the intended target.
        setFromRotationMat4(m) {
            const e = m.e;
            const m11 = e[0], m12 = e[4], m13 = e[8];
            const m21 = e[1], m22 = e[5], m23 = e[9];
            const m31 = e[2], m32 = e[6], m33 = e[10];
            const trace = m11 + m22 + m33;
            if (trace > 0) {
                const s = 0.5 / Math.sqrt(trace + 1.0);
                this.w = 0.25 / s; this.x = (m32 - m23) * s; this.y = (m13 - m31) * s; this.z = (m21 - m12) * s;
            } else if (m11 > m22 && m11 > m33) {
                const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
                this.w = (m32 - m23) / s; this.x = 0.25 * s; this.y = (m12 + m21) / s; this.z = (m13 + m31) / s;
            } else if (m22 > m33) {
                const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
                this.w = (m13 - m31) / s; this.x = (m12 + m21) / s; this.y = 0.25 * s; this.z = (m23 + m32) / s;
            } else {
                const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
                this.w = (m21 - m12) / s; this.x = (m13 + m31) / s; this.y = (m23 + m32) / s; this.z = 0.25 * s;
            }
            return this.normalize();
        }
        multiply(q) {
            const x = this.x, y = this.y, z = this.z, w = this.w;
            this.x = w * q.x + x * q.w + y * q.z - z * q.y;
            this.y = w * q.y - x * q.z + y * q.w + z * q.x;
            this.z = w * q.z + x * q.y - y * q.x + z * q.w;
            this.w = w * q.w - x * q.x - y * q.y - z * q.z;
            return this;
        }
        normalize() {
            let l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
            if (l === 0) { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
            else { l = 1 / l; this.x *= l; this.y *= l; this.z *= l; this.w *= l; }
            return this;
        }
        slerp(q, t) {
            let cosHalfTheta = this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
            if (cosHalfTheta < 0) { this.x = -q.x; this.y = -q.y; this.z = -q.z; this.w = -q.w; cosHalfTheta = -cosHalfTheta; }
            else { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; }
            if (cosHalfTheta >= 1.0) return this;
            const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
            if (Math.abs(sinHalfTheta) < 0.001) {
                this.x = 0.5 * (this.x + q.x); this.y = 0.5 * (this.y + q.y);
                this.z = 0.5 * (this.z + q.z); this.w = 0.5 * (this.w + q.w);
                return this;
            }
            const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
            const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
            const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
            this.x = this.x * ratioA + q.x * ratioB;
            this.y = this.y * ratioA + q.y * ratioB;
            this.z = this.z * ratioA + q.z * ratioB;
            this.w = this.w * ratioA + q.w * ratioB;
            return this;
        }
    }

    // ============== MATRIX4 ==============
    class Mat4 {
        constructor() {
            this.e = new Float32Array(16);
            this.identity();
        }
        identity() {
            const e = this.e;
            e[0] = 1; e[1] = 0; e[2] = 0; e[3] = 0;
            e[4] = 0; e[5] = 1; e[6] = 0; e[7] = 0;
            e[8] = 0; e[9] = 0; e[10] = 1; e[11] = 0;
            e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
            return this;
        }
        copy(m) { this.e.set(m.e); return this; }
        clone() { const m = new Mat4(); m.e.set(this.e); return m; }
        multiply(m) {
            const a = this.e, b = m.e;
            const a11 = a[0], a12 = a[4], a13 = a[8], a14 = a[12];
            const a21 = a[1], a22 = a[5], a23 = a[9], a24 = a[13];
            const a31 = a[2], a32 = a[6], a33 = a[10], a34 = a[14];
            const a41 = a[3], a42 = a[7], a43 = a[11], a44 = a[15];
            const b11 = b[0], b12 = b[4], b13 = b[8], b14 = b[12];
            const b21 = b[1], b22 = b[5], b23 = b[9], b24 = b[13];
            const b31 = b[2], b32 = b[6], b33 = b[10], b34 = b[14];
            const b41 = b[3], b42 = b[7], b43 = b[11], b44 = b[15];
            a[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
            a[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
            a[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
            a[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
            a[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
            a[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
            a[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
            a[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
            a[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
            a[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
            a[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
            a[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
            a[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
            a[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
            a[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
            a[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
            return this;
        }
        premultiply(m) {
            const t = new Mat4().copy(m).multiply(this);
            this.e.set(t.e);
            return this;
        }
        makePerspective(fov, aspect, near, far) {
            const e = this.e;
            const f = 1 / Math.tan(fov * DEG2RAD * 0.5);
            const nf = 1 / (near - far);
            e[0] = f / aspect; e[1] = 0; e[2] = 0; e[3] = 0;
            e[4] = 0; e[5] = f; e[6] = 0; e[7] = 0;
            e[8] = 0; e[9] = 0; e[10] = (far + near) * nf; e[11] = -1;
            e[12] = 0; e[13] = 0; e[14] = 2 * far * near * nf; e[15] = 0;
            return this;
        }
        makeOrthographic(left, right, bottom, top, near, far) {
            const e = this.e;
            const lr = 1 / (left - right), bt = 1 / (bottom - top), nf = 1 / (near - far);
            e[0] = -2 * lr; e[1] = 0; e[2] = 0; e[3] = 0;
            e[4] = 0; e[5] = -2 * bt; e[6] = 0; e[7] = 0;
            e[8] = 0; e[9] = 0; e[10] = 2 * nf; e[11] = 0;
            e[12] = (left + right) * lr; e[13] = (top + bottom) * bt; e[14] = (far + near) * nf; e[15] = 1;
            return this;
        }
        makeTranslation(x, y, z) {
            this.identity();
            this.e[12] = x; this.e[13] = y; this.e[14] = z;
            return this;
        }
        makeScale(x, y, z) {
            this.identity();
            this.e[0] = x; this.e[5] = y; this.e[10] = z;
            return this;
        }
        makeRotationFromQuaternion(q) {
            const e = this.e;
            const x = q.x, y = q.y, z = q.z, w = q.w;
            const x2 = x + x, y2 = y + y, z2 = z + z;
            const xx = x * x2, xy = x * y2, xz = x * z2;
            const yy = y * y2, yz = y * z2, zz = z * z2;
            const wx = w * x2, wy = w * y2, wz = w * z2;
            e[0] = 1 - (yy + zz); e[1] = xy + wz; e[2] = xz - wy; e[3] = 0;
            e[4] = xy - wz; e[5] = 1 - (xx + zz); e[6] = yz + wx; e[7] = 0;
            e[8] = xz + wy; e[9] = yz - wx; e[10] = 1 - (xx + yy); e[11] = 0;
            e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
            return this;
        }
        compose(position, quaternion, scale) {
            this.makeRotationFromQuaternion(quaternion);
            const e = this.e;
            e[0] *= scale.x; e[1] *= scale.x; e[2] *= scale.x;
            e[4] *= scale.y; e[5] *= scale.y; e[6] *= scale.y;
            e[8] *= scale.z; e[9] *= scale.z; e[10] *= scale.z;
            e[12] = position.x; e[13] = position.y; e[14] = position.z;
            return this;
        }
        lookAt(eye, target, up) {
            const z = Vec3.sub(eye, target).normalize();
            if (z.lengthSq() === 0) z.z = 1;
            const x = Vec3.cross(up, z).normalize();
            if (x.lengthSq() === 0) {
                z.x += 0.0001;
                x.copy(Vec3.cross(up, z).normalize());
            }
            const y = Vec3.cross(z, x);
            const e = this.e;
            e[0] = x.x; e[4] = y.x; e[8] = z.x; e[12] = eye.x;
            e[1] = x.y; e[5] = y.y; e[9] = z.y; e[13] = eye.y;
            e[2] = x.z; e[6] = y.z; e[10] = z.z; e[14] = eye.z;
            e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
            return this;
        }
        invert() {
            const e = this.e;
            const n11 = e[0], n21 = e[1], n31 = e[2], n41 = e[3];
            const n12 = e[4], n22 = e[5], n32 = e[6], n42 = e[7];
            const n13 = e[8], n23 = e[9], n33 = e[10], n43 = e[11];
            const n14 = e[12], n24 = e[13], n34 = e[14], n44 = e[15];
            const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
            const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
            const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
            const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
            const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
            if (Math.abs(det) < EPSILON) return this.identity();
            const invDet = 1 / det;
            e[0] = t11 * invDet;
            e[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * invDet;
            e[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * invDet;
            e[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * invDet;
            e[4] = t12 * invDet;
            e[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * invDet;
            e[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * invDet;
            e[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * invDet;
            e[8] = t13 * invDet;
            e[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * invDet;
            e[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * invDet;
            e[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * invDet;
            e[12] = t14 * invDet;
            e[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * invDet;
            e[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * invDet;
            e[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * invDet;
            return this;
        }
        transpose() {
            const e = this.e;
            let tmp;
            tmp = e[1]; e[1] = e[4]; e[4] = tmp;
            tmp = e[2]; e[2] = e[8]; e[8] = tmp;
            tmp = e[6]; e[6] = e[9]; e[9] = tmp;
            tmp = e[3]; e[3] = e[12]; e[12] = tmp;
            tmp = e[7]; e[7] = e[13]; e[13] = tmp;
            tmp = e[11]; e[11] = e[14]; e[14] = tmp;
            return this;
        }
        getNormalMatrix(m4) {
            this.copy(m4).invert().transpose();
            this.e[3] = 0; this.e[7] = 0; this.e[11] = 0; this.e[12] = 0; this.e[13] = 0; this.e[14] = 0; this.e[15] = 1;
            return this;
        }
    }

    // ============== COLOR ==============
    class Color {
        constructor(r = 1, g = 1, b = 1) { this.r = r; this.g = g; this.b = b; }
        set(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
        setHex(hex) {
            this.r = ((hex >> 16) & 255) / 255;
            this.g = ((hex >> 8) & 255) / 255;
            this.b = (hex & 255) / 255;
            return this;
        }
        copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
        clone() { return new Color(this.r, this.g, this.b); }
        multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
        lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
        toArray(a = [], o = 0) { a[o] = this.r; a[o + 1] = this.g; a[o + 2] = this.b; return a; }
    }

    // ============== AABB ==============
    class AABB {
        constructor() {
            this.min = new Vec3(Infinity, Infinity, Infinity);
            this.max = new Vec3(-Infinity, -Infinity, -Infinity);
        }
        setFromPoints(points) {
            this.min.set(Infinity, Infinity, Infinity);
            this.max.set(-Infinity, -Infinity, -Infinity);
            for (const p of points) {
                this.min.min(p);
                this.max.max(p);
            }
            return this;
        }
        expandByPoint(p) { this.min.min(p); this.max.max(p); return this; }
        containsPoint(p) {
            return p.x >= this.min.x && p.x <= this.max.x &&
                   p.y >= this.min.y && p.y <= this.max.y &&
                   p.z >= this.min.z && p.z <= this.max.z;
        }
        intersects(box) {
            return !(box.max.x < this.min.x || box.min.x > this.max.x ||
                     box.max.y < this.min.y || box.min.y > this.max.y ||
                     box.max.z < this.min.z || box.min.z > this.max.z);
        }
        getCenter(target = new Vec3()) {
            return target.set(
                (this.min.x + this.max.x) * 0.5,
                (this.min.y + this.max.y) * 0.5,
                (this.min.z + this.max.z) * 0.5
            );
        }
        getSize(target = new Vec3()) {
            return target.set(
                this.max.x - this.min.x,
                this.max.y - this.min.y,
                this.max.z - this.min.z
            );
        }
    }

    // Export
    root.PriomMath = {
        Vec2, Vec3, Quat, Mat4, Color, AABB,
        EPSILON, DEG2RAD, RAD2DEG,
        clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
        lerp: (a, b, t) => a + (b - a) * t,
        smoothstep: (edge0, edge1, x) => {
            const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
            return t * t * (3 - 2 * t);
        },
        random: (min = 0, max = 1) => min + Math.random() * (max - min),
        degToRad: (d) => d * DEG2RAD,
        radToDeg: (r) => r * RAD2DEG
    };

})(typeof window !== 'undefined' ? window : global);