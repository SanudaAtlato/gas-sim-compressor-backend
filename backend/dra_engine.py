"""
dra_engine.py  —  Drag Reduction Agent engine for Alaska pipeline.

Sequential concentration model
───────────────────────────────
Oil flows PS1 → PS3 → PS4 → PS5 → HS1 → PS9 → HS2 → Sink.

At each step:
  1. Exponential decay along the pipe reach:  C_out = C_in × exp(−kd × L_km)
  2. At every pump station (PS1, PS3, PS4, PS9):
       a. Mechanical degradation: C_active = C_active × (1 − PUMP_DEGRADATION)
          (15% of DRA is destroyed by pump shear/cavitation)
       b. Fresh injection (if on): C_active += C_injected  → visible spike
  3. Pass-through nodes (PS5, HS1, HS2): no degradation, no injection

This replaces the previous superposition model which:
  - ignored pump degradation
  - produced phantom rises before injection stations due to interpolation

Profile output
──────────────
  compute_full_profile() → list of {km, conc_ppm, dr_percent, event}
  Points are generated at:
    - 0 km (PS1 pre-injection, then post-injection)
    - every ~50 km along each segment (for smooth decay curve)
    - just before and just after each station (to show sharp changes)

  This gives a faithful picture:
    - Exponential decay between stations
    - 15% step-down at every pump station
    - Sharp vertical spike at injection stations

Fitted model  (Rashid 2019, Iraqi crude + PAA, R²=0.9974)
────────────────────────────────────────────────────────────
  DR = (a·C) / (1 + b·C)      a=0.001278  b=0.003847  [C in ppm, DR in fraction]
  f_eff = f_clean × (1 − DR)
  C_active(x) = C_inj × exp(−kd × x)     kd = 0.004 km⁻¹
  Pump mechanical degradation: 15% per pump station traversed
"""

from __future__ import annotations
import json, math, os
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

# ── Model constants ────────────────────────────────────────────────────────────
_A:               float = 0.001278   # rational model parameter a
_B:               float = 0.003847   # rational model parameter b
_KD:              float = 0.004      # degradation rate constant (km⁻¹)
_C_MAX:           float = 250.0      # valid concentration upper limit (ppm)
PUMP_DEGRADATION: float = 0.15       # fraction of DRA destroyed at each pump

# ── Pipeline topology (sequential order) ──────────────────────────────────────
# Each step: (node_name, km_position, is_pump_station, segment_length_km_to_next)
# segment_length_km_to_next = None means this is the terminal node
_PIPELINE: List[Tuple[str, float, bool, Optional[float]]] = [
    ("PS1",   0.0,   True,  132.0),
    ("PS3",   132.0, True,   64.0),
    ("PS4",   196.0, True,   78.0),
    ("PS5",   274.0, False, 200.0),   # relief well — no pump degradation
    ("HS1",   474.0, False, 202.0),   # heater — no pump degradation
    ("PS9",   676.0, True,  300.0),
    ("HS2",   976.0, False, 312.0),   # heater — no pump degradation
    ("Sink", 1288.0, False, None),
]

# Segment name for each reach between consecutive nodes
_SEGMENT_NAMES: List[str] = [
    "PS1_PS3", "PS3_PS4", "PS4_PS5",
    "PS5_HS1", "HS1_PS9", "PS9_HS2", "HS2_Sink",
]

# Which nodes can inject DRA
INJECTION_STATIONS: Dict[str, float] = {
    node: km for node, km, is_pump, _ in _PIPELINE if is_pump and node != "Sink"
}


# ── Core physics ───────────────────────────────────────────────────────────────

def dr_fraction(conc_ppm: float) -> float:
    """DR = (a·C) / (1 + b·C)  [fraction 0–1]"""
    c = max(0.0, min(conc_ppm, _C_MAX))
    if c <= 0:
        return 0.0
    return (_A * c) / (1.0 + _B * c)


def decay(c: float, dist_km: float) -> float:
    """C_out = C_in × exp(−kd × dist_km)"""
    if dist_km <= 0 or c <= 0:
        return max(c, 0.0)
    return c * math.exp(-_KD * dist_km)


