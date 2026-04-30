"""api/routes.py — REST API for Alaska pipeline transient simulation."""

from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter(prefix="/simulation", tags=["simulation"])

class PumpRequest(BaseModel):
    pump_name: str

class LeakRequest(BaseModel):
    node: str;  flow_kg_s: float = Field(..., gt=0)

class LocationLeakRequest(BaseModel):
    location_km: float = Field(..., ge=0, le=1288, description="Leak position measured from PS1 inlet, km")
    flow_kg_s: float = Field(..., gt=0, le=2000, description="Injected leak flow, kg/s")

class RemoveLeakRequest(BaseModel):
    node: str

class RemoveLeakByIdRequest(BaseModel):
    leak_id: str

class HeaterRequest(BaseModel):
    heater_id:  str   = Field(..., description="'HS1' or 'HS2'")
    target_c:   Optional[float] = Field(None, ge=10, le=100, description="Target temperature °C")
    max_mw:     Optional[float] = Field(None, gt=0, le=100,  description="Max heater power MW")
    on:         Optional[bool]  = Field(None, description="True=on, False=off")

class AmbientTempRequest(BaseModel):
    temperature_c: float = Field(..., ge=-30, le=30)

class InletTempRequest(BaseModel):
    temperature_c: float = Field(..., ge=10, le=80)

def _svc():
    from simulation_service import get_service
    try: return get_service("alaska")
    except RuntimeError as e: raise HTTPException(503, str(e))

# ── Simulation lifecycle ──────────────────────────────────────────────────────

@router.post("/start")
def start():
    svc = _svc()
    if svc.running: return {"status": "already_running"}
    svc.start(); return {"status": "started"}

@router.post("/stop")
def stop():
    svc = _svc()
    if not svc.running: return {"status": "not_running"}
    svc.stop(); return {"status": "stopped"}

@router.get("/status")
def status():
    svc = _svc(); s = svc.get_status(); latest = svc.get_latest()
    if latest:
        s["snapshot"] = {k: latest[k] for k in [
            "simulated_time_s","junction_names","pipe_names","calc_pressure","calc_flows",
            "nodes","pipes","pump_states","heater_states","temperature_profile",
            "node_temperatures","ambient_temp_c","inlet_temp_c","active_leaks","leak_detection","p_min_bar","p_max_bar"
        ] if k in latest}
    else: s["snapshot"] = None
    return s

@router.get("/latest")
def latest():
    l = _svc().get_latest()
    if l is None: raise HTTPException(404, "No data yet.")
    return l

@router.get("/history")
def history(n: int = 100):
    return _svc().history[-n:]

# ── Pump control ──────────────────────────────────────────────────────────────

@router.post("/pump/start")
def pump_start(req: PumpRequest):
    svc = _svc(); msg = svc.pump_start(req.pump_name)
    return {"status": "ok", "message": msg, "pump_states": svc.get_pump_states()}

@router.post("/pump/stop")
def pump_stop(req: PumpRequest):
    svc = _svc(); msg = svc.pump_stop(req.pump_name)
    return {"status": "ok", "message": msg, "pump_states": svc.get_pump_states()}

@router.get("/pump/states")
def pump_states():
    svc = _svc()
    return {"pump_states": svc.get_pump_states(), "controllable_pumps": svc.info["pump_stations"] if svc.info else []}

# ── Heater control ────────────────────────────────────────────────────────────

@router.post("/heater/set")
def set_heater(req: HeaterRequest):
    """
    Control a heating station.
    - target_c   : desired outlet temperature (°C)
    - max_mw     : maximum heat output (MW)
    - on         : True = heater active, False = heater bypassed
    The thermal model updates from the next broadcast step onward.
    """
    svc = _svc()
    result = svc.set_heater(req.heater_id, req.target_c, req.max_mw, req.on)
    if "error" in result: raise HTTPException(400, result["error"])
    return result

@router.get("/heater/states")
def heater_states():
    """Return current config and live output for both heating stations."""
    return {"heater_states": _svc().get_heater_states()}

# ── Ambient / inlet temperature ───────────────────────────────────────────────

@router.post("/ambient/set")
def set_ambient(req: AmbientTempRequest):
    """Set ground/ambient temperature (°C). Affects pipe heat loss rate."""
    msg = _svc().set_ambient_temp(req.temperature_c)
    return {"status": "ok", "message": msg}

@router.post("/inlet/set")
def set_inlet(req: InletTempRequest):
    """Set crude oil temperature at PS1 inlet (°C)."""
    msg = _svc().set_inlet_temp(req.temperature_c)
    return {"status": "ok", "message": msg}

# ── Leak control ──────────────────────────────────────────────────────────────

@router.post("/leak/add")
def add_leak(req: LeakRequest):
    """Legacy/node leak injection: inject a leak exactly at an existing station node."""
    svc = _svc(); msg = svc.add_leak(req.node, req.flow_kg_s)
    return {"status": "ok", "message": msg, "leaks": svc.get_leaks()}

@router.post("/leak/add-location")
def add_location_leak(req: LocationLeakRequest):
    """Manual leak injection at any mainline km location. The solver snaps to nearest MOC grid cell."""
    svc = _svc()
    result = svc.add_leak_at_km(req.location_km, req.flow_kg_s)
    if result.get("status") == "error":
        raise HTTPException(400, result.get("message", "Could not inject leak"))
    result["leaks"] = svc.get_leaks()
    return result

@router.post("/leak/remove")
def remove_leak(req: RemoveLeakRequest):
    svc = _svc(); msg = svc.remove_leak(req.node)
    return {"status": "ok", "message": msg, "leaks": svc.get_leaks()}

