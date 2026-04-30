"""
moc_solver.py  —  Method of Characteristics solver for 1-D transient pipe networks.

Governing equations (H = piezometric head m,  V = velocity m/s):
    Continuity : ∂H/∂t + (a²/g)·∂V/∂x = 0
    Momentum   : ∂V/∂t + g·∂H/∂x + f|V|V/(2D) = 0

MOC characteristic forms:
    C+: CP = H[i-1] + ag·V[i-1] − R·|V[i-1]|·V[i-1]
    C-: CM = H[i+1] − ag·V[i+1] + R·|V[i+1]|·V[i+1]
    Interior: V = (CP-CM)/(2·ag),  H = CP − ag·V
    R = f·Δx / (2·g·D)         ← temperature-dependent via f and density
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class PipeSegment:
    name:            str
    length_m:        float
    diameter_m:      float
    wave_speed:      float
    friction_factor: float
    density:         float
    g:               float = 9.81

    area_m2:  float = field(init=False, default=0.0)
    N:        int   = field(init=False, default=0)
    dx:       float = field(init=False, default=0.0)
    dt:       float = field(init=False, default=0.0)
    R:        float = field(init=False, default=0.0)
    H:        object = field(init=False, default=None)
    V:        object = field(init=False, default=None)
    H_new:    object = field(init=False, default=None)
    V_new:    object = field(init=False, default=None)

    # Temperature tracking
    temperature_c: float = field(init=False, default=29.0)

    def setup(self, dx: float) -> None:
        import numpy as np
        N = round(self.length_m / dx)
        if abs(N * dx - self.length_m) > 1.0:
            raise ValueError(f"Pipe '{self.name}': dx={dx:.0f} does not divide length={self.length_m:.0f}")
        self.area_m2 = math.pi * (self.diameter_m / 2) ** 2
        self.N  = N
        self.dx = dx
        self.dt = dx / self.wave_speed
        self.R  = self.friction_factor * dx / (2.0 * self.g * self.diameter_m)
        n = N + 1
        self.H     = np.zeros(n)
        self.V     = np.zeros(n)
        self.H_new = np.zeros(n)
        self.V_new = np.zeros(n)

    def update_properties(self, friction_factor: float, density: float) -> None:
        """
        Hot-update friction factor and density when pipe temperature changes.
        Recomputes R = f·dx/(2gD) using the new friction factor.
        Wave speed is kept constant (temperature effect on a is small ~1-2%).
        """
        self.friction_factor = friction_factor
        self.density         = density
        self.R               = friction_factor * self.dx / (2.0 * self.g * self.diameter_m)

    @property
    def ag(self) -> float:
        return self.wave_speed / self.g

    def set_ic(self, H0: float, V0: float) -> None:
        self.H[:] = H0;  self.V[:] = V0
        self.H_new[:] = H0;  self.V_new[:] = V0

    def CP_at_right(self) -> float:
        i = self.N - 1
        return self.H[i] + self.ag*self.V[i] - self.R*abs(self.V[i])*self.V[i]

    def CM_at_left(self) -> float:
        return self.H[1] - self.ag*self.V[1] + self.R*abs(self.V[1])*self.V[1]

    def solve_interior(self) -> None:
        ag = self.ag;  R = self.R
        for i in range(1, self.N):
            CP = self.H[i-1] + ag*self.V[i-1] - R*abs(self.V[i-1])*self.V[i-1]
            CM = self.H[i+1] - ag*self.V[i+1] + R*abs(self.V[i+1])*self.V[i+1]
            self.V_new[i] = (CP - CM) / (2.0 * ag)
            self.H_new[i] = CP - ag * self.V_new[i]

    def commit(self) -> None:
        self.H[:] = self.H_new;  self.V[:] = self.V_new

    def pressure_bar(self, node: int) -> float:
        return float(self.H[node]) * self.density * self.g / 1e5

    def flow_m3s(self, node: int = 0) -> float:
        return float(self.V[node]) * self.area_m2


class MOCSolver:
    """
    1-D transient pipe network solver — Method of Characteristics.

    Supports hot-update of per-pipe friction factor and density when
    pipe temperatures are changed by the user at runtime.
    """

    def __init__(self, config: dict) -> None:
        self.config = config
        self.pipes:  List[PipeSegment] = []
        self.t:      float = 0.0
        self.dt:     float = 0.0
        self._pump_start: Dict[str, float] = {}
        self._pump_on:    Dict[str, bool]  = {}
        self._leaks:      Dict[str, float] = {}   # named boundary/junction leaks: node_name → Q[m3/s]
        self._cell_leaks: Dict[str, tuple] = {}   # arbitrary leaks: leak_id → (pipe_idx, node_idx, Q[m3/s])
        self._valves:     Dict[str, float] = {}   # junction_name → tau [0=closed,1=open]
        self._setup()

    def _setup(self) -> None:
        cfg = self.config;  dx = cfg["dx"]
        for seg in cfg["segments"]:
            pipe = PipeSegment(
                name=seg["name"], length_m=seg["length_m"],
                diameter_m=cfg["diameter_m"], wave_speed=cfg["wave_speed"],
                friction_factor=cfg["friction_factor"], density=cfg["density"],
                g=cfg.get("g", 9.81),
            )
            pipe.setup(dx)
            self.pipes.append(pipe)
        dts = [p.dt for p in self.pipes]
        if max(dts) - min(dts) > 1e-9:
            raise ValueError(f"Pipes have different Δt: {dts}")
        self.dt = dts[0]
        H0 = cfg.get("H_initial", 0.0);  V0 = cfg.get("V_initial", 0.0)
        for pipe in self.pipes:
            pipe.set_ic(H0, V0)
        for name in cfg.get("pump_stations", {}):
            self._pump_start[name] = -1.0;  self._pump_on[name] = False

    # ── Pump control ──────────────────────────────────────────────────────────
    def start_pump(self, name: str) -> None:
        if name in self._pump_start:
            self._pump_start[name] = self.t;  self._pump_on[name] = True

    def stop_pump(self, name: str) -> None:
        self._pump_on[name] = False

    def start_all_pumps(self) -> None:
        for name in self.config.get("pump_stations", {}): self.start_pump(name)

    def _alpha(self, name: str) -> float:
        if not self._pump_on.get(name, False): return 0.0
        start = self._pump_start.get(name, -1.0)
        if start < 0: return 0.0
        ramp = self.config["pump_stations"][name].get("ramp_time", 300.0)
        return max(0.0, min((self.t - start) / ramp, 1.0))

    # ── Leak control ──────────────────────────────────────────────────────────
    def add_leak(self, node_name: str, flow_m3s: float) -> None:
        """Add a fixed-flow leak at an existing named boundary/junction."""
        self._leaks[node_name] = abs(flow_m3s)

    def remove_leak(self, node_name: str) -> None:
        self._leaks.pop(node_name, None)

    def add_cell_leak(self, leak_id: str, pipe_idx: int, node_idx: int, flow_m3s: float) -> None:
        """Add a fixed-flow leak at an arbitrary grid cell inside a pipe."""
        if pipe_idx < 0 or pipe_idx >= len(self.pipes):
            raise ValueError(f"pipe_idx out of range: {pipe_idx}")
        pipe = self.pipes[pipe_idx]
        idx = max(1, min(pipe.N - 1, int(node_idx)))
        self._cell_leaks[str(leak_id)] = (pipe_idx, idx, abs(float(flow_m3s)))

    def remove_cell_leak(self, leak_id: str) -> None:
        self._cell_leaks.pop(str(leak_id), None)

    def clear_leaks(self) -> None:
        self._leaks.clear()
        self._cell_leaks.clear()

    # ── Valve control ─────────────────────────────────────────────────────────
    def set_valve_tau(self, junction_name: str, tau: float) -> None:
        """Set valve opening fraction tau in [0.0=closed … 1.0=fully open]."""
        self._valves[junction_name] = max(0.0, min(1.0, float(tau)))

    def get_valve_tau(self, junction_name: str) -> float:
        return self._valves.get(junction_name, 1.0)

    # ── Temperature / property update ─────────────────────────────────────────
    def update_pipe_temperature(self, pipe_name: str, friction_factor: float, density: float, temp_c: float) -> bool:
        """
        Update f and rho for a named pipe segment at runtime.
        Called by simulation_service when user changes a pipe temperature.
        Returns True if the pipe was found and updated.
        """
        for pipe in self.pipes:
            if pipe.name == pipe_name:
                pipe.update_properties(friction_factor, density)
                pipe.temperature_c = temp_c
                return True
        return False

    # ── Time step ─────────────────────────────────────────────────────────────
    def step(self) -> None:
        for pipe in self.pipes: pipe.solve_interior()
        self._apply_cell_leaks()
        self._bc_inlet_pump()
        self._bc_junction_pumps()
        self._bc_passthrough()
        self._bc_sink()
        for pipe in self.pipes: pipe.commit()
        self.t += self.dt


    def _apply_cell_leaks(self) -> None:
        """Apply arbitrary interior leaks after the ordinary interior MOC update.

        For a leak at an interior grid node, use the two characteristic
        constants CP and CM and continuity Q_left = Q_right + Q_leak.
        With the same head on both sides of the leak node:

            V_right = (CP - CM)/(2a/g) - (Q_leak/A)/2
            H_leak  = CM + (a/g) V_right

        The solver stores one nodal velocity, so this is a simplified
        demo-level representation, but the pressure drop comes from a real
        extra outflow instead of from an artificial pressure clamp.
        """
        if not self._cell_leaks:
            return
        for leak_id, (pipe_idx, node_idx, q_m3s) in list(self._cell_leaks.items()):
            if pipe_idx < 0 or pipe_idx >= len(self.pipes):
                continue
            pipe = self.pipes[pipe_idx]
            i = max(1, min(pipe.N - 1, int(node_idx)))
            ag = pipe.ag
            R = pipe.R
            CP = pipe.H[i-1] + ag * pipe.V[i-1] - R * abs(pipe.V[i-1]) * pipe.V[i-1]
            CM = pipe.H[i+1] - ag * pipe.V[i+1] + R * abs(pipe.V[i+1]) * pipe.V[i+1]
            q_over_area = q_m3s / pipe.area_m2
            v_right = (CP - CM) / (2.0 * ag) - 0.5 * q_over_area
            h_leak = CM + ag * v_right
            pipe.V_new[i] = max(v_right, 0.0)
            pipe.H_new[i] = max(h_leak, 0.0)

    # ── Boundary conditions ───────────────────────────────────────────────────
    def _pump_quadratic(self, CM, CP, H0, K, alpha, H_src, ag):
        Hp_max = H0 * alpha ** 2
        if CP is None:
            a_c, b_c, c_c = K, ag, CM - (H_src + Hp_max)
        else:
            a_c, b_c, c_c = K, 2.0*ag, CM - CP - Hp_max
        if a_c == 0.0:
            V = -(c_c) / b_c if b_c != 0 else 0.0
        else:
            disc = b_c**2 - 4.0*a_c*c_c
            V = (-b_c + math.sqrt(max(disc, 0.0))) / (2.0*a_c) if disc >= 0 else 0.0
        V = max(V, 0.0)
        H_dn = CM + ag*V
        H_up = (CP - ag*V) if CP is not None else H_dn
        return V, H_up, H_dn

    def _bc_inlet_pump(self) -> None:
        name = self.config.get("inlet_pump")
        if not name: return
        pc = self.config["pump_stations"].get(name, {})
        pipe = self.pipes[0];  ag = pipe.ag
        CM = pipe.CM_at_left();  alpha = self._alpha(name)
        V, _, _ = self._pump_quadratic(CM, None, pc["H0"], pc["K"], alpha, self.config.get("H_source",0.0), ag)
        Q_leak = self._leaks.get(name, 0.0)
        V = max(V - Q_leak/pipe.area_m2, 0.0)
        pipe.H_new[0] = CM + ag*V;  pipe.V_new[0] = V

    def _bc_junction_pumps(self) -> None:
        for name, jc in self.config.get("junction_pumps", {}).items():
            pc  = self.config["pump_stations"].get(name, {})
            up  = self.pipes[jc["pipe_up_idx"]];  dn = self.pipes[jc["pipe_dn_idx"]]
            ag  = up.ag
            CP  = up.CP_at_right();  CM = dn.CM_at_left();  alpha = self._alpha(name)
            tau = self._valves.get(name, 1.0)   # valve upstream of this pump

            # ── Solve with valve ─────────────────────────────────────────────
            # Step 1: compute what flow would be with valve fully open
            V_open, H_up_open, H_dn_open = self._pump_quadratic(
                CM, CP, pc["H0"], pc["K"], alpha, 0.0, ag
            )
            V_open = max(V_open, 0.0)

            # Step 2: valve restricts flow linearly by tau
            #   V_actual = tau * V_open
            #   H_up rises (water hammer!), H_dn falls as valve closes
            V_actual = tau * V_open
            H_up     = CP - ag * V_actual        # upstream of valve: pressure SURGE as tau→0
            H_dn_val = CM + ag * V_actual        # downstream of valve (pump suction)

            # Step 3: pump adds head on top of suction
            #   When valve is closed (V=0), pump deadheads: H_out = suction + Hp(0)
            Hp     = pc["H0"] * alpha**2         # head at zero flow
            H_dn   = H_dn_val + (Hp if tau < 0.001 else 0.0)
            if tau >= 0.001:
                H_dn = CM + ag * V_actual        # normal: pump BC already encoded in V

            Q_leak = self._leaks.get(name, 0.0)
            V_dn   = max(V_actual - Q_leak / dn.area_m2, 0.0)

            up.H_new[up.N] = H_up;  up.V_new[up.N] = V_actual
            dn.H_new[0]    = H_dn;  dn.V_new[0]    = V_dn

    def _bc_passthrough(self) -> None:
        for name, jc in self.config.get("passthrough_junctions", {}).items():
            up = self.pipes[jc["pipe_up_idx"]];  dn = self.pipes[jc["pipe_dn_idx"]]
            ag = up.ag
            CP = up.CP_at_right();  CM = dn.CM_at_left()
            V = (CP - CM) / (2.0*ag);  H = CP - ag*V
            H_relief = jc.get("H_relief")
            if H_relief and H > H_relief:
                H = H_relief;  V_up = (CP-H)/ag;  V_dn = (H-CM)/ag
            else:
                V_up = V_dn = V
            Q_leak = self._leaks.get(name, 0.0)
            V_dn = max(V_dn - Q_leak/dn.area_m2, 0.0);  V_up = max(V_up, 0.0)
            up.H_new[up.N] = H;  up.V_new[up.N] = V_up
            dn.H_new[0] = H;  dn.V_new[0] = V_dn

    def _bc_sink(self) -> None:
        pipe = self.pipes[-1];  H_sink = self.config.get("H_sink", 0.0)
        CP = pipe.CP_at_right();  V = (CP - H_sink) / pipe.ag
        pipe.H_new[pipe.N] = H_sink;  pipe.V_new[pipe.N] = max(V, 0.0)

    # ── Result extraction ─────────────────────────────────────────────────────
    def get_state(self, pipe_idx: int, node_idx: int) -> Tuple[float, float]:
        p = self.pipes[pipe_idx];  return float(p.H[node_idx]), float(p.V[node_idx])

    def get_flows_m3s(self) -> Dict[str, float]:
        return {p.name: p.flow_m3s(0) for p in self.pipes}

    def get_pipe_temperatures(self) -> Dict[str, float]:
        return {p.name: p.temperature_c for p in self.pipes}

    @property
    def simulation_time(self) -> float:
        return self.t