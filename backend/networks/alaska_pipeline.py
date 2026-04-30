"""
networks/alaska_pipeline.py — Alaska pipeline with two heating stations.

Topology
────────
  PS1 -[132km]-> PS3 -[64km]-> PS4 -[78km]-> PS5
     -[200km]-> HS1 -[202km]-> PS9
     -[300km]-> HS2 -[312km]-> Sink

  PS1, PS3, PS4, PS9 — pump stations
  PS5                 — relief well (pass-through, pressure cap)
  HS1                 — heating station at 474 km (mid-point PS5→PS9)
  HS2                 — heating station at 976 km (mid-point PS9→Sink)

Pipe segments (7 total, all divide by Δx=2000m):
  0: PS1_PS3  132 km  N=66
  1: PS3_PS4   64 km  N=32
  2: PS4_PS5   78 km  N=39
  3: PS5_HS1  200 km  N=100
  4: HS1_PS9  202 km  N=101
  5: PS9_HS2  300 km  N=150
  6: HS2_Sink 312 km  N=156

Thermal design (U=0.5 W/m²K, T_amb=-5°C, mdot=800 kg/s, cp=2100 J/kgK):
  PS1=55°C → PS3=46.6°C → PS4=43.0°C → PS5=38.9°C
  → HS1_in=30.0°C → HS1_out=40.0°C (16.9 MW / 20 MW max)
  → PS9=30.7°C
  → HS2_in=20.4°C → HS2_out=35.0°C (24.5 MW / 25 MW max)
  → Sink=23.0°C
"""

from __future__ import annotations
import math
from typing import Dict, List, Tuple

D         = 1.2192
RHO       = 860.0
WAVE_SPD  = 1200.0
F         = 0.01
G         = 9.81
DX        = 2_000.0
RAMP_TIME = 300.0
AREA      = math.pi * (D / 2) ** 2

H_BAR    = RHO * G / 1e5
H_50_BAR = 50.0 / H_BAR
H_80_BAR = 80.0 / H_BAR

# ── Node map:  name → (pipe_index, node_index) ──────────────────────────────
NODE_MAP: Dict[str, Tuple[int, int]] = {
    "PS1":  (0,   0),   # inlet pump outlet
    "PS3":  (1,   0),   # junction pump outlet
    "PS4":  (2,   0),   # junction pump outlet
    "PS5":  (3,   0),   # relief well
    "HS1":  (4,   0),   # heating station 1
    "PS9":  (5,   0),   # junction pump outlet
    "HS2":  (6,   0),   # heating station 2
    "Sink": (6, 156),   # delivery terminal (312km / 2km = 156)
}

KEY_NODES:  List[str] = ["PS1", "PS3", "PS4", "PS5", "HS1", "PS9", "HS2", "Sink"]
PIPE_NAMES: List[str] = ["PS1_PS3", "PS3_PS4", "PS4_PS5", "PS5_HS1", "HS1_PS9", "PS9_HS2", "HS2_Sink"]

# Km position of each key node from PS1
NODE_KM: Dict[str, float] = {
    "PS1": 0, "PS3": 132, "PS4": 196, "PS5": 274,
    "HS1": 474, "PS9": 676, "HS2": 976, "Sink": 1288,
}

# Default heater configs (from heater_catalog.json + physics calibration)
DEFAULT_HEATERS: Dict[str, dict] = {
    "HS1": {
        "id"           : "HS1",
        "catalog_ref"  : "HS_MP238_STANDARD",
        "target_c"     : 40.0,
        "max_mw"       : 20.0,
        "efficiency"   : 0.85,
        "on"           : True,
        "km"           : 474,
        "description"  : "Mid-route heater — PS5 to PS9",
    },
    "HS2": {
        "id"           : "HS2",
        "catalog_ref"  : "HS_PS8_REHEAT",
        "target_c"     : 35.0,
        "max_mw"       : 25.0,
        "efficiency"   : 0.85,
        "on"           : True,
        "km"           : 976,
        "description"  : "Pre-delivery reheat — PS9 to Sink",
    },
}

