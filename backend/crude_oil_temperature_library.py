"""
Crude Oil Temperature Property Library
For crude-oil pipeline leak detection, transient simulation, pressure-drop calculation,
and temperature-dependent sensor/model residual generation.

Default crude: TAPS / North Slope-like light crude, API = 33.4 deg API.
All functions use Celsius input unless stated otherwise.

Main outputs:
- density: kg/m3
- dynamic viscosity: cP and Pa.s
- thermal conductivity: W/(m.K)
- specific heat capacity: J/(kg.K)
- surface tension: mN/m
- vapor pressure: kPa
- velocity from mass flow: m/s
- Reynolds number
- Darcy friction factor
- Darcy-Weisbach pressure drop

Important engineering note:
These are empirical engineering correlations, not lab-certified assay data.
Use them for simulation/demo/solver behavior, then replace constants with measured crude assay data
when available.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
import math
from typing import Dict, Optional


@dataclass(frozen=True)
class CrudeOilTemperatureConfig:
    """Configuration for crude oil property calculations."""

    api_gravity: float = 33.4
    pipe_diameter_m: float = 1.2192          # 48 inch pipe
    pipe_roughness_m: float = 0.000046       # commercial steel roughness
    default_mass_flow_kg_s: float = 855.0    # TAPS-style reference mass flow
    min_valid_temp_c: float = 4.0            # Beggs-Robinson approx validity lower bound
    max_valid_temp_c: float = 146.0          # Beggs-Robinson approx validity upper bound


class CrudeOilTemperatureLibrary:
    """Temperature-dependent crude oil property model."""

    def __init__(self, config: Optional[CrudeOilTemperatureConfig] = None):
        self.config = config or CrudeOilTemperatureConfig()

    # ------------------------------------------------------------------
    # Basic API gravity helpers
    # ------------------------------------------------------------------
    def specific_gravity(self, api: Optional[float] = None) -> float:
        """Specific gravity from API gravity."""
        api = self.config.api_gravity if api is None else api
        return 141.5 / (api + 131.5)

    def reference_density_15c(self, api: Optional[float] = None) -> float:
        """Reference crude density at 15 deg C, kg/m3."""
        return self.specific_gravity(api) * 999.0

    def crude_grade(self, api: Optional[float] = None) -> str:
        """Simple crude classification by API gravity."""
        api = self.config.api_gravity if api is None else api
        if api < 10:
            return "extra_heavy"
        if api < 22:
            return "heavy"
        if api < 31:
            return "medium"
        if api < 45:
            return "light"
        return "extra_light_or_condensate"

    # ------------------------------------------------------------------
    # Temperature-dependent fluid properties
    # ------------------------------------------------------------------
    def density_kg_m3(self, temp_c: float, api: Optional[float] = None) -> float:
        """
        Density at temperature T.

        rho(T) = rho15 / [1 + beta * (T - 15)]
        beta = K0 / rho15^2
        K0 = 613.9723 crude oil constant
        """
        rho15 = self.reference_density_15c(api)
        beta = 613.9723 / (rho15 * rho15)
        return rho15 / (1.0 + beta * (temp_c - 15.0))

    def viscosity_cp(self, temp_c: float, api: Optional[float] = None) -> Optional[float]:
        """
        Dynamic viscosity in cP using Beggs-Robinson dead crude correlation.

        mu = 10^x - 1
        x = T_F^-1.163 * exp(6.9824 - 0.04658 * API)

        Returns None outside the approximate Beggs-Robinson temperature validity range.
        """
        api = self.config.api_gravity if api is None else api
        temp_f = temp_c * 9.0 / 5.0 + 32.0
        if temp_f < 40.0 or temp_f > 295.0:
            return None
        x = (temp_f ** -1.163) * math.exp(6.9824 - 0.04658 * api)
        return max(0.05, (10.0 ** x) - 1.0)

    def viscosity_pa_s(self, temp_c: float, api: Optional[float] = None) -> Optional[float]:
        """Dynamic viscosity in Pa.s. 1 cP = 0.001 Pa.s."""
        mu_cp = self.viscosity_cp(temp_c, api)
        return None if mu_cp is None else mu_cp * 0.001

    def thermal_conductivity_w_mk(self, temp_c: float, api: Optional[float] = None) -> float:
        """
        Thermal conductivity, W/(m.K).

        k(T) = (0.1172 / sqrt(SG)) * [1 - 3e-4 * (T - 15)]
        """
        sg = self.specific_gravity(api)
        return (0.1172 / math.sqrt(sg)) * (1.0 - 3.0e-4 * (temp_c - 15.0))

    def heat_capacity_j_kgk(self, temp_c: float, api: Optional[float] = None) -> float:
        """
        Specific heat capacity, J/(kg.K).

        Cp(T) = (1623.8 + 1.884*T) / sqrt(SG)
        """
        sg = self.specific_gravity(api)
        return (1623.8 + 1.884 * temp_c) / math.sqrt(sg)

    def surface_tension_mn_m(self, temp_c: float, api: Optional[float] = None) -> float:
        """
        Surface tension, mN/m.

        sigma20 = 39 - 0.2571*API
        sigma38 = 37.5 - 0.2571*API
        slope = (sigma38 - sigma20) / (37.8 - 20)
        """
        api = self.config.api_gravity if api is None else api
        sigma20 = 39.0 - 0.2571 * api
        sigma38 = 37.5 - 0.2571 * api
        slope = (sigma38 - sigma20) / 17.8
        return sigma20 + slope * (temp_c - 20.0)

    def vapor_pressure_kpa(self, temp_c: float, api: Optional[float] = None) -> float:
        """
        Simplified API-adjusted Clausius-Clapeyron vapor pressure estimate, kPa.

        Pv = Pref * exp[-(dHvap/R) * (1/TK - 1/Tref)]
        dHvap = 45000 - (API - 20)*400 J/mol
        Pref = 30 + (API - 20)*2 kPa at 37.8 C
        """
        api = self.config.api_gravity if api is None else api
        tk = temp_c + 273.15
        tref = 311.0
        dh_vap = 45000.0 - (api - 20.0) * 400.0
        pref = 30.0 + (api - 20.0) * 2.0
        return pref * math.exp(-(dh_vap / 8.314) * ((1.0 / tk) - (1.0 / tref)))

    # ------------------------------------------------------------------
    # Solver / pipeline helper calculations
    # ------------------------------------------------------------------
    def pipe_area_m2(self, diameter_m: Optional[float] = None) -> float:
        """Pipe cross-sectional area, m2."""
        d = self.config.pipe_diameter_m if diameter_m is None else diameter_m
        return math.pi * d * d / 4.0

    def velocity_m_s(
        self,
        temp_c: float,
        mass_flow_kg_s: Optional[float] = None,
        diameter_m: Optional[float] = None,
        api: Optional[float] = None,
    ) -> float:
        """Average velocity from mass flow: v = mdot / [rho(T) * A]."""
        mdot = self.config.default_mass_flow_kg_s if mass_flow_kg_s is None else mass_flow_kg_s
        rho = self.density_kg_m3(temp_c, api)
        area = self.pipe_area_m2(diameter_m)
        return mdot / (rho * area)

    def reynolds_number(
        self,
        temp_c: float,
        velocity_m_s: float,
        diameter_m: Optional[float] = None,
        api: Optional[float] = None,
    ) -> Optional[float]:
        """Re = rho*v*D/mu."""
        d = self.config.pipe_diameter_m if diameter_m is None else diameter_m
        rho = self.density_kg_m3(temp_c, api)
        mu = self.viscosity_pa_s(temp_c, api)
        if mu is None or mu <= 0.0:
            return None
        return rho * velocity_m_s * d / mu

    def darcy_friction_factor(
        self,
        reynolds: float,
        diameter_m: Optional[float] = None,
        roughness_m: Optional[float] = None,
    ) -> Optional[float]:
        """
        Darcy friction factor.
        Laminar: f = 64/Re
        Turbulent: Colebrook-White fixed-point iteration.
        """
        if reynolds is None or reynolds <= 0.0:
            return None
        if reynolds < 2300.0:
            return 64.0 / reynolds

        d = self.config.pipe_diameter_m if diameter_m is None else diameter_m
        eps = self.config.pipe_roughness_m if roughness_m is None else roughness_m

        f = 0.02
        for _ in range(50):
            rhs = -2.0 * math.log10(eps / (3.7 * d) + 2.51 / (reynolds * math.sqrt(f)))
            f = 1.0 / (rhs * rhs)
        return f

    def pressure_drop_pa(
        self,
        temp_c: float,
        length_m: float,
        velocity_m_s: Optional[float] = None,
        mass_flow_kg_s: Optional[float] = None,
        diameter_m: Optional[float] = None,
        roughness_m: Optional[float] = None,
        elevation_change_m: float = 0.0,
        api: Optional[float] = None,
    ) -> Optional[float]:
        """
        Total pressure drop over a segment, Pa.

        Friction: dP = f*(L/D)*rho*v^2/2
        Gravity:  dP = rho*g*dz
        Total:    dP_total = dP_friction + dP_gravity
        """
        d = self.config.pipe_diameter_m if diameter_m is None else diameter_m
        v = velocity_m_s
        if v is None:
            v = self.velocity_m_s(temp_c, mass_flow_kg_s, d, api)

        rho = self.density_kg_m3(temp_c, api)
        re = self.reynolds_number(temp_c, v, d, api)
        f = self.darcy_friction_factor(re, d, roughness_m) if re is not None else None
        if f is None:
            return None

        dp_friction = f * (length_m / d) * rho * v * v / 2.0
        dp_gravity = rho * 9.80665 * elevation_change_m
        return dp_friction + dp_gravity

    def pressure_drop_kpa_per_km(
        self,
        temp_c: float,
        velocity_m_s: Optional[float] = None,
        mass_flow_kg_s: Optional[float] = None,
        api: Optional[float] = None,
    ) -> Optional[float]:
        """Pressure drop over 1 km, kPa/km."""
        dp_pa = self.pressure_drop_pa(
            temp_c=temp_c,
            length_m=1000.0,
            velocity_m_s=velocity_m_s,
            mass_flow_kg_s=mass_flow_kg_s,
            api=api,
        )
        return None if dp_pa is None else dp_pa / 1000.0

    # ------------------------------------------------------------------
    # Convenience outputs for dashboard / solver / JSON API
    # ------------------------------------------------------------------
    def property_snapshot(
        self,
        temp_c: float,
        mass_flow_kg_s: Optional[float] = None,
        api: Optional[float] = None,
    ) -> Dict[str, Optional[float | str | Dict[str, float]]]:
        """Return all useful temperature-dependent properties at one temperature."""
        api_value = self.config.api_gravity if api is None else api
        v = self.velocity_m_s(temp_c, mass_flow_kg_s=mass_flow_kg_s, api=api_value)
        re = self.reynolds_number(temp_c, v, api=api_value)
        f = self.darcy_friction_factor(re) if re is not None else None
        return {
            "temperature_C": temp_c,
            "api_gravity_deg": api_value,
            "crude_grade": self.crude_grade(api_value),
            "specific_gravity": self.specific_gravity(api_value),
            "density_kg_m3": self.density_kg_m3(temp_c, api_value),
            "viscosity_cP": self.viscosity_cp(temp_c, api_value),
            "viscosity_Pa_s": self.viscosity_pa_s(temp_c, api_value),
            "thermal_conductivity_W_mK": self.thermal_conductivity_w_mk(temp_c, api_value),
            "heat_capacity_J_kgK": self.heat_capacity_j_kgk(temp_c, api_value),
            "surface_tension_mN_m": self.surface_tension_mn_m(temp_c, api_value),
            "vapor_pressure_kPa": self.vapor_pressure_kpa(temp_c, api_value),
            "velocity_m_s": v,
            "reynolds_number": re,
            "darcy_friction_factor": f,
            "pressure_drop_kPa_per_km": self.pressure_drop_kpa_per_km(temp_c, velocity_m_s=v, api=api_value),
            "config": asdict(self.config),
        }

    def temperature_table(
        self,
        start_c: float = 0.0,
        stop_c: float = 80.0,
        step_c: float = 5.0,
        mass_flow_kg_s: Optional[float] = None,
        api: Optional[float] = None,
    ) -> list[Dict[str, Optional[float | str | Dict[str, float]]]]:
        """Generate a table of property snapshots across a temperature range."""
        if step_c <= 0:
            raise ValueError("step_c must be positive")
        rows = []
        t = start_c
        while t <= stop_c + 1e-9:
            rows.append(self.property_snapshot(round(t, 6), mass_flow_kg_s, api))
            t += step_c
        return rows


if __name__ == "__main__":
    crude = CrudeOilTemperatureLibrary()
    for temp in [29.0, 50.0, 63.0]:
        row = crude.property_snapshot(temp)
        print(
            f"T={temp:.1f} C | "
            f"rho={row['density_kg_m3']:.2f} kg/m3 | "
            f"mu={row['viscosity_cP']:.3f} cP | "
            f"v={row['velocity_m_s']:.4f} m/s | "
            f"Re={row['reynolds_number']:.0f} | "
            f"dP={row['pressure_drop_kPa_per_km']:.2f} kPa/km"
        )