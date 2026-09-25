/**
 * PriomGL Native Kernels — C++ high-performance core
 * ====================================================
 * Diseñado para compilarse a WASM (Emscripten / wasi) en el futuro.
 * Hoy el motor usa ports JS idénticos vía PolyglotBridge.
 *
 * Filosofía: lo mejor de C++ (control de memoria, velocidad, SIMD-friendly)
 * expuesto con una API C-simple que JS puede llamar.
 *
 * Kernels incluidos:
 *  - fbm_noise2 / ridged_noise2  → terreno y vegetación
 *  - frustum_cull_aabbs          → culling masivo de instancias
 *  - integrate_particles         → partículas simples
 *
 * Sin dependencias externas. Solo <cmath> y tipos fijos.
 */
#pragma once

#include <cmath>
#include <cstdint>

namespace priom {

// ---------- Noise (hash + value noise + FBM + ridged) ----------

inline float hash2(float x, float z, float seed) {
    float n = std::sin(x * 127.1f + z * 311.7f + seed * 0.1f) * 43758.5453123f;
    return n - std::floor(n);
}

inline float value_noise2(float x, float z, float seed) {
    float ix = std::floor(x), iz = std::floor(z);
    float fx = x - ix, fz = z - iz;
    float ux = fx * fx * (3.f - 2.f * fx);
    float uz = fz * fz * (3.f - 2.f * fz);
    float a = hash2(ix,     iz,     seed);
    float b = hash2(ix+1.f, iz,     seed);
    float c = hash2(ix,     iz+1.f, seed);
    float d = hash2(ix+1.f, iz+1.f, seed);
    return a + (b-a)*ux + (c-a)*uz + (a-b-c+d)*ux*uz;
}

/** FBM clásico — octavas configurables */
inline float fbm_noise2(float x, float z, int octaves, float seed) {
    float v = 0.f, a = 0.5f, f = 1.f;
    for (int i = 0; i < octaves; ++i) {
        v += a * value_noise2(x * f, z * f, seed + i * 17.3f);
        a *= 0.5f;
        f *= 2.03f;
    }
    return v;
}

/** Ridged multi-fractal — montañas afiladas */
inline float ridged_noise2(float x, float z, int octaves, float seed) {
    float v = 0.f, a = 0.5f, f = 1.f;
    for (int i = 0; i < octaves; ++i) {
        float n = 1.f - std::fabs(value_noise2(x * f, z * f, seed + i * 31.1f) * 2.f - 1.f);
        v += a * n * n;
        a *= 0.5f;
        f *= 2.1f;
    }
    return v;
}

// ---------- Frustum culling de AABBs (SOA-friendly) ----------

struct Plane {
    float nx, ny, nz, d; // ax+by+cz+d >= 0 inside
};

struct AABB {
    float minx, miny, minz;
    float maxx, maxy, maxz;
};

/** Devuelve 1 si el AABB está total o parcialmente dentro de los 6 planos */
inline int aabb_in_frustum(const AABB& b, const Plane* planes, int nplanes) {
    for (int i = 0; i < nplanes; ++i) {
        const Plane& p = planes[i];
        // p-vertex (el más cercano en dirección opuesta a la normal)
        float px = (p.nx >= 0.f) ? b.minx : b.maxx;
        float py = (p.ny >= 0.f) ? b.miny : b.maxy;
        float pz = (p.nz >= 0.f) ? b.minz : b.maxz;
        if (p.nx*px + p.ny*py + p.nz*pz + p.d < 0.f) return 0;
    }
    return 1;
}

/**
 * Culling masivo: escribe 1/0 en out_mask[i] para cada AABB.
 * Diseñado para ser llamado desde JS con arrays planos Float32.
 */
inline void frustum_cull_aabbs(
    const float* aabbs,   // 6 floats por AABB: minx,miny,minz,maxx,maxy,maxz
    int count,
    const float* planes,  // 4 floats por plano: nx,ny,nz,d  (6 planos)
    int nplanes,
    uint8_t* out_mask
) {
    for (int i = 0; i < count; ++i) {
        const float* a = aabbs + i * 6;
        AABB b{a[0],a[1],a[2],a[3],a[4],a[5]};
        Plane pl[6];
        for (int p = 0; p < nplanes && p < 6; ++p) {
            const float* src = planes + p * 4;
            pl[p] = {src[0],src[1],src[2],src[3]};
        }
        out_mask[i] = static_cast<uint8_t>(aabb_in_frustum(b, pl, nplanes));
    }
}

// ---------- Particle integrate (simple Euler) ----------

inline void integrate_particles(
    float* pos,      // xyz xyz ...
    float* vel,      // xyz xyz ...
    int count,
    float dt,
    float gravity_y
) {
    for (int i = 0; i < count; ++i) {
        int o = i * 3;
        vel[o+1] += gravity_y * dt;
        pos[o]   += vel[o]   * dt;
        pos[o+1] += vel[o+1] * dt;
        pos[o+2] += vel[o+2] * dt;
    }
}

} // namespace priom