# Thermal model defaults
THERMAL_DEFAULTS = {
    "inlet_temp_c"  : 55.0,     # crude oil temp entering PS1
    "ambient_temp_c": -5.0,     # Alaska ground temperature
    "U_W_m2K"       : 0.5,      # overall heat transfer coefficient (insulated buried pipe)
    "cp_J_kgK"      : 2100.0,   # crude oil specific heat
    "roughness_m"   : 4.6e-5,   # commercial steel
    # Andrade viscosity model (mu_ref calibrated for TAPS API 33.4 crude)
    "mu_ref_Pa_s"   : 0.02,
    "T_ref_K"       : 293.15,
    "B_K"           : 1800.0,
}


def build_alaska_network() -> Tuple[dict, dict]:
    moc_config = {
        "dx"              : DX,
        "diameter_m"      : D,
        "wave_speed"      : WAVE_SPD,
        "friction_factor" : F,
        "density"         : RHO,
        "g"               : G,
        "H_initial"       : H_50_BAR,
        "V_initial"       : 0.0,
        "H_source"        : H_50_BAR,
        "H_sink"          : H_50_BAR,

        "segments": [
            {"name": "PS1_PS3",  "length_m": 132_000},
            {"name": "PS3_PS4",  "length_m":  64_000},
            {"name": "PS4_PS5",  "length_m":  78_000},
            {"name": "PS5_HS1",  "length_m": 200_000},
            {"name": "HS1_PS9",  "length_m": 202_000},
            {"name": "PS9_HS2",  "length_m": 300_000},
            {"name": "HS2_Sink", "length_m": 312_000},
        ],

        "inlet_pump": "PS1",

        "junction_pumps": {
            "PS3": {"pipe_up_idx": 0, "pipe_dn_idx": 1},
            "PS4": {"pipe_up_idx": 1, "pipe_dn_idx": 2},
            "PS9": {"pipe_up_idx": 4, "pipe_dn_idx": 5},
        },

        # HS1 and HS2 are hydraulically pass-through (thermal handled separately)
        "passthrough_junctions": {
            "PS5": {"pipe_up_idx": 2, "pipe_dn_idx": 3, "H_relief": H_80_BAR},
            "HS1": {"pipe_up_idx": 3, "pipe_dn_idx": 4},
            "HS2": {"pipe_up_idx": 5, "pipe_dn_idx": 6},
        },

        "pump_stations": {
            "PS1": {"H0": 400.0, "K":  69.1, "ramp_time": RAMP_TIME},
            "PS3": {"H0":  50.0, "K":  23.0, "ramp_time": RAMP_TIME},
            "PS4": {"H0":  30.0, "K":  20.2, "ramp_time": RAMP_TIME},
            "PS9": {"H0": 180.0, "K":  80.8, "ramp_time": RAMP_TIME},
        },
    }

    info = {
        "pipeline_id"       : "alaska",
        "junction_names"    : KEY_NODES,
        "pipe_names"        : PIPE_NAMES,
        "pump_stations"     : ["PS1", "PS3", "PS4", "PS9"],
        "relief_wells"      : ["PS5"],
        "heating_stations"  : ["HS1", "HS2"],
        "sink_nodes"        : ["Sink"],
        "node_map"          : NODE_MAP,
        "node_km"           : NODE_KM,
        "density"           : RHO,
        "g"                 : G,
        "diameter_m"        : D,
        "area_m2"           : AREA,
        "wave_speed"        : WAVE_SPD,
        "dx"                : DX,
        "dt"                : DX / WAVE_SPD,
        "H_min_bar"         : 50.0,
        "H_max_bar"         : 80.0,
        "default_heaters"   : DEFAULT_HEATERS,
        "thermal_defaults"  : THERMAL_DEFAULTS,
        "pipe_segments": [
            {"name": "PS1_PS3",  "from": "PS1", "to": "PS3",  "length_km": 132},
            {"name": "PS3_PS4",  "from": "PS3", "to": "PS4",  "length_km":  64},
            {"name": "PS4_PS5",  "from": "PS4", "to": "PS5",  "length_km":  78},
            {"name": "PS5_HS1",  "from": "PS5", "to": "HS1",  "length_km": 200},
            {"name": "HS1_PS9",  "from": "HS1", "to": "PS9",  "length_km": 202},
            {"name": "PS9_HS2",  "from": "PS9", "to": "HS2",  "length_km": 300},
            {"name": "HS2_Sink", "from": "HS2", "to": "Sink", "length_km": 312},
        ],
    }

    return moc_config, info