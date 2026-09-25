/**
 * PriomGL Wildlife Renderer v2
 *
 * WorldAI simulates a full ecosystem (deer grazing, wolves hunting, bears,
 * birds migrating — state machines, energy, predator/prey chasing) but
 * originally nothing was drawn. v1 gave them crude single-segment-leg
 * blobs. This version builds real per-species anatomy — neck, two-jointed
 * legs (hip + knee) with a proper walk cycle, ears/muzzle/build that differ
 * by species — instead of one generic quadruped shape reused for everything.
 */
(function(global) {
    'use strict';

    const { Vec3, Color } = global.PriomMath;
    const { Object3D, Mesh, Primitives, Material, MaterialLibrary, GeometryMerger } = global.PriomGL;

    // Per-species body plan: proportions, not just color. A wolf is lean and
    // low with a long snout; a bear is bulky and short-legged; a deer is
    // slender and tall-legged with antlers.
    const SPECIES = {
        ciervo: {
            mat: () => MaterialLibrary.furDeer(),
            bodyLen: 1.55, bodyWidth: 0.62, bodyHeight: 0.62,
            legLen: 0.62, legThickness: 0.85, neckLen: 0.42, neckTilt: 0.55,
            headSize: 0.62, muzzleLen: 1.1, earSize: 1.0, tailLen: 0.9,
            antlers: true, gait: 'trot'
        },
        lobo: {
            mat: () => MaterialLibrary.furWolf(),
            bodyLen: 1.35, bodyWidth: 0.5, bodyHeight: 0.5,
            legLen: 0.5, legThickness: 0.8, neckLen: 0.34, neckTilt: 0.35,
            headSize: 0.58, muzzleLen: 1.35, earSize: 0.85, tailLen: 1.1,
            antlers: false, gait: 'prowl'
        },
        oso: {
            mat: () => MaterialLibrary.furBear(),
            bodyLen: 1.5, bodyWidth: 0.92, bodyHeight: 0.85,
            legLen: 0.38, legThickness: 1.35, neckLen: 0.22, neckTilt: 0.25,
            headSize: 0.72, muzzleLen: 0.85, earSize: 0.6, tailLen: 0.3,
            antlers: false, gait: 'lumber'
        }
    };

    class WildlifeRenderer {
        constructor(scene) {
            this.scene = scene;
            this.instances = new Map(); // animal.id -> render record
        }

        _limb(parent, mat, x, z, upperLen, lowerLen, thickness) {
            // Hip joint (rotates the whole leg fore/aft)
            const hip = new Object3D();
            hip.position.set(x, 0, z);
            parent.add(hip);

            const upperR = 0.05 * thickness;
            const upper = new Mesh(Primitives.cylinder(upperR * 0.82, upperR, upperLen, 10, 1), mat);
            upper.position.y = -upperLen * 0.5;
            hip.add(upper);

            // Knee joint sits at the bottom of the upper segment
            const knee = new Object3D();
            knee.position.y = -upperLen;
            hip.add(knee);

            // Lower leg + hoof share the exact same rigid frame (the knee
            // pivot) and never move independently of each other, so they
            // are merged into ONE draw call instead of two — this is a
            // real per-leg cost that used to double the draw count of
            // every walking animal for zero visual benefit.
            const lowerR = upperR * 0.75;
            const shin = new Mesh(GeometryMerger.mergeRigid([
                { geometry: Primitives.cylinder(lowerR * 0.58, lowerR, lowerLen, 10, 1), position: [0, -lowerLen * 0.5, 0] },
                { geometry: Primitives.sphere(lowerR * 1.12, 8, 6), position: [0, -lowerLen, 0] }
            ]), mat);
            knee.add(shin);

            shin.userData = { ...(shin.userData||{}), apex6Material: 'fur' };
            return { hip, knee };
        }

        _buildQuadruped(a) {
            const spec = SPECIES[a.type] || SPECIES.ciervo;
            const mat = spec.mat();
            const scale = a.radius / 0.45; // relative to reference deer radius

            const group = new Object3D();
            const legLen = spec.legLen * scale;
            const standHeight = legLen * 0.94;

            // Root carries the whole animal at ground-contact height; a
            // separate "spine" child is what actually bobs/tilts, so legs
            // (attached to root, not spine) keep clean hip pivots.
            const spine = new Object3D();
            spine.position.y = standHeight;
            group.add(spine);

            const bodyLen = spec.bodyLen * scale, bodyW = spec.bodyWidth * scale, bodyH = spec.bodyHeight * scale;
            const headSize = spec.headSize * scale * 0.5;
            const neckLen = spec.neckLen * scale;
            const headY = bodyH * 0.28 + Math.sin(spec.neckTilt) * neckLen;
            const headZ = bodyLen * 0.42 + Math.cos(spec.neckTilt) * neckLen;

            // Torso, neck, head, muzzle, ears — and antlers when present —
            // never move relative to each other (only the whole "spine"
            // bobs as one rigid body), so instead of 5-11 separate meshes
            // (5-11 draw calls, x2-5 more for shadow cascades) they are
            // baked into a SINGLE merged mesh with exactly the same
            // per-part position/rotation/scale the old hierarchy used.
            // This is the single biggest win against the draw-call
            // explosion that was tanking FPS and eventually freezing the
            // tab once enough animals were alive at once.
            const torsoParts = [
                { // body
                    geometry: Primitives.sphere(bodyH * 0.5, 22, 14),
                    position: [0, 0, 0], scale: [bodyW / bodyH, 1, bodyLen / bodyH]
                },
                { // chest volume
                    geometry: Primitives.sphere(bodyH * 0.42, 18, 12),
                    position: [0, bodyH * 0.02, bodyLen * 0.27],
                    scale: [bodyW / bodyH * 0.88, 1.12, 0.92]
                },
                { // rump volume
                    geometry: Primitives.sphere(bodyH * 0.43, 18, 12),
                    position: [0, bodyH * 0.01, -bodyLen * 0.26],
                    scale: [bodyW / bodyH * 0.94, 1.05, 0.95]
                },
                { // neck
                    geometry: Primitives.cylinder(bodyH * 0.20, bodyH * 0.31, neckLen, 14, 1),
                    position: [0, bodyH * 0.28, bodyLen * 0.42],
                    axis: [1, 0, 0], angle: Math.PI / 2 - spec.neckTilt
                },
                { // head
                    geometry: Primitives.sphere(headSize, 18, 12),
                    position: [0, headY, headZ], scale: [0.9, 0.85, 1.0]
                },
                { // muzzle
                    geometry: Primitives.cylinder(headSize * 0.29, headSize * 0.44, headSize * spec.muzzleLen, 12, 1),
                    position: [0, headY - headSize * 0.12, headZ + headSize * 0.55 * spec.muzzleLen],
                    axis: [1, 0, 0], angle: Math.PI / 2
                }
            ];
            for (const side of [-1, 1]) {
                torsoParts.push({ // ear (no rotation in the original — angle 0 was always a no-op)
                    geometry: Primitives.cone(headSize * 0.20 * spec.earSize, headSize * 0.55 * spec.earSize, 8),
                    position: [side * headSize * 0.55, headY + headSize * 0.75, headZ - headSize * 0.1]
                });
            }
            // Face landmarks are baked into the same mesh: dark nose + paired
            // eyes dramatically improve species readability at medium range
            // without multiplying draw calls. Vertex colors preserve one PBR material.
            torsoParts.push({
                geometry: Primitives.sphere(headSize * 0.19, 12, 8),
                position: [0, headY - headSize * 0.15, headZ + headSize * (0.72 * spec.muzzleLen)],
                color: [0.035, 0.028, 0.025]
            });
            for (const side of [-1, 1]) {
                torsoParts.push({
                    geometry: Primitives.sphere(headSize * 0.075, 10, 7),
                    position: [side * headSize * 0.33, headY + headSize * 0.16, headZ + headSize * 0.38],
                    color: [0.012, 0.009, 0.006]
                });
            }
            if (spec.antlers) {
                const barkTint = [0.55, 0.42, 0.3]; // approximates bark over the shared fur material
                for (const side of [-1, 1]) {
                    const gx = side * headSize * 0.4, gy = headY + headSize * 0.9, gz = headZ - headSize * 0.1;
                    torsoParts.push({
                        geometry: Primitives.cone(0.02 * scale, 0.4 * scale, 4),
                        position: [gx, gy, gz], axis: [1, 0, 0.35 * side], angle: -0.25, color: barkTint
                    });
                    for (const branchSide of [-1, 1]) {
                        torsoParts.push({
                            geometry: Primitives.cone(0.012 * scale, 0.16 * scale, 3),
                            position: [gx, gy + 0.18 * scale, gz],
                            axis: [0.3 * branchSide, 0, 0.6 * side], angle: -0.5, color: barkTint
                        });
                    }
                }
            }
            const torso = new Mesh(GeometryMerger.mergeRigid(torsoParts), mat);
            torso.userData = { ...(torso.userData||{}), apex6Material: 'fur', apex6Species: a.type };
            spine.add(torso);

            // Tail stays a separate mesh: it wags every frame in sync().
            const tail = new Mesh(Primitives.cone(0.07 * scale, spec.tailLen * scale * 0.35, 8), mat);
            tail.userData = { ...(tail.userData||{}), apex6Material: 'fur', apex6Species: a.type };
            tail.position.set(0, bodyH * 0.35, -bodyLen * 0.48);
            tail.rotation.setFromAxisAngle(new Vec3(1, 0, 0), -Math.PI * 0.55);
            spine.add(tail);

            // Four two-segment legs, attached to root (not spine) so the
            // spine can bob/sway independently of ground-contact points.
            const legX = bodyW * 0.42, upperLen = legLen * 0.52, lowerLen = legLen * 0.48;
            const legFZ = bodyLen * 0.3, legBZ = -bodyLen * 0.32;
            const legs = [
                this._limb(group, mat, legX, legFZ, upperLen, lowerLen, spec.legThickness),   // front-right
                this._limb(group, mat, -legX, legFZ, upperLen, lowerLen, spec.legThickness),  // front-left
                this._limb(group, mat, legX, legBZ, upperLen, lowerLen, spec.legThickness),   // back-right
                this._limb(group, mat, -legX, legBZ, upperLen, lowerLen, spec.legThickness)   // back-left
            ];
            for (const l of legs) l.hip.position.y = standHeight;

            // Flat list of every drawable Mesh, used by sync() to toggle
            // shadow-casting by distance without re-traversing the graph
            // every frame.
            const meshes = [torso, tail];
            for (const l of legs) { meshes.push(l.hip.children[0]); meshes.push(l.knee.children[0]); }

            return { group, spine, legs, tail, wings: null, standHeight, spec, meshes };
        }

        _buildBird(a) {
            const mat = MaterialLibrary.feather();
            const scale = a.radius / 0.2;
            const group = new Object3D();

            // Body + neck + head + beak are rigidly fixed to each other —
            // one merged mesh instead of four separate draw calls.
            const torso = new Mesh(GeometryMerger.mergeRigid([
                { geometry: Primitives.sphere(0.14 * scale, 16, 10), position: [0, 0, 0], scale: [1.5, 0.8, 1.0] },
                {
                    geometry: Primitives.cylinder(0.03 * scale, 0.045 * scale, 0.12 * scale, 5, 1),
                    position: [0, 0.05 * scale, 0.16 * scale], axis: [1, 0, 0], angle: Math.PI * 0.35
                },
                { geometry: Primitives.sphere(0.08 * scale, 12, 8), position: [0, 0.1 * scale, 0.22 * scale] },
                {
                    geometry: Primitives.cone(0.02 * scale, 0.07 * scale, 4),
                    position: [0, 0.09 * scale, 0.29 * scale], axis: [1, 0, 0], angle: Math.PI / 2,
                    color: [0.85, 0.65, 0.25] // beak tint over the shared feather material
                }
            ]), mat);
            group.add(torso);

            const tail = new Mesh(Primitives.cone(0.05 * scale, 0.22 * scale, 4), mat);
            tail.position.set(0, 0.02 * scale, -0.18 * scale);
            tail.rotation.setFromAxisAngle(new Vec3(1, 0, 0), -Math.PI * 0.42);
            group.add(tail);

            const wings = [];
            for (const side of [-1, 1]) {
                const wingGroup = new Object3D();
                wingGroup.position.set(side * 0.05 * scale, 0.03 * scale, 0);
                // Wing + wingtip merged into one mesh riding the flapping pivot.
                const wing = new Mesh(GeometryMerger.mergeRigid([
                    { geometry: Primitives.box(0.4 * scale, 0.02 * scale, 0.16 * scale), position: [side * 0.22 * scale, 0, 0] },
                    { geometry: Primitives.box(0.22 * scale, 0.015 * scale, 0.1 * scale), position: [side * 0.42 * scale, 0, 0] }
                ]), mat);
                wingGroup.add(wing);
                group.add(wingGroup);
                wings.push(wingGroup);
            }

            return { group, spine: group, legs: [], tail, wings, standHeight: 0, spec: null, meshes: [torso, tail, wings[0].children[0], wings[1].children[0]] };
        }

        _build(a) {
            const rec = a.flying ? this._buildBird(a) : this._buildQuadruped(a);
            rec.phase = Math.random() * 10;
            rec.group.name = 'wildlife_' + a.type + '_' + a.id;
            return rec;
        }

        sync(worldAI, dt, camera) {
            const camPos = camera && camera.position;
            const liveIds = this._liveIdSet || (this._liveIdSet = new Set());
            liveIds.clear();

            for (const a of worldAI.animals) {
                liveIds.add(a.id);
                let rec = this.instances.get(a.id);
                if (!rec) {
                    rec = this._build(a);
                    this.instances.set(a.id, rec);
                    this.scene.add(rec.group);
                }

                rec.group.position.copy(a.pos);

                // Wildlife shadows are expensive relative to their visual
                // payoff at range — every shadow-casting mesh gets drawn
                // again per active cascade. Past ~45m a deer-sized shadow
                // blob is imperceptible, so we simply stop casting it,
                // which is a real, measurable draw-call cut once a couple
                // dozen animals are alive at once (the main contributor to
                // both the low FPS and the freeze-after-a-few-seconds
                // reports — see CHANGELOG.md).
                if (camPos && rec.meshes) {
                    const dx = rec.group.position.x - camPos.x, dz = rec.group.position.z - camPos.z;
                    const near = (dx * dx + dz * dz) < (45 * 45);
                    for (const m of rec.meshes) m.castShadow = near;
                }

                const speed = a.vel.length();
                if (speed > 0.15) {
                    const yaw = Math.atan2(a.vel.x, a.vel.z);
                    rec.group.rotation.setFromAxisAngle(new Vec3(0, 1, 0), yaw);
                }

                const resting = a.state === 'descansando' || speed < 0.08;
                const gait = a.flying ? 9 : Math.min(1.3 + speed * 1.6, 10);
                rec.phase += dt * gait;

                if (rec.legs && rec.legs.length === 4 && !resting) {
                    // Trot gait: diagonal pairs (FR+BL, FL+BR) swing together.
                    const swingAmp = Math.min(0.62, 0.18 + speed * 0.07);
                    const kneeAmp = swingAmp * 0.9;
                    const pairs = [
                        [rec.legs[0], rec.legs[3], 0],          // FR + BL in phase
                        [rec.legs[1], rec.legs[2], Math.PI]     // FL + BR opposite phase
                    ];
                    for (const [legA, legB, offset] of pairs) {
                        for (const leg of [legA, legB]) {
                            const ph = rec.phase + (leg === legA ? 0 : offset);
                            const hipSwing = Math.sin(ph) * swingAmp;
                            // Knee bends more during the forward "lift" half of the stride,
                            // stays straighter during the backward "push" half.
                            const lift = Math.max(0, Math.sin(ph));
                            const kneeBend = lift * kneeAmp * 1.4;
                            leg.hip.rotation.setFromAxisAngle(new Vec3(1, 0, 0), hipSwing);
                            leg.knee.rotation.setFromAxisAngle(new Vec3(1, 0, 0), kneeBend);
                        }
                    }
                } else if (rec.legs && rec.legs.length === 4) {
                    // Resting/idle: legs settle to a neutral standing pose.
                    for (const leg of rec.legs) {
                        leg.hip.rotation.setFromAxisAngle(new Vec3(1, 0, 0), 0);
                        leg.knee.rotation.setFromAxisAngle(new Vec3(1, 0, 0), 0.06);
                    }
                }

                if (rec.wings && rec.wings.length === 2) {
                    const flap = Math.sin(rec.phase) * 0.7 + 0.2;
                    rec.wings[0].rotation.setFromAxisAngle(new Vec3(0, 0, 1), flap);
                    rec.wings[1].rotation.setFromAxisAngle(new Vec3(0, 0, 1), -flap);
                }
                if (rec.tail) {
                    const fleeing = a.state === 'huyendo';
                    const wag = fleeing ? Math.sin(rec.phase * 3) * 0.3 : Math.sin(rec.phase * 0.6) * 0.05;
                    rec.tail.rotation.setFromAxisAngle(new Vec3(1, 0, 0), -Math.PI * 0.55 + wag);
                }

                // Spine bob/sway rides on top of leg motion instead of moving
                // the whole animal (which would desync feet from the ground).
                if (rec.spine && rec.spine !== rec.group) {
                    const bob = resting ? Math.sin(rec.phase * 0.8) * 0.01 : Math.abs(Math.sin(rec.phase)) * 0.035 * Math.min(1, speed + 0.3);
                    rec.spine.position.y = rec.standHeight + bob;
                } else if (a.flying) {
                    const bob = Math.sin(rec.phase * 0.5) * 0.4;
                    rec.group.position.y += bob;
                }
            }

            // Real leak fixed here: animals removed from worldAI.animals
            // (death by starvation/predation/fire, or the array simply
            // being rebuilt) used to stay in `this.instances` forever —
            // their meshes never left the scene, so every death left a
            // permanent, frozen "ghost" animal still being drawn (and
            // still eligible for shadow-casting) for the rest of the
            // session. Draw calls only ever went up, never down, which
            // over a few dozen births/deaths is exactly the kind of
            // unbounded growth that turns "runs fine" into "freezes after
            // N seconds". Prune anything no longer alive every sync.
            if (this.instances.size > liveIds.size) {
                for (const [id, rec] of this.instances) {
                    if (liveIds.has(id)) continue;
                    this.scene.remove(rec.group);
                    this.instances.delete(id);
                }
            }
        }

        getCount() { return this.instances.size; }
    }

    global.PriomGL = global.PriomGL || {};
    global.PriomGL.WildlifeRenderer = WildlifeRenderer;

})(typeof window !== 'undefined' ? window : globalThis);
