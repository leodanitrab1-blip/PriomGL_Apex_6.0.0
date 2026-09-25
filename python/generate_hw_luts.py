#!/usr/bin/env python3
"""
PriomGL Python Tool — Generador de LUTs y reglas de hardware
=============================================================
Puro Python 3 stdlib. Sin dependencias externas.

Genera tablas de decisión que el PolyglotBridge embebe.
La "mente Python" del motor: conservadora, basada en datos,
excelente para reglas declarativas y pre-cómputo.

Uso:
  python3 generate_hw_luts.py          # imprime JSON
  python3 generate_hw_luts.py --embed  # genera snippet JS listo
"""

from __future__ import annotations
import json
import argparse
import math
from pathlib import Path

TIERS = ("potato", "low", "medium", "high", "ultra")

def tier_budget() -> dict:
    """Multiplicadores de presupuesto por tier."""
    return {
        "ultra":  {"entities": 1.15, "shadows": 1.20, "post": 1.15, "pixels": 1.00},
        "high":   {"entities": 1.00, "shadows": 1.00, "post": 1.00, "pixels": 0.95},
        "medium": {"entities": 0.72, "shadows": 0.70, "post": 0.65, "pixels": 0.85},
        "low":    {"entities": 0.42, "shadows": 0.40, "post": 0.35, "pixels": 0.70},
        "potato": {"entities": 0.20, "shadows": 0.15, "post": 0.15, "pixels": 0.50},
    }

def aggressiveness_curve() -> list[dict]:
    """Curva score → agresividad del optimizer (más alto = degrada más fuerte)."""
    points = []
    for score in range(0, 101, 5):
        if score < 25:
            a = 1.6
        elif score < 40:
            a = 1.3
        elif score < 55:
            a = 1.0
        elif score < 70:
            a = 0.75
        else:
            a = 0.55
        # Suavizado ligero
        a = round(a * (1.0 - 0.05 * math.sin(score * 0.1)), 3)
        points.append({"score": score, "aggressiveness": a})
    return points

def tree_budget_table(mobile: bool) -> list[dict]:
    """Presupuesto de árboles según score (para validar el profiler)."""
    rows = []
    for score in range(0, 101, 10):
        if mobile:
            if score > 50:
                n = 480
            elif score > 30:
                n = 280
            else:
                n = 140
        else:
            if score > 65:
                n = 1600
            elif score > 45:
                n = 900
            else:
                n = 450
        rows.append({"score": score, "trees": n, "mobile": mobile})
    return rows

def shadow_cascade_splits(tier_max_cascades: dict) -> dict:
    """Practical-split cascade shadow-map ratios (log/uniform blend) per tier.

    Standard CSM practical split formula: mix of logarithmic and uniform
    partitioning (lambda=0.5) across [near, far] for N cascades. Computed
    once in Python instead of duplicated ad-hoc in the renderer.
    """
    near, far, lam = 0.5, 220.0, 0.6
    out = {}
    for tier, n in tier_max_cascades.items():
        splits = []
        for i in range(1, n + 1):
            p = i / n
            log_split = near * (far / near) ** p
            uni_split = near + (far - near) * p
            splits.append(round(lam * log_split + (1 - lam) * uni_split, 2))
        out[tier] = splits
    return out


def wind_gust_curve(samples: int = 64) -> list[float]:
    """Procedural gust envelope: sum of a few incommensurate sine waves,
    normalized to [0.4, 1.0]. Sampled by JS as a lookup table so wind
    "breathes" without per-frame trig on every vertex/CPU tick.
    """
    raw = []
    for i in range(samples):
        t = (i / samples) * 2 * math.pi
        v = (
            0.55 * math.sin(t)
            + 0.30 * math.sin(t * 2.7 + 1.3)
            + 0.15 * math.sin(t * 5.1 + 0.4)
        )
        raw.append(v)
    lo, hi = min(raw), max(raw)
    return [round(0.4 + 0.6 * (v - lo) / (hi - lo), 4) for v in raw]


def lod_distance_table() -> dict:
    """Distance bands (meters) at which instanced vegetation drops detail,
    scaled per tier so weaker GPUs cull sooner."""
    base = [30, 80, 180]
    scale = {"ultra": 1.35, "high": 1.0, "medium": 0.72, "low": 0.5, "potato": 0.32}
    return {tier: [round(d * s, 1) for d in base] for tier, s in scale.items()}


def build_payload() -> dict:
    max_cascades = {"ultra": 4, "high": 4, "medium": 3, "low": 2, "potato": 1}
    return {
        "version": 5,
        "generator": "PriomGL Python LUT Forge",
        "tier_budget": tier_budget(),
        "aggressiveness_curve": aggressiveness_curve(),
        "tree_budget_mobile": tree_budget_table(True),
        "tree_budget_desktop": tree_budget_table(False),
        "max_cascades_by_tier": max_cascades,
        "shadow_cascade_splits": shadow_cascade_splits(max_cascades),
        "wind_gust_curve": wind_gust_curve(),
        "lod_distance_by_tier": lod_distance_table(),
        "notes": (
            "Estas tablas son la contribución de Python al Council. "
            "JS aporta reactividad en tiempo real; C++ aporta kernels; "
            "Kotlin aporta política declarativa; Python aporta reglas pre-computadas."
        ),
    }

def main() -> None:
    parser = argparse.ArgumentParser(description="PriomGL Hardware LUT generator")
    parser.add_argument("--embed", action="store_true", help="Emit JS snippet")
    parser.add_argument("-o", "--output", type=str, default="", help="Write JSON file")
    args = parser.parse_args()

    data = build_payload()

    if args.output:
        Path(args.output).write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(f"Wrote {args.output}")
    elif args.embed:
        print("// Auto-generated by python/generate_hw_luts.py — do not edit by hand")
        print("const PYTHON_LUTS = " + json.dumps(data, separators=(",", ":")) + ";")
    else:
        print(json.dumps(data, indent=2))

if __name__ == "__main__":
    main()
