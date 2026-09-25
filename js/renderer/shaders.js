/**
 * PriomGL Ultra Shaders - Custom GLSL for PBR, shadows, water, sky, post
 * All written from scratch for maximum visual quality.
 */
(function(global) {
    'use strict';

    // ==================== NEURAL TONEMAP (shared GLSL) ====================
    // Weights trained offline by python/train_neural_tonemap.py (plain
    // numpy, no ML framework, no internet) fitting a tiny 1->12->12->1 MLP
    // to a filmic ACES-style response curve, then calibrated so f(0)=0 and
    // f(ceiling)=1 exactly (a raw sigmoid output can only asymptote toward
    // those, never reach them — left uncorrected that lifts blacks to a
    // washed-out grey, which is exactly the kind of flat/lifeless look this
    // whole feature exists to fix). Regenerate by re-running that script and
    // pasting python/neural_tonemap.glsl.txt back in here.
    const NEURAL_TONEMAP_GLSL = `
const float NT_W1[12] = float[12](0.774055, -0.506704, 0.350949, 0.523988, -1.182429, -0.679869, -0.090998, -0.634523, 0.209551, -0.547486, 0.697206, 0.374088);
const float NT_B1[12] = float[12](0.508978, 0.228713, -0.240347, 0.018774, -1.137244, -0.112008, -0.291849, -0.397700, 0.210515, -0.386086, 0.193655, 0.013533);
const float NT_W2[144] = float[144](0.084164, 0.598817, 0.122273, -0.527271, -0.006048, -0.526934, 0.594412, -0.062423, 0.019994, -0.349380, 0.676455, 0.031614, -0.096366, -0.243655, 0.221197, 0.150198, 0.258637, 0.200613, 0.664175, -0.170021, -0.273080, -0.290014, 0.141231, 0.478270, -0.105956, -0.249854, -0.339825, 0.253487, 0.218014, 0.192825, -0.107116, 0.097653, 0.104372, 0.056548, 0.435103, 0.070058, 0.239190, 0.149639, 0.090310, 0.188853, -0.698660, -0.197961, 0.022649, -0.263565, -0.032193, 0.549645, -0.208897, 0.397320, -0.758400, -0.395541, 0.144663, 0.518994, 0.538170, 0.570287, -0.554257, -0.138554, 0.195267, 0.029407, -0.851121, -0.582626, -0.322723, 0.057849, 0.080475, 0.341580, -0.038589, 0.140611, 0.000423, -0.116412, 0.092862, -0.210078, -0.305620, -0.157343, -0.514568, 0.199016, -0.183682, 0.037301, 0.190039, 0.200381, 0.281706, -0.032539, -0.162715, -0.032749, -0.682747, -0.602922, -0.576185, -0.521567, 0.212029, -0.213092, -0.025242, 0.638256, -0.339827, 0.328038, -0.450081, -0.020481, -0.535014, -0.210632, 0.361404, -0.663026, 0.158312, 0.045863, -0.268205, -0.614762, 0.073130, -0.223087, 0.109972, -0.007203, 0.680932, -0.066892, -0.430452, -0.056621, 0.121459, 0.662165, 0.456306, 0.254071, 0.382505, -0.458076, -0.329451, -0.321470, -0.317760, -0.597496, 0.264493, 0.067911, -0.641199, -0.543559, -0.029369, 0.215448, 1.051330, 1.136339, 0.265642, -0.468072, -0.670551, 0.161696, -0.345494, -0.063829, -0.268291, -0.115536, 0.329622, 0.000479, 0.107466, -0.422580, -0.605577, -0.235114, 0.092998, 0.719900);
const float NT_B2[12] = float[12](0.216828, 0.113373, -0.115765, -0.333665, -0.126662, -0.207235, 0.144698, -0.144815, 0.083928, -0.121614, 0.139350, 0.187566);
const float NT_W3[12] = float[12](0.634361, 0.708779, -0.536531, -0.994160, -0.686328, -0.826711, 1.114984, -0.027897, 0.319074, -0.264334, 0.874403, 0.676803);
const float NT_B3 = 0.230729;
const float NT_CALIB_Y0 = 0.230559;
const float NT_CALIB_YCEIL = 0.999070;

float neuralTonemapChannel(float x) {
    float xn = x * 0.25 - 1.0;
    float a1[12];
    for (int i = 0; i < 12; i++) a1[i] = tanh(xn * NT_W1[i] + NT_B1[i]);
    float a2[12];
    for (int j = 0; j < 12; j++) {
        float s = NT_B2[j];
        for (int i = 0; i < 12; i++) s += a1[i] * NT_W2[i * 12 + j];
        a2[j] = tanh(s);
    }
    float z3 = NT_B3;
    for (int j = 0; j < 12; j++) z3 += a2[j] * NT_W3[j];
    float raw = 1.0 / (1.0 + exp(-z3));
    return clamp((raw - NT_CALIB_Y0) / (NT_CALIB_YCEIL - NT_CALIB_Y0), 0.0, 1.0);
}

vec3 neuralTonemap(vec3 hdr) {
    // Evaluated once on luminance (not 3x per channel) and used to rescale
    // the original RGB ratio — same visual compression, a third of the
    // cost. This matters because this function runs per-pixel across the
    // whole screen on every terrain/PBR/water fragment, on hardware that
    // ranges from a desktop GPU down to a mid-range Android phone; given
    // this engine's history of freezing under render load, an "improve
    // graphics" feature that quietly triples fragment-shader cost would be
    // fighting the exact problem the last few rounds fixed.
    float lum = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
    float lumOut = neuralTonemapChannel(lum);
    float ratio = lum > 0.0005 ? lumOut / lum : 0.0;
    return clamp(hdr * ratio, 0.0, 1.0);
}

// Cheap fallback for hardware tiers where the ~180-FMA neural pass isn't
// worth the cost: the direct Narkowicz ACES approximation the neural net
// was trained to imitate in the first place. uUseNeuralTonemap is a
// uniform (same value for every pixel in the draw call), so this branch
// costs nothing extra beyond the one comparison — GPUs don't pay a
// divergence penalty for a branch that's identical across the whole warp.
vec3 tonemap(vec3 hdr) {
    if (uUseNeuralTonemap) return neuralTonemap(hdr);
    vec3 x = max(hdr, 0.0);
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`;

    const Shaders = {
        // ========== PBR FORWARD SHADER (Ultra Realistic) ==========
        pbrVS: `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in vec3 aTangent;
layout(location=4) in vec3 aColor;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uNormalMat;
uniform mat4 uLightVP[4]; // cascaded
uniform float uTime;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out vec3 vTangent;
out vec3 vBitangent;
out vec3 vColor;
out vec4 vShadowCoord[4];
out float vViewDepth;

void main() {
    vec4 world = uModel * vec4(aPosition, 1.0);
    vWorldPos = world.xyz;
    vNormal = normalize((uNormalMat * vec4(aNormal, 0.0)).xyz);
    vTangent = normalize((uNormalMat * vec4(aTangent, 0.0)).xyz);
    vBitangent = cross(vNormal, vTangent);
    vUv = aUv;
    vColor = aColor;
    for(int i=0;i<4;i++) vShadowCoord[i] = uLightVP[i] * world;
    vec4 viewPos = uView * world;
    vViewDepth = -viewPos.z;
    gl_Position = uProj * viewPos;
}`,

        // ========== INSTANCED PBR VERTEX (vegetation, rocks, debris) ==========
        // Same varyings/interface as pbrVS so it shares pbrFS unmodified.
        // Instance transform is decoded from the *actual* per-instance buffer
        // layout written by InstancedEntities.setInstance(): position(vec3) +
        // rotation quaternion(vec4) + scale(vec3) + color tint(vec3) + wind
        // phase(float), each its own attribute (locations 6..10). Rebuilding
        // a rotation matrix from a quaternion here (instead of assuming a
        // pre-packed 3x4 matrix that nothing ever wrote) is what keeps trees
        // from being sheared into giant spikes by garbage transform data.
        instancedVS: `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in vec3 aTangent;
layout(location=4) in vec3 aColor;
layout(location=6) in vec3 iPos;
layout(location=7) in vec4 iQuat;   // rotation (x,y,z,w)
layout(location=8) in vec3 iScale;
layout(location=9) in vec3 iColor;  // rgb tint
layout(location=10) in float iPhase; // wind sway phase

uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uLightVP[4];
uniform float uTime;
uniform vec3 uWindDir;
uniform float uWindStrength;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out vec3 vTangent;
out vec3 vBitangent;
out vec3 vColor;
out vec4 vShadowCoord[4];
out float vViewDepth;

// Standard quaternion -> 3x3 rotation matrix (q assumed normalized).
mat3 quatToMat3(vec4 q) {
    float x = q.x, y = q.y, z = q.z, w = q.w;
    float x2 = x + x, y2 = y + y, z2 = z + z;
    float xx = x * x2, xy = x * y2, xz = x * z2;
    float yy = y * y2, yz = y * z2, zz = z * z2;
    float wx = w * x2, wy = w * y2, wz = w * z2;
    return mat3(
        1.0 - (yy + zz), xy + wz,         xz - wy,
        xy - wz,         1.0 - (xx + zz), yz + wx,
        xz + wy,         yz - wx,         1.0 - (xx + yy)
    );
}

void main() {
    mat3 iRot = quatToMat3(normalize(iQuat));
    vec3 local = iRot * (aPosition * iScale);

    // Cheap wind sway: displaces higher vertices more, phased per-instance
    float heightFactor = clamp(aPosition.y * 0.35, 0.0, 1.0);
    float phase = uTime * 1.6 + iPhase;
    float sway = sin(phase) * uWindStrength * heightFactor;
    local += uWindDir * sway;

    vec3 world = iPos + local;
    vWorldPos = world;
    // Instances (trees especially) use non-uniform scale (height jitter
    // independent of trunk radius), so normals must be transformed by the
    // inverse-transpose of the scale — for a diagonal scale matrix that's
    // just component-wise 1/scale — *before* rotating. Skipping this made
    // lighting look subtly wrong on every scaled instance (flatter/harsher
    // than intended), which reads as "the shapes look off" even though the
    // geometry itself is correct.
    vec3 safeScale = max(iScale, vec3(0.0001));
    vNormal = normalize(iRot * (aNormal / safeScale));
    vTangent = normalize(iRot * aTangent);
    vBitangent = cross(vNormal, vTangent);
    vUv = aUv;
    vColor = aColor * iColor;
    for(int i=0;i<4;i++) vShadowCoord[i] = uLightVP[i] * vec4(world, 1.0);
    vec4 viewPos = uView * vec4(world, 1.0);
    vViewDepth = -viewPos.z;
    gl_Position = uProj * viewPos;
}`,

        pbrFS: `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in vec3 vTangent;
in vec3 vBitangent;
in vec3 vColor;
in vec4 vShadowCoord[4];
in float vViewDepth;

uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform sampler2D uAlbedoMap;
uniform sampler2D uNormalMap;
uniform sampler2D uRoughnessMap;
uniform sampler2D uMetallicMap;
uniform sampler2D uAOMap;
uniform sampler2D uShadowMap[4];
uniform float uCascadeSplits[4];
uniform float uMetallic;
uniform float uRoughness;
uniform float uAO;
uniform vec3 uAlbedo;
uniform bool uUseAlbedoMap;
uniform bool uUseNormalMap;
uniform bool uUseRoughnessMap;
uniform float uTime;
uniform float uExposure;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform bool uUseNeuralTonemap;
uniform int uNatureType;

// ---- Point lights (fires, landmark orb, torches...) ----
uniform int uNumPointLights;
uniform vec3 uPointLightPos[8];
uniform vec3 uPointLightColor[8];
uniform float uPointLightIntensity[8];
uniform float uPointLightRadius[8];

out vec4 fragColor;

const float PI = 3.14159265359;

// ==================== NEURAL TONEMAP ====================
// Tiny MLP (1 -> 12 -> 12 -> 1), trained offline in Python/numpy against a
// filmic ACES-style curve (python/train_neural_tonemap.py), applied here
// per color channel instead of a flat Reinhard curve. Real, tiny,
// deterministic weights — not a marketing name for a formula. See
// docs/NeuralTonemap.md. Evaluated 3x per pixel (once per channel); at
// 1-12-12-1 that's a few dozen FMAs, negligible next to the rest of the
// PBR pass.
${NEURAL_TONEMAP_GLSL}

float DistributionGGX(vec3 N, vec3 H, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;
    float nom = a2;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;
    return nom / max(denom, 0.0001);
}

float GeometrySchlickGGX(float NdotV, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k);
}

float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    return GeometrySchlickGGX(NdotV, roughness) * GeometrySchlickGGX(NdotL, roughness);
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness) {
    return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Generic Cook-Torrance contribution for an arbitrary light direction/radiance
vec3 pbrLight(vec3 N, vec3 V, vec3 L, vec3 radiance, vec3 albedo, float metallic, float roughness) {
    vec3 H = normalize(V + L);
    vec3 F0 = mix(vec3(0.04), albedo, metallic);
    float NDF = DistributionGGX(N, H, roughness);
    float G = GeometrySmith(N, V, L, roughness);
    vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);
    vec3 numerator = NDF * G * F;
    float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
    vec3 specular = numerator / denominator;
    vec3 kS = F;
    vec3 kD = (vec3(1.0) - kS) * (1.0 - metallic);
    float NdotL = max(dot(N, L), 0.0);
    return (kD * albedo / PI + specular) * radiance * NdotL;
}

float shadowPCF(sampler2D shadowMap, vec4 sc, float bias) {
    vec3 proj = sc.xyz / sc.w;
    proj = proj * 0.5 + 0.5;
    if(proj.z > 1.0 || proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0) return 1.0;
    // 3x3 PCF (was 5x5) — ~2.8x cheaper, still soft enough with cascade bias
    float shadow = 0.0;
    vec2 texel = 1.0 / vec2(textureSize(shadowMap, 0));
    for(int x=-1;x<=1;x++){
        for(int y=-1;y<=1;y++){
            float d = texture(shadowMap, proj.xy + vec2(x,y)*texel*1.15).r;
            shadow += (proj.z - bias > d) ? 0.0 : 1.0;
        }
    }
    return shadow / 9.0;
}

float getShadow(float depth, float NdotL) {
    int cascade = 0;
    if(depth > uCascadeSplits[0]) cascade = 1;
    if(depth > uCascadeSplits[1]) cascade = 2;
    if(depth > uCascadeSplits[2]) cascade = 3;
    // Slope-scaled bias: a flat constant bias only accounts for shadow-map
    // texel depth error when the surface directly faces the light. On a
    // steep slope (like a cliff lit from a shallow angle) the depth
    // gradient across one texel grows fast as NdotL shrinks, and a bias
    // sized for flat ground is nowhere near enough — the surface ends up
    // self-shadowing in banded acne stripes (this is exactly the striped
    // artifact seen on steep terrain: confirmed live in a real browser,
    // not theoretical). Scaling the bias by (1-NdotL) is the standard fix.
    float slopeBias = mix(0.0028, 0.014, 1.0 - NdotL);
    float bias = slopeBias * (1.0 + float(cascade) * 0.5);
    if(cascade==0) return shadowPCF(uShadowMap[0], vShadowCoord[0], bias);
    if(cascade==1) return shadowPCF(uShadowMap[1], vShadowCoord[1], bias);
    if(cascade==2) return shadowPCF(uShadowMap[2], vShadowCoord[2], bias);
    return shadowPCF(uShadowMap[3], vShadowCoord[3], bias);
}

void main() {
    vec3 albedo = uUseAlbedoMap ? texture(uAlbedoMap, vUv).rgb * uAlbedo * vColor : uAlbedo * vColor;
    float metallic = uMetallic;
    float roughness = uUseRoughnessMap ? texture(uRoughnessMap, vUv).r * uRoughness : uRoughness;
    float ao = uAO;

    // Native procedural micro-detail: a small amount of high-frequency
    // variation gives fur, foliage and stone a less synthetic uniform surface
    // even when no texture asset exists. It is deliberately cheap and stable.
    float n1 = sin(dot(vWorldPos, vec3(17.13, 31.71, 11.37)));
    float n2 = sin(dot(vWorldPos, vec3(47.21, 13.17, 53.91)) + n1 * 2.7);
    float micro = 0.5 + 0.5 * (n1 * 0.62 + n2 * 0.38);
    if (uNatureType == 1) {
        float fur = mix(0.90, 1.10, micro);
        albedo *= fur;
        roughness = clamp(roughness + (micro - 0.5) * 0.10, 0.55, 1.0);
    } else if (uNatureType == 2) {
        // Brown vertex colors are bark; green-dominant colors are foliage.
        float greenMask = smoothstep(0.02, 0.16, vColor.g - vColor.r);
        albedo *= mix(mix(0.88, 1.08, micro), mix(0.90, 1.12, micro), greenMask);
        roughness = clamp(roughness + (micro - 0.5) * 0.08, 0.35, 1.0);
    } else if (uNatureType == 3) {
        albedo *= mix(0.90, 1.08, micro);
        roughness = clamp(roughness + (micro - 0.5) * 0.14, 0.45, 1.0);
    }

    vec3 N = normalize(vNormal);
    if(uUseNormalMap) {
        vec3 nmap = texture(uNormalMap, vUv).rgb * 2.0 - 1.0;
        mat3 TBN = mat3(normalize(vTangent), normalize(vBitangent), N);
        N = normalize(TBN * nmap);
    }
    // Apex 4 micro-sculpt: geometry provides the macro form; this adds
    // directional sub-surface breakup for bark and fur without external maps.
    if (uNatureType == 1) {
        float fiber = sin(dot(vWorldPos, vec3(34.0, 9.0, 29.0)) + sin(vWorldPos.y * 7.0) * 1.7);
        float fiber2 = sin(dot(vWorldPos, vec3(71.0, 17.0, 63.0)) + fiber * 1.9);
        N = normalize(N + normalize(vTangent) * fiber * 0.035 + normalize(vBitangent) * fiber2 * 0.022);
    } else if (uNatureType == 2) {
        float groove = sin(vWorldPos.y * 12.0 + vWorldPos.x * 2.0 + vWorldPos.z * 2.7);
        float fine = sin(vWorldPos.y * 38.0 + vWorldPos.x * 5.0) * 0.35;
        float h = groove * 0.75 + fine;
        vec2 dg = vec2(dFdx(h), dFdy(h));
        N = normalize(N - vec3(dg * 0.24, 0.0));
    }

    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(-uSunDir);

    float NdotL = max(dot(N, L), 0.0);
    float shadow = getShadow(vViewDepth, NdotL);

    vec3 radiance = uSunColor * uSunIntensity;
    vec3 Lo = pbrLight(N, V, L, radiance, albedo, metallic, roughness) * shadow;

    // Point lights: fires, magic orb, torches — no shadows (cheap), inverse-square with soft radius cutoff
    for (int i = 0; i < 8; i++) {
        if (i >= uNumPointLights) break;
        vec3 toLight = uPointLightPos[i] - vWorldPos;
        float dist = length(toLight);
        vec3 Lp = toLight / max(dist, 0.001);
        float atten = clamp(1.0 - dist / max(uPointLightRadius[i], 0.001), 0.0, 1.0);
        atten *= atten / max(dist * dist * 0.05 + 1.0, 0.001);
        vec3 pradiance = uPointLightColor[i] * uPointLightIntensity[i] * atten;
        Lo += pbrLight(N, V, Lp, pradiance, albedo, metallic, roughness);
    }

    // Hemisphere ambient + soft sky contribution
    float hemi = N.y * 0.5 + 0.5;
    vec3 skyAmb = mix(uAmbientColor * 0.55, uSunColor * 0.22, hemi);
    vec3 ambient = skyAmb * albedo * ao;
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.2);
    ambient += mix(uAmbientColor * 0.28, uSunColor * 0.18, fresnel) * (1.0 - roughness) * (1.0 - metallic * 0.55);

    vec3 color = ambient + Lo;

    // Atmospheric perspective + height fog (more natural falloff)
    float fogDist = vViewDepth * uFogDensity;
    float fogFactor = 1.0 - exp(-fogDist * fogDist * 1.15);
    float heightFog = smoothstep(-2.0, 18.0, vWorldPos.y) * 0.15;
    fogFactor = clamp(fogFactor + heightFog * fogFactor, 0.0, 0.88);
    // Slightly blue-shifted distant fog for depth
    vec3 atmoFog = mix(uFogColor, uFogColor * vec3(0.85, 0.92, 1.08), fogFactor * 0.35);
    color = mix(color, atmoFog, fogFactor);

    // Exposure + neural tonemap (see NEURAL_TONEMAP_GLSL above — a tiny
    // MLP trained offline against a filmic ACES-style response, replacing
    // the hand-written Narkowicz approximation this line used to call
    // directly).
    color *= uExposure;
    color = tonemap(color);
    color = pow(max(color, 0.0), vec3(1.0/2.2));

    fragColor = vec4(color, 1.0);
}`,

        // ========== SHADOW DEPTH ==========
        shadowVS: `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uLightVP;
void main() {
    gl_Position = uLightVP * uModel * vec4(aPosition, 1.0);
}`,
        shadowInstancedVS: `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=6) in vec3 iPos;
layout(location=7) in vec4 iQuat;
layout(location=8) in vec3 iScale;
uniform mat4 uLightVP;

mat3 quatToMat3(vec4 q) {
    float x = q.x, y = q.y, z = q.z, w = q.w;
    float x2 = x + x, y2 = y + y, z2 = z + z;
    float xx = x * x2, xy = x * y2, xz = x * z2;
    float yy = y * y2, yz = y * z2, zz = z * z2;
    float wx = w * x2, wy = w * y2, wz = w * z2;
    return mat3(
        1.0 - (yy + zz), xy + wz,         xz - wy,
        xy - wz,         1.0 - (xx + zz), yz + wx,
        xz + wy,         yz - wx,         1.0 - (xx + yy)
    );
}

void main() {
    mat3 iRot = quatToMat3(normalize(iQuat));
    vec3 world = iPos + iRot * (aPosition * iScale);
    gl_Position = uLightVP * vec4(world, 1.0);
}`,
        shadowFS: `#version 300 es
precision highp float;
void main() {}`,

        // ========== SKY (Atmospheric scattering approximation) ==========
        skyVS: `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
uniform mat4 uView;
uniform mat4 uProj;
out vec3 vDir;
void main() {
    mat4 rotView = mat4(mat3(uView));
    vec4 clip = uProj * rotView * vec4(aPosition, 1.0);
    gl_Position = clip.xyww;
    vDir = aPosition;
}`,
        skyFS: `#version 300 es
precision highp float;
in vec3 vDir;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uTurbidity;
out vec4 fragColor;

float hash13(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise2(vec2 x) {
    vec2 i = floor(x), f = fract(x);
    float a = hash13(vec3(i, 0.0));
    float b = hash13(vec3(i + vec2(1.0,0.0), 0.0));
    float c = hash13(vec3(i + vec2(0.0,1.0), 0.0));
    float d = hash13(vec3(i + vec2(1.0,1.0), 0.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbmClouds(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise2(p);
        p = p * 2.02 + vec2(7.0, 3.0);
        a *= 0.55;
    }
    return v;
}

// Simplified Preetham / Hosek-Wilkie inspired sky
vec3 skyColor(vec3 dir, vec3 sunDir) {
    float cosTheta = max(dir.y, 0.0);
    float sunAmount = max(dot(dir, -sunDir), 0.0);
    // Rayleigh
    vec3 rayleigh = vec3(0.3, 0.55, 0.95) * (1.0 - exp(-0.5 / (cosTheta + 0.1)));
    // Mie
    float miePhase = 0.75 * (1.0 + sunAmount * sunAmount);
    vec3 mie = vec3(1.0, 0.9, 0.7) * pow(sunAmount, 8.0 * uTurbidity) * miePhase * 0.4;
    // Horizon glow
    float horizon = exp(-cosTheta * 8.0) * 0.4;
    vec3 horizonCol = vec3(1.0, 0.6, 0.3) * horizon;
    // Night / day blend
    float day = smoothstep(-0.1, 0.15, -sunDir.y);
    vec3 daySky = rayleigh + mie + horizonCol;
    vec3 nightSky = vec3(0.02, 0.03, 0.08) + vec3(0.1, 0.12, 0.2) * pow(sunAmount, 32.0);

    // ---- Moon: opposite side of the sky from the sun, only visible at night ----
    vec3 moonDir = -sunDir;
    float moonAmount = max(dot(dir, -moonDir), 0.0);
    float moonDisk = smoothstep(0.9994, 0.9998, moonAmount) * (1.0 - day);
    float moonGlow = pow(moonAmount, 220.0) * 0.5 * (1.0 - day);
    vec3 moonCol = vec3(0.85, 0.88, 0.95) * (moonDisk * 1.4 + moonGlow);

    // ---- Stars: layered hash field, twinkle, denser away from horizon ----
    float starMask = smoothstep(0.05, 0.4, dir.y);
    vec3 starDir = dir * 220.0;
    float s1 = hash13(floor(starDir));
    float star = step(0.9935, s1) * starMask * (1.0 - day);
    float twinkle = 0.6 + 0.4 * sin(uTime * 3.0 + s1 * 62.0);
    vec3 starCol = vec3(1.0, 0.98, 0.9) * star * twinkle;

    // ---- Drifting clouds mapped onto the upper dome ----
    vec2 cloudUv = dir.xz / max(dir.y + 0.12, 0.08) * 0.06 + vec2(uTime * 0.006, uTime * 0.003);
    float cloudMask = smoothstep(0.15, 0.6, dir.y);
    float cloudN = fbmClouds(cloudUv);
    float clouds = smoothstep(0.52, 0.78, cloudN) * cloudMask * 0.55;
    vec3 cloudLit = mix(vec3(0.55,0.58,0.68), vec3(1.0,0.92,0.82), smoothstep(-0.2,0.3,-sunDir.y));
    vec3 cloudCol = cloudLit * clouds * mix(0.5, 1.0, day);

    vec3 base = mix(nightSky, daySky, day) + starCol + moonCol;
    base = mix(base, cloudLit, clouds * (1.0 - moonDisk));
    return base;
}

void main() {
    vec3 dir = normalize(vDir);
    vec3 col = skyColor(dir, normalize(uSunDir));
    // Tone
    col = col / (col + 1.0);
    col = pow(col, vec3(1.0/2.2));
    fragColor = vec4(col, 1.0);
}`,

        // ========== WATER (Gerstner waves + reflections) ==========
        waterVS: `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec2 aUv;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uTime;
uniform float uWaveScale;
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out float vViewDepth;

// Gerstner wave
vec3 gerstner(vec2 pos, float time, float amp, float wl, float speed, vec2 dir) {
    float k = 6.28318 / wl;
    float c = sqrt(9.8 / k) * speed;
    float f = k * (dot(dir, pos) - c * time);
    float a = amp;
    return vec3(dir.x * a * sin(f), a * cos(f), dir.y * a * sin(f));
}

void main() {
    vec3 pos = aPosition;
    vec2 p = pos.xz;
    vec3 d1 = gerstner(p, uTime, 0.35 * uWaveScale, 14.0, 1.0, normalize(vec2(1.0, 0.3)));
    vec3 d2 = gerstner(p, uTime, 0.22 * uWaveScale, 8.5, 1.1, normalize(vec2(0.7, 1.0)));
    vec3 d3 = gerstner(p, uTime, 0.12 * uWaveScale, 4.2, 1.3, normalize(vec2(-0.5, 0.8)));
    vec3 d4 = gerstner(p, uTime, 0.06 * uWaveScale, 2.1, 1.5, normalize(vec2(0.2, -1.0)));
    pos += d1 + d2 + d3 + d4;

    // Analytic normal approximation
    vec3 n = vec3(0.0, 1.0, 0.0);
    n.x -= d1.x * 0.8 + d2.x * 0.6 + d3.x + d4.x;
    n.z -= d1.z * 0.8 + d2.z * 0.6 + d3.z + d4.z;
    n = normalize(n);

    vec4 world = uModel * vec4(pos, 1.0);
    vWorldPos = world.xyz;
    vNormal = n;
    vUv = aUv * 8.0 + uTime * 0.02;
    vec4 viewPos = uView * world;
    vViewDepth = -viewPos.z;
    gl_Position = uProj * viewPos;
}`,
        waterFS: `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in float vViewDepth;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform sampler2D uNormalMap;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform bool uUseNeuralTonemap;
uniform int uNatureType;
out vec4 fragColor;
${NEURAL_TONEMAP_GLSL}
void main() {
    vec3 N = normalize(vNormal);
    // Detail normals
    vec3 n1 = texture(uNormalMap, vUv).rgb * 2.0 - 1.0;
    vec3 n2 = texture(uNormalMap, vUv * 2.3 - uTime * 0.03).rgb * 2.0 - 1.0;
    N = normalize(N + (n1 + n2) * 0.35);

    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(-uSunDir);
    float NdotV = max(dot(N, V), 0.0);
    float fresnel = pow(1.0 - NdotV, 4.0);

    // Deep / shallow color
    vec3 deep = vec3(0.01, 0.08, 0.15);
    vec3 shallow = vec3(0.05, 0.25, 0.3);
    vec3 waterCol = mix(deep, shallow, NdotV * 0.5 + 0.2);

    // Specular sun
    vec3 H = normalize(V + L);
    float spec = pow(max(dot(N, H), 0.0), 256.0) * 2.5;
    vec3 specular = uSunColor * spec;

    // Reflection approx (sky gradient)
    float skyMix = max(N.y, 0.0);
    vec3 skyRefl = mix(vec3(0.4, 0.55, 0.75), vec3(0.6, 0.75, 0.95), skyMix);
    vec3 col = mix(waterCol, skyRefl, fresnel * 0.85) + specular;

    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vViewDepth * vViewDepth);
    col = mix(col, uFogColor, clamp(fogFactor, 0.0, 0.9));

    col = tonemap(col);
    col = pow(col, vec3(1.0/2.2));
    fragColor = vec4(col, 0.92);
}`,

        // ========== POST PROCESS COMPOSITE ==========
        postVS: `#version 300 es
precision highp float;
layout(location=0) in vec2 aPosition;
layout(location=1) in vec2 aUv;
out vec2 vUv;
void main() {
    vUv = aUv;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}`,
        bloomExtractFS: `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform float uThreshold;
out vec4 fragColor;
void main() {
    vec3 c = texture(uScene, vUv).rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    fragColor = vec4(c * max(lum - uThreshold, 0.0), 1.0);
}`,
        blurFS: `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform vec2 uDirection;
uniform float uRadius;
out vec4 fragColor;
void main() {
    vec2 texel = 1.0 / vec2(textureSize(uTexture, 0));
    vec3 result = texture(uTexture, vUv).rgb * 0.227027;
    result += texture(uTexture, vUv + uDirection * texel * 1.384615 * uRadius).rgb * 0.316216;
    result += texture(uTexture, vUv - uDirection * texel * 1.384615 * uRadius).rgb * 0.316216;
    result += texture(uTexture, vUv + uDirection * texel * 3.230769 * uRadius).rgb * 0.070270;
    result += texture(uTexture, vUv - uDirection * texel * 3.230769 * uRadius).rgb * 0.070270;
    fragColor = vec4(result, 1.0);
}`,
        // ========== SSAO (screen-space ambient occlusion, depth-only) ==========
        // Reconstructs view-space position + normal directly from the depth
        // buffer (via screen-space derivatives) so no separate normal
        // G-buffer pass is needed — keeps this cheap enough for mobile.
        ssaoFS: `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uDepth;
uniform mat4 uInvProj;
uniform mat4 uProj;
uniform vec2 uResolution;
uniform float uRadius;
uniform float uIntensity;
out vec4 fragColor;

vec3 viewPosFromDepth(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = uInvProj * clip;
    return view.xyz / view.w;
}
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
}
void main() {
    float depth = texture(uDepth, vUv).r;
    if (depth >= 0.9999) { fragColor = vec4(1.0); return; }
    vec3 P = viewPosFromDepth(vUv, depth);
    vec3 N = normalize(cross(dFdx(P), dFdy(P)));

    float ang = hash(vUv * uResolution) * 6.2831853;
    vec3 rvec = vec3(cos(ang), sin(ang), 0.0);
    vec3 tangent = normalize(rvec - N * dot(rvec, N));
    vec3 bitangent = cross(N, tangent);
    mat3 TBN = mat3(tangent, bitangent, N);

    float occlusion = 0.0;
    const int SAMPLES = 14;
    for (int i = 0; i < SAMPLES; i++) {
        float fi = float(i) / float(SAMPLES);
        float a = fi * 6.2831853 * 2.4 + ang;
        float r = 0.25 + fi * 0.75;
        vec3 sampleDir = TBN * normalize(vec3(cos(a) * r, sin(a) * r, 0.35 + fi * 0.65));
        vec3 samplePos = P + sampleDir * uRadius;

        vec4 offset = uProj * vec4(samplePos, 1.0);
        offset.xyz /= offset.w;
        vec2 offsetUv = offset.xy * 0.5 + 0.5;
        if (offsetUv.x < 0.0 || offsetUv.x > 1.0 || offsetUv.y < 0.0 || offsetUv.y > 1.0) continue;

        float sampleDepth = texture(uDepth, offsetUv).r;
        if (sampleDepth >= 0.9999) continue;
        vec3 sceneP = viewPosFromDepth(offsetUv, sampleDepth);

        float rangeCheck = smoothstep(0.0, 1.0, uRadius / max(0.0001, abs(P.z - sceneP.z)));
        occlusion += (sceneP.z >= samplePos.z + 0.025 ? 1.0 : 0.0) * rangeCheck;
    }
    float ao = 1.0 - (occlusion / float(SAMPLES)) * uIntensity;
    fragColor = vec4(vec3(clamp(ao, 0.0, 1.0)), 1.0);
}`,

        compositeFS: `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uGodRays;
uniform sampler2D uSSAO;
uniform bool uUseSSAO;
uniform float uSSAOStrength;
uniform float uBloomStrength;
uniform float uGodRayStrength;
uniform float uVignette;
uniform float uTime;
uniform float uSaturation;
uniform vec3 uColorGradeShadow;
uniform vec3 uColorGradeHighlight;
uniform bool uUnderwater;
out vec4 fragColor;
void main() {
    vec3 scene = texture(uScene, vUv).rgb;
    vec3 bloom = texture(uBloom, vUv).rgb;
    vec3 rays = texture(uGodRays, vUv).rgb;

    if (uUseSSAO) {
        float ao = texture(uSSAO, vUv).r;
        scene *= mix(1.0, ao, uSSAOStrength);
    }

    vec3 color = scene + bloom * uBloomStrength + rays * uGodRayStrength;

    // Cinematic color grading: cool shadows, warm highlights (classic teal/orange lite)
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    vec3 graded = mix(color * uColorGradeShadow, color * uColorGradeHighlight, clamp(luma, 0.0, 1.0));
    color = mix(color, graded, 0.35);

    // Saturation
    float g = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(g), color, uSaturation);

    if (uUnderwater) {
        color = mix(color, vec3(0.05, 0.25, 0.35), 0.55);
        color *= 0.8;
    }

    // Vignette
    vec2 uv = vUv * 2.0 - 1.0;
    float vig = 1.0 - dot(uv * 0.5, uv * 0.5) * uVignette;
    color *= clamp(vig, 0.0, 1.0);
    // Mild film grain
    float grain = fract(sin(dot(vUv * uTime, vec2(12.9898, 78.233))) * 43758.5453) * 0.025;
    color += grain;
    fragColor = vec4(color, 1.0);
}`,

        // ========== GOD RAYS (screen-space radial light shafts from the sun) ==========
        godRaysFS: `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uSunScreenPos;
uniform float uSunVisible;
uniform float uExposure;
uniform float uDecay;
uniform float uDensity;
uniform float uWeight;
out vec4 fragColor;
const int SAMPLES = 48;
void main() {
    if (uSunVisible < 0.01) { fragColor = vec4(0.0); return; }
    vec2 deltaUv = (vUv - uSunScreenPos) * (1.0 / float(SAMPLES)) * uDensity;
    vec2 uv = vUv;
    float illum = 1.0;
    vec3 accum = vec3(0.0);
    for (int i = 0; i < SAMPLES; i++) {
        uv -= deltaUv;
        vec3 s = texture(uScene, uv).rgb;
        // Only bright pixels near/around the sun contribute (avoids smearing whole scene)
        float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
        accum += s * illum * smoothstep(0.55, 1.0, lum);
        illum *= uDecay;
    }
    accum *= uExposure * uWeight / float(SAMPLES);
    float edgeFade = 1.0 - smoothstep(0.35, 0.85, length(vUv - uSunScreenPos));
    fragColor = vec4(accum * uSunVisible * edgeFade, 1.0);
}`,

        // ========== TERRAIN ==========
        terrainVS: `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=5) in float aHeight;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uNormalMat;
uniform mat4 uLightVP[4];
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out float vHeight;
out vec4 vShadowCoord[4];
out float vViewDepth;
void main() {
    vec4 world = uModel * vec4(aPosition, 1.0);
    vWorldPos = world.xyz;
    vNormal = normalize((uNormalMat * vec4(aNormal, 0.0)).xyz);
    vUv = aUv;
    vHeight = aHeight;
    for(int i=0;i<4;i++) vShadowCoord[i] = uLightVP[i] * world;
    vec4 viewPos = uView * world;
    vViewDepth = -viewPos.z;
    gl_Position = uProj * viewPos;
}`,
        terrainFS: `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in float vHeight;
in vec4 vShadowCoord[4];
in float vViewDepth;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform sampler2D uGrassMap;
uniform sampler2D uRockMap;
uniform sampler2D uSnowMap;
uniform sampler2D uNormalMap;
uniform sampler2D uShadowMap[4];
uniform float uCascadeSplits[4];
uniform float uExposure;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform bool uUseNeuralTonemap;
uniform int uNatureType;
uniform int uNumPointLights;
uniform vec3 uPointLightPos[8];
uniform vec3 uPointLightColor[8];
uniform float uPointLightIntensity[8];
uniform float uPointLightRadius[8];
uniform float uSnowLine;
uniform float uTreeLine;
out vec4 fragColor;
${NEURAL_TONEMAP_GLSL}
float shadowPCF(sampler2D sm, vec4 sc, float bias) {
    vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
    if(p.z > 1.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;
    float s = 0.0;
    vec2 t = 1.0 / vec2(textureSize(sm, 0));
    for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) {
        float d = texture(sm, p.xy + vec2(x,y)*t).r;
        s += (p.z - bias > d) ? 0.0 : 1.0;
    }
    return s / 9.0;
}

float hashTerrain(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float terrainNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    float a = hashTerrain(i), b = hashTerrain(i+vec2(1,0));
    float c = hashTerrain(i+vec2(0,1)), d = hashTerrain(i+vec2(1,1));
    return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}

void main() {
    float slope = 1.0 - max(vNormal.y, 0.0);
    float h = vHeight;
    // Multi-texture blend
    // Multi-scale detail for richer look without extra tris
    vec3 grass = texture(uGrassMap, vUv * 16.0).rgb * 0.62 + texture(uGrassMap, vUv * 70.0).rgb * 0.38;
    vec3 rock = texture(uRockMap, vUv * 10.0).rgb * 0.62 + texture(uRockMap, vUv * 46.0).rgb * 0.38;
    vec3 snow = texture(uSnowMap, vUv * 5.5).rgb * 1.12;
    float rockW = smoothstep(0.32, 0.68, slope);
    rockW = max(rockW, smoothstep(uTreeLine, uTreeLine + 7.0, h) * 0.75);
    float snowW = smoothstep(uSnowLine, uSnowLine + 9.0, h) * (1.0 - slope * 1.45);
    snowW = clamp(snowW, 0.0, 1.0);
    // Subtle moisture/darker near water level
    float wet = 1.0 - smoothstep(-0.5, 3.5, h);
    vec3 albedo = mix(grass, rock, rockW);
    albedo = mix(albedo, snow, snowW);
    // World-space macro/micro breakup prevents the terrain from becoming a
    // single neon-green sheet when source textures are low-frequency. The
    // two scales are deliberately subtle; lighting remains the dominant cue.
    float macro = terrainNoise(vWorldPos.xz * 0.018);
    float micro = terrainNoise(vWorldPos.xz * 0.16);
    albedo *= 0.78 + macro * 0.28;
    albedo = mix(albedo, albedo * (0.86 + micro * 0.20), 0.34);
    albedo *= mix(1.0, 0.72, wet * 0.55);
    albedo = mix(albedo, albedo * vec3(0.88, 0.92, 1.0), smoothstep(0.58, 0.95, slope));

    vec3 N = normalize(vNormal);
    vec3 nmap = texture(uNormalMap, vUv * 10.0).rgb * 2.0 - 1.0;
    // Cheap TBN from world normal
    vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)));
    if(length(T) < 0.01) T = normalize(cross(N, vec3(1.0, 0.0, 0.0)));
    vec3 B = cross(N, T);
    N = normalize(mat3(T, B, N) * nmap * 0.35 + N * 0.65);

    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(-uSunDir);
    float NdotL = max(dot(N, L), 0.0);
    float shadow = 1.0;
    // Same slope-scaled bias fix as pbrFS's getShadow() — flat terrain
    // bias was nowhere near enough on steep slopes and produced banded
    // shadow-acne stripes (confirmed visually in live testing on a cliff
    // face). See the comment on getShadow() in pbrFS for the full story.
    float bias = mix(0.0032, 0.016, 1.0 - NdotL);
    if(vViewDepth < uCascadeSplits[0]) shadow = shadowPCF(uShadowMap[0], vShadowCoord[0], bias);
    else if(vViewDepth < uCascadeSplits[1]) shadow = shadowPCF(uShadowMap[1], vShadowCoord[1], bias);
    else if(vViewDepth < uCascadeSplits[2]) shadow = shadowPCF(uShadowMap[2], vShadowCoord[2], bias);
    else shadow = shadowPCF(uShadowMap[3], vShadowCoord[3], bias * 2.0);

    vec3 diffuse = albedo * (uAmbientColor + uSunColor * uSunIntensity * NdotL * shadow);
    // Specular for wet/rocky
    vec3 H = normalize(V + L);
    float spec = pow(max(dot(N, H), 0.0), 64.0) * rockW * 0.3 * shadow;
    diffuse += uSunColor * spec;

    // Point lights (fires, orb) — simple Lambert + narrow specular, no shadows
    for (int i = 0; i < 8; i++) {
        if (i >= uNumPointLights) break;
        vec3 toLight = uPointLightPos[i] - vWorldPos;
        float dist = length(toLight);
        vec3 Lp = toLight / max(dist, 0.001);
        float atten = clamp(1.0 - dist / max(uPointLightRadius[i], 0.001), 0.0, 1.0);
        atten *= atten / max(dist * dist * 0.05 + 1.0, 0.001);
        float ndl = max(dot(N, Lp), 0.0);
        vec3 Hp = normalize(V + Lp);
        float sp = pow(max(dot(N, Hp), 0.0), 32.0);
        diffuse += uPointLightColor[i] * uPointLightIntensity[i] * atten * (albedo * ndl + sp * 0.4);
    }

    float fogDist = vViewDepth * uFogDensity;
    float fog = 1.0 - exp(-fogDist * fogDist * 1.1);
    fog = clamp(fog, 0.0, 0.88);
    vec3 atmo = mix(uFogColor, uFogColor * vec3(0.86, 0.93, 1.07), fog * 0.3);
    diffuse = mix(diffuse, atmo, fog);
    diffuse *= uExposure;
    diffuse = tonemap(diffuse);
    diffuse = pow(diffuse, vec3(1.0/2.2));
    fragColor = vec4(diffuse, 1.0);
}`
    };

    global.PriomGL = global.PriomGL || {};
    global.PriomGL.Shaders = Shaders;

})(typeof window !== 'undefined' ? window : globalThis);