def friction_with_dra(f_clean: float, conc_ppm: float) -> float:
    """f_eff = f_clean × (1 − DR)"""
    return f_clean * (1.0 - dr_fraction(conc_ppm))


# ── DRA state ──────────────────────────────────────────────────────────────────

@dataclass
class DRAInjector:
    station_id: str
    km:         float
    on:         bool  = False
    conc_ppm:   float = 0.0


# ── Sequential profile computation ────────────────────────────────────────────

def _compute_sequential(injectors: Dict[str, DRAInjector]) -> List[dict]:
    """
    Walk the pipeline from PS1 to Sink, building concentration profile.

    Returns a list of profile points:
        {km, conc_ppm, dr_percent, event}
    where event is one of:
        ''            — normal pipe point
        'decay_start' — first point of a segment
        'pre_pump'    — just before a pump station
        'post_pump'   — just after pump degradation (before injection)
        'injection'   — after injection added at pump station
    """
    pts: List[dict] = []

    def pt(km: float, c: float, ev: str = '') -> None:
        c = max(c, 0.0)
        pts.append({
            "km"         : round(km, 2),
            "conc_ppm"   : round(c, 3),
            "dr_percent" : round(dr_fraction(c) * 100.0, 3),
            "event"      : ev,
        })

    C = 0.0   # current active concentration (ppm)

    for i, (node, km, is_pump, seg_len) in enumerate(_PIPELINE):
        inj = injectors.get(node)

        if is_pump:
            # --- Step 1: show concentration ARRIVING at pump (before degradation)
            if i > 0:   # not the first node (PS1 has no arriving segment shown yet)
                pt(km - 0.01, C, 'pre_pump')

            # --- Step 2: mechanical degradation at pump
            C = C * (1.0 - PUMP_DEGRADATION)
            pt(km, C, 'post_pump')

            # --- Step 3: fresh injection
            inj_amount = (inj.conc_ppm if (inj and inj.on and inj.conc_ppm > 0) else 0.0)
            if inj_amount > 0:
                C = min(C + inj_amount, _C_MAX)
                pt(km + 0.01, C, 'injection')   # tiny offset so chart draws vertical spike
        else:
            # Pass-through node (PS5, HS1, HS2, Sink)
            if i > 0:
                pt(km, C, 'passthrough')

        # --- Step 4: decay along the next segment
        if seg_len is not None:
            # Sample many points along the segment for a smooth decay curve
            n_samples = max(4, int(seg_len / 40))
            for j in range(1, n_samples + 1):
                frac    = j / n_samples
                d_km    = seg_len * frac
                km_pt   = km + d_km
                C_at_pt = decay(C, d_km)
                pt(km_pt, C_at_pt, 'decay_start' if j == 1 else '')

            # Update C to end-of-segment value
            C = decay(C, seg_len)

    return pts


def _segment_summary(injectors: Dict[str, DRAInjector]) -> Dict[str, dict]:
    """
    Return per-segment concentration/DR summary for broadcast.
    Uses the midpoint concentration from the sequential model.
    """
    profile = _compute_sequential(injectors)

    # Build a midpoint_km → conc lookup from the profile
    midpoints = {
        "PS1_PS3":    66.0,
        "PS3_PS4":   164.0,
        "PS4_PS5":   235.0,
        "PS5_HS1":   374.0,
        "HS1_PS9":   575.0,
        "PS9_HS2":   826.0,
        "HS2_Sink": 1132.0,
    }

    result = {}
    for seg_name, mid_km in midpoints.items():
        # Find the profile point closest to the midpoint km
        closest = min(profile, key=lambda p: abs(p["km"] - mid_km), default=None)
        if closest:
            c = closest["conc_ppm"]
            result[seg_name] = {
                "active_conc_ppm": round(c, 2),
                "dr_percent"     : round(dr_fraction(c) * 100.0, 2),
                "f_factor"       : round(1.0 - dr_fraction(c), 5),
            }
        else:
            result[seg_name] = {"active_conc_ppm": 0.0, "dr_percent": 0.0, "f_factor": 1.0}

    return result


# ── DRA Engine ─────────────────────────────────────────────────────────────────

