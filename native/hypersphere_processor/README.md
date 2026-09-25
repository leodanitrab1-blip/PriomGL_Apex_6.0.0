# HyperSphere Processor — Apex 5 integration

The experimental processor supplied by the project owner was reviewed and retained as an optional native/Python reference implementation.

Its technically valuable pieces are:

- normalized-vector cosine locality on the unit hypersphere;
- multi-probe LSH;
- HNSW approximate nearest-neighbor search;
- Cython cosine kernels.

Apex 5 uses a browser-native JavaScript port (`js/apex5/CorrelationProcessor.js`) so the engine does not require Python or Cython at runtime. The original Cython implementation remains here for offline benchmarking and future WASM/SIMD ports.

## Recommended next native step

Compile the cosine kernels to WASM SIMD and move HNSW graph traversal to a Web Worker. This makes the processor useful for very large asset/animation/material embedding banks without blocking rendering.
