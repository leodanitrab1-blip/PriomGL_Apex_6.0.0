/**
 * PriomGL Material Library — curated PBR presets.
 * Keeps material values consistent across terrain, vegetation, rocks and
 * landmarks instead of every call site guessing its own numbers.
 */
(function(global) {
    'use strict';

    const { Color } = global.PriomMath;
    const { Material } = global.PriomGL;

    const MaterialLibrary = {
        bark(tint = 1) {
            return new Material({
                albedo: new Color(0.30 * tint, 0.19 * tint, 0.11 * tint),
                roughness: 0.92, metallic: 0.0, ao: 0.9, textureFamily: 'bark'
            });
        },
        foliage(variant = 0) {
            const palettes = [
                [0.12, 0.32, 0.10], // pine green
                [0.16, 0.30, 0.12], // olive
                [0.10, 0.34, 0.16]  // spruce teal-green
            ];
            const c = palettes[variant % palettes.length];
            return new Material({ albedo: new Color(c[0], c[1], c[2]), roughness: 0.75, metallic: 0.0, textureFamily: 'leaf' });
        },
        autumnFoliage() {
            return new Material({ albedo: new Color(0.62, 0.34, 0.08), roughness: 0.7, metallic: 0.0, textureFamily: 'leaf' });
        },
        snowFoliage() {
            return new Material({ albedo: new Color(0.75, 0.8, 0.85), roughness: 0.55, metallic: 0.0 });
        },
        stoneWorn() {
            return new Material({ albedo: new Color(0.42, 0.40, 0.37), roughness: 0.88, metallic: 0.04, ao: 0.85, textureFamily: 'rock' });
        },
        stoneDark() {
            return new Material({ albedo: new Color(0.24, 0.24, 0.26), roughness: 0.8, metallic: 0.06, textureFamily: 'rock' });
        },
        snowRock() {
            return new Material({ albedo: new Color(0.92, 0.94, 0.98), roughness: 0.65, metallic: 0.0, textureFamily: 'rock' });
        },
        ice() {
            return new Material({ albedo: new Color(0.75, 0.88, 1.0), roughness: 0.12, metallic: 0.05, transparent: true, opacity: 0.85 });
        },
        gold() {
            return new Material({ albedo: new Color(0.85, 0.65, 0.22), roughness: 0.22, metallic: 0.92 });
        },
        emberGlow() {
            return new Material({ albedo: new Color(1.0, 0.45, 0.12), roughness: 0.4, metallic: 0.0 });
        },
        moonstone() {
            return new Material({ albedo: new Color(0.82, 0.86, 0.95), roughness: 0.3, metallic: 0.15 });
        },
        furDeer() {
            return new Material({ albedo: new Color(0.45, 0.32, 0.18), roughness: 0.85, metallic: 0.0, natureType: 1, textureFamily: 'fur' });
        },
        furWolf() {
            return new Material({ albedo: new Color(0.35, 0.35, 0.38), roughness: 0.85, metallic: 0.0, natureType: 1, textureFamily: 'fur' });
        },
        furBear() {
            return new Material({ albedo: new Color(0.22, 0.16, 0.11), roughness: 0.88, metallic: 0.0, natureType: 1, textureFamily: 'fur' });
        },
        feather() {
            return new Material({ albedo: new Color(0.68, 0.68, 0.72), roughness: 0.7, metallic: 0.0, natureType: 1, textureFamily: 'fur' });
        }
    };

    global.PriomGL = global.PriomGL || {};
    global.PriomGL.MaterialLibrary = MaterialLibrary;

})(typeof window !== 'undefined' ? window : globalThis);
