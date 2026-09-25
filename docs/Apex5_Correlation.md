# PriomGL Apex 5 — HyperSphere Correlation Processor

The supplied `procesador.zip` was evaluated as software, not as a new CPU. Its strongest real components are multi-probe LSH on normalized vectors and an HNSW-style navigable graph. Those are useful for high-dimensional approximate nearest-neighbor search.

Apex 5 incorporates the idea in-browser as `HyperSphereCorrelation` and uses it for two concrete graphics tasks:

- episodic similarity memory for Trinity Neural Core;
- semantic locality for material/asset families.

This is not faster than native SIMD/GPU hardware for raw arithmetic. Its value is reducing search from scanning every candidate to a small candidate set when the dataset becomes large.

## Roadmap

1. WebWorker / SharedArrayBuffer index building.
2. WASM SIMD implementation of cosine kernels.
3. persistent binary vector index.
4. GPU compute search when WebGPU storage/compute path is available.
5. joint embeddings for geometry + material + climate + animation state.

## Benchmark on the supplied implementation

A local run with 5,000 vectors / 64 dimensions / 50 queries measured approximately:

- brute force: 3.864 ms/query;
- multi-probe LSH: 0.410 ms/query, 9.4x faster, 88.5% top-8 recall;
- HNSW at 1,200 vectors: 0.497 ms/query, 99.6% top-8 recall, 3.4x faster than exact search.

These are measurements from this environment, not guarantees for a phone or browser GPU.
