#!/usr/bin/env bash
# PriomGL — compile the C++ kernels to WebAssembly.
#
# This is entirely optional: the engine runs perfectly with the JS port
# of these kernels (PolyglotBridge.js -> CppKernels) if you never run
# this script. Run it once you have the Emscripten SDK installed
# (https://emscripten.org/docs/getting_started/downloads.html) and
# PolyglotBridge will pick the compiled kernels up automatically on the
# next page load (it fetches native/wasm/priom_kernels.wasm and falls
# back silently if the file is missing).
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v emcc >/dev/null 2>&1; then
    echo "emcc not found. Install the Emscripten SDK first:"
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

mkdir -p ../wasm

emcc priom_kernels.cpp \
    -O3 \
    -s STANDALONE_WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s EXPORTED_FUNCTIONS="['_fbm_noise2','_ridged_noise2','_hash2','_value_noise2','_frustum_cull_aabbs_ptr','_integrate_particles_ptr','_priom_alloc','_priom_reset_arena']" \
    --no-entry \
    -o ../wasm/priom_kernels.wasm

echo "Wrote native/wasm/priom_kernels.wasm"
echo "Reload the app — PolyglotBridge will log '⚙️ Kernels C++ (WASM) activos' in the console."
