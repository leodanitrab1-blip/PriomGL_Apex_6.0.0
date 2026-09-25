/**
 * PriomGL Kotlin Quality Policy
 * =============================
 * Declarative, null-safe, concise policy layer.
 * En un pipeline real se compilaría a JS (Kotlin/JS) o a native.
 * Aquí documenta la "mente Kotlin" del Council: conservadora en móvil
 * y orientada a frame-rate sobre fidelidad máxima.
 *
 * Sin dependencias externas.
 */
package priom.policy

data class HardwareDNA(
    val tier: String,
    val score: Int,
    val isMobile: Boolean,
    val gpuFamily: String
)

data class QualityVote(
    val quality: Double,
    val entityScale: Double,
    val reason: String
)

object QualityPolicy {
    const val NAME = "QualityPolicy"
    val preferFrameRateOverFidelity: Boolean = true
    val mobileThermalGuard: Boolean = true

    // Mirrored 1:1 in bridge/PolyglotBridge.js as KotlinPolicy.maxCascadesForTier
    // and in python/generate_hw_luts.py's build_payload() max_cascades map — the
    // three copies must stay numerically identical. Python's copy is the one
    // actually loaded at runtime (data/hw_luts.json); this one and the JS
    // mirror are both the offline/fallback source of truth if that fetch fails.
    fun maxCascadesForTier(tier: String): Int = when (tier) {
        "ultra", "high" -> 4
        "medium" -> 3
        "low" -> 2
        else -> 1
    }

    /**
     * Thermal-aware quality decay: given a rolling average of how long the
     * frame budget has been exceeded (seconds, EMA), returns an extra
     * multiplier in [0.55, 1.0]. Mobile GPUs throttle after sustained load;
     * biasing quality down *before* the OS throttles avoids the harsher
     * frame-time cliff a thermal clock-down would otherwise cause.
     */
    fun thermalBias(sustainedOverBudgetSeconds: Double, isMobile: Boolean): Double {
        if (!isMobile || !mobileThermalGuard) return 1.0
        val t = sustainedOverBudgetSeconds.coerceIn(0.0, 12.0) / 12.0
        return 1.0 - t * 0.45
    }

    /**
     * Voto del Council: fusiona propuesta JS + Python y aplica
     * sesgo térmico/móvil.
     */
    fun vote(dna: HardwareDNA, jsVote: Double, pythonVote: Double): QualityVote {
        var fused = (jsVote + pythonVote) * 0.5
        if (dna.isMobile) fused *= 0.88
        if (dna.tier == "potato" || dna.tier == "low") fused *= 0.75
        fused = fused.coerceIn(0.12, 1.2)
        return QualityVote(
            quality = fused,
            entityScale = fused,
            reason = "KT fused js=$jsVote py=$pythonVote → $fused [${dna.tier}]"
        )
    }
}
