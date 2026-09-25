/**
 * PriomGL Native Kernels — WASM entry points
 * ===========================================
 * Thin extern "C" wrapper around PriomKernels.hpp so the exact same
 * algorithms that document the engine's "C++ mind" can be compiled to
 * a real .wasm module and used at runtime — not just referenced.
 *
 * Build (requires Emscripten, see build_wasm.sh):
 *   emcc priom_kernels.cpp -O3 -s STANDALONE_WASM=1 \
 *        -s EXPORTED_FUNCTIONS=... --no-entry \
 *        -o ../wasm/priom_kernels.wasm
 *
 * If this hasn't been compiled, PolyglotBridge.loadWasmKernels() simply
 * fails the fetch and the engine keeps using the JS port in
 * PolyglotBridge.js (CppKernels) — same public API either way.
 */
#include "PriomKernels.hpp"

#if defined(__EMSCRIPTEN__)
#define PRIOM_EXPORT extern "C" __attribute__((used, visibility("default")))
#else
#define PRIOM_EXPORT extern "C"
#endif

PRIOM_EXPORT float fbm_noise2(float x, float z, int octaves, float seed) {
    return priom::fbm_noise2(x, z, octaves, seed);
}

PRIOM_EXPORT float ridged_noise2(float x, float z, int octaves, float seed) {
    return priom::ridged_noise2(x, z, octaves, seed);
}

PRIOM_EXPORT float hash2(float x, float z, float seed) {
    return priom::hash2(x, z, seed);
}

PRIOM_EXPORT float value_noise2(float x, float z, float seed) {
    return priom::value_noise2(x, z, seed);
}

// Flat-array wrappers (WASM linear memory only speaks numbers/pointers;
// pointers here are just byte offsets into the shared WebAssembly.Memory).
PRIOM_EXPORT void frustum_cull_aabbs_ptr(
    const float* aabbs, int count, const float* planes, int nplanes, uint8_t* out_mask
) {
    priom::frustum_cull_aabbs(aabbs, count, planes, nplanes, out_mask);
}

PRIOM_EXPORT void integrate_particles_ptr(
    float* pos, float* vel, int count, float dt, float gravity_y
) {
    priom::integrate_particles(pos, vel, count, dt, gravity_y);
}

// Simple bump allocator so JS can request scratch space inside the wasm
// module's own linear memory for the pointer-based functions above,
// without pulling in libc malloc.
static unsigned char g_arena[4 * 1024 * 1024];
static unsigned int g_arena_offset = 0;

PRIOM_EXPORT unsigned int priom_alloc(unsigned int bytes) {
    unsigned int aligned = (bytes + 7u) & ~7u;
    if (g_arena_offset + aligned > sizeof(g_arena)) return 0;
    unsigned int ptr = g_arena_offset;
    g_arena_offset += aligned;
    return ptr;
}

PRIOM_EXPORT void priom_reset_arena() {
    g_arena_offset = 0;
}