@router.post("/leak/remove-id")
def remove_leak_id(req: RemoveLeakByIdRequest):
    svc = _svc(); msg = svc.remove_leak_by_id(req.leak_id)
    return {"status": "ok", "message": msg, "leaks": svc.get_leaks()}

@router.post("/leak/clear")
def clear_leaks():
    svc = _svc(); msg = svc.clear_leaks()
    return {"status": "ok", "message": msg, "leaks": svc.get_leaks()}

@router.get("/leaks")
def leaks(): return {"active_leaks": _svc().get_leaks()}

@router.get("/leak-detection")
def leak_detection_status():
    """Return latest EWMA/CUSUM/negative-pressure-wave leak detection status."""
    return _svc().get_leak_detection_status()



# ── DRA control ───────────────────────────────────────────────────────────────

class DRARequest(BaseModel):
    station_id: str = Field(..., description="'PS1', 'PS3', 'PS4', or 'PS9'")
    on:         Optional[bool]  = Field(None, description="True=injecting, False=stopped")
    conc_ppm:   Optional[float] = Field(None, ge=0, le=250, description="Injection concentration 0–250 ppm")

@router.post("/dra/set")
def set_dra(req: DRARequest):
    """
    Set DRA injection at a pump station.

    Physics: DR = (a·C) / (1 + b·C)  using Rashid 2019 Iraqi crude + PAA data.
    a = 0.001278,  b = 0.003847,  max DR = 33.2% (asymptotic),  R² = 0.9974.
    Degradation: C_active(x) = C_inj × exp(−kd × x),  kd = 0.004 km⁻¹.
    Effect on friction: f_effective = f_thermal × (1 − DR).
    """
    svc = _svc()
    result = svc.set_dra(req.station_id, req.on, req.conc_ppm)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result

@router.post("/dra/clear")
def clear_dra():
    """Stop all DRA injections immediately."""
    return {"status": "ok", "message": _svc().clear_all_dra()}

@router.get("/dra/states")
def dra_states():
    """Return current injector states and per-segment DRA profile."""
    return _svc().get_dra_states()

@router.get("/dra/info")
def dra_info():
    """Return DRA dataset metadata (Rashid 2019, Iraqi crude PAA)."""
    from dra_engine import get_dra_dataset_info
    return get_dra_dataset_info()



# ── Pause / resume ────────────────────────────────────────────────────────────

@router.post("/pause")
def pause_simulation():
    """Freeze simulation at current state. Resume continues from exactly here."""
    svc = _svc()
    if not svc.running:
        raise HTTPException(400, "Simulation is not running")
    msg = svc.pause()
    return {"status": "paused", "message": msg}

@router.post("/resume")
def resume_simulation():
    """Resume a paused simulation from its current state."""
    svc = _svc()
    if not svc.running:
        raise HTTPException(400, "Simulation is not running")
    msg = svc.resume()
    return {"status": "running", "message": msg}

# ── Safety interlock ──────────────────────────────────────────────────────────

class InterlockRequest(BaseModel):
    enabled: bool = Field(..., description="True = auto-trip upstream pump when valve closes")

@router.post("/interlock/set")
def set_interlock(req: InterlockRequest):
    """
    Enable or disable the safety interlock.
    When enabled: closing a valve automatically trips the upstream pump station.
    When disabled: valve closes but pump keeps running (for water-hammer study).
    """
    svc = _svc()
    msg = svc.set_interlock(req.enabled)
    return {"status": "ok", "message": msg, "safety_interlock": svc.get_interlock()}

@router.get("/interlock")
def get_interlock():
    return {"safety_interlock": _svc().get_interlock()}

# ── Valve control ─────────────────────────────────────────────────────────────

class ValveRequest(BaseModel):
    valve_name:  str   = Field(..., description="'V_PS3', 'V_PS4', or 'V_PS9'")
    duration_s:  Optional[float] = Field(None, gt=0, le=600,
                     description="Closure/opening duration in seconds (default 60 s close, 90 s open)")

@router.post("/valve/close")
def close_valve(req: ValveRequest):
    """
    Start closing a valve upstream of the named pump station.

    The valve closing fraction tau decreases linearly from 1→0 over duration_s.
    The MOC solver applies the valve BC at every time step, generating a
    realistic water hammer pressure wave that travels at a=1200 m/s.

    Valves available: V_PS3 (before PS3), V_PS4 (before PS4), V_PS9 (before PS9)
    Default closure time: 60 seconds (realistic for a large pipeline ball valve)
    """
    svc = _svc()
    msg = svc.close_valve(req.valve_name, req.duration_s)
    if msg.startswith("❌"):
        raise HTTPException(400, msg)
    return {"status": "ok", "message": msg, "valve_states": svc.get_valve_states()}

@router.post("/valve/open")
def open_valve(req: ValveRequest):
    """Start opening a valve upstream of the named pump station."""
    svc = _svc()
    msg = svc.open_valve(req.valve_name, req.duration_s)
    if msg.startswith("❌"):
        raise HTTPException(400, msg)
    return {"status": "ok", "message": msg, "valve_states": svc.get_valve_states()}

@router.get("/valve/states")
def valve_states():
    """Return current tau, state, and percent-open for all three valves."""
    return {"valve_states": _svc().get_valve_states()}

# ── Network info ──────────────────────────────────────────────────────────────

@router.get("/nodes")
def nodes():
    svc = _svc()
    if not svc.info: raise HTTPException(503, "Not initialised.")
    return {k: svc.info[k] for k in [
        "junction_names","pipe_names","pump_stations","relief_wells",
        "heating_stations","sink_nodes","pipe_segments",
        "H_min_bar","H_max_bar","node_km"
    ] if k in svc.info}