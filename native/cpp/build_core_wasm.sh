#!/usr/bin/env bash
set -euo pipefail
mkdir -p ../wasm
em++ PriomCore.cpp -std=c++20 -O3 -flto -sSTANDALONE_WASM=1 -sERROR_ON_UNDEFINED_SYMBOLS=0 \
  -sEXPORTED_FUNCTIONS='["_priom_fbm","_priom_hash","_priom_sphere_visible","_priom_build_meshlet_groups","_priom_integrate_flock"]' \
  -Wl,--no-entry -o ../wasm/priom_core.wasm
echo "Built ../wasm/priom_core.wasm"