class DRAEngine:
    """
    Manages per-pump DRA injection and computes friction factors for MOC.
    """

    def __init__(self) -> None:
        self._injectors: Dict[str, DRAInjector] = {
            sid: DRAInjector(station_id=sid, km=km)
            for sid, km in INJECTION_STATIONS.items()
        }
        self._any_active: bool = False

    # ── Controls ──────────────────────────────────────────────────────────────

    def set_injection(self, station_id: str,
                      on: bool = None, conc_ppm: float = None) -> dict:
        if station_id not in self._injectors:
            return {"error": f"Unknown station '{station_id}'. "
                             f"Available: {list(self._injectors.keys())}"}
        inj = self._injectors[station_id]
        if on is not None:
            inj.on = bool(on)
        if conc_ppm is not None:
            inj.conc_ppm = max(0.0, min(float(conc_ppm), _C_MAX))
        self._update_any_active()
        return self.get_state()

    def clear_all(self) -> None:
        for inj in self._injectors.values():
            inj.on = False
            inj.conc_ppm = 0.0
        self._any_active = False

    def _update_any_active(self) -> None:
        self._any_active = any(
            i.on and i.conc_ppm > 0 for i in self._injectors.values()
        )

    @property
    def any_active(self) -> bool:
        return self._any_active

    # ── State ─────────────────────────────────────────────────────────────────

    def get_state(self) -> dict:
        return {
            sid: {
                "on"             : inj.on,
                "conc_ppm"       : round(inj.conc_ppm, 1),
                "km"             : inj.km,
                "dr_at_injection": round(dr_fraction(inj.conc_ppm) * 100, 2)
                                   if inj.on else 0.0,
            }
            for sid, inj in self._injectors.items()
        }

    # ── Physics ───────────────────────────────────────────────────────────────

    def compute_full_profile(self) -> List[dict]:
        """
        Full concentration profile for the distance chart.
        Points are at injection stations, pump stations, and every ~40km
        between stations so the exponential decay is rendered accurately.
        """
        return _compute_sequential(self._injectors)

    def segment_dra_profile(self) -> Dict[str, dict]:
        """Per-segment summary for broadcast and MOC friction update."""
        return _segment_summary(self._injectors)

    def compute_effective_friction(
        self, f_clean_map: Dict[str, float]
    ) -> Dict[str, Tuple[float, float, float]]:
        """
        Returns {seg_name: (f_effective, conc_ppm, dr_fraction)}
        using the sequential model midpoint concentrations.
        """
        summary = self.segment_dra_profile()
        result  = {}
        for seg_name, f_clean in f_clean_map.items():
            s   = summary.get(seg_name, {})
            c   = s.get("active_conc_ppm", 0.0)
            dr  = dr_fraction(c)
            f_e = f_clean * (1.0 - dr)
            result[seg_name] = (f_e, c, dr)
        return result


# ── Dataset info ───────────────────────────────────────────────────────────────

def get_dra_dataset_info() -> dict:
    json_path = os.path.join(os.path.dirname(__file__),
                             "iraqi_crude_paa_rashid_2019.json")
    try:
        with open(json_path) as f:
            ds = json.load(f)
        return {
            "fluid"              : ds["fluid"]["name"],
            "dra_type"           : ds["dra"]["name"],
            "dra_abbreviation"   : ds["dra"]["abbreviation"],
            "max_conc_ppm"       : ds["valid_range"]["concentration_ppm_max"],
            "max_dr_percent"     : 16.0,
            "fitted_a"           : round(_A, 6),
            "fitted_b"           : round(_B, 6),
            "kd_per_km"          : _KD,
            "pump_degradation_pct": PUMP_DEGRADATION * 100,
            "model_equation"     : "DR = (a·C) / (1 + b·C)",
            "degradation_eq"     : "C_active(x) = C_inj × exp(−kd × x)",
            "pump_loss_eq"       : f"C_pump_out = C_pump_in × {1-PUMP_DEGRADATION}",
            "source"             : ds["source_reference"]["title"],
            "year"               : ds["source_reference"]["year"],
            "r2_rational"        : 0.9974,
            "warning"            : ds["degradation_model"]["warning"],
        }
    except Exception:
        return {"error": "Dataset file not found"}