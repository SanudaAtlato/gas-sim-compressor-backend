"""
crude_thermal_hydraulic.py

Simple thermal-hydraulic crude oil helper library.

Physics included:
1. Heater energy balance
2. Heater efficiency / fuel duty
3. Pipe heat loss to ambient
4. Temperature-dependent viscosity
5. Reynolds number
6. Darcy friction factor
7. Darcy-Weisbach pressure drop

This is a usable first-principles engineering model, not just cosmetic heating.
"""

from __future__ import annotations

from dataclasses import dataclass
import math


@dataclass
class HeaterStation:
    id: str
    target_temperature_K: float
    max_heat_power_W: float
    efficiency: float = 0.85
    min_heat_power_W: float = 0.0


@dataclass
class PipeSection:
    id: str
    length_m: float
    diameter_m: float
    roughness_m: float
    U_W_m2K: float


@dataclass
class FluidState:
    temperature_K: float
    pressure_Pa: float
    mass_flow_kg_s: float
    density_kg_m3: float
    cp_J_kgK: float


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(value, high))


def apply_crude_heater(
    T_in_K: float,
    m_dot_kg_s: float,
    cp_J_kgK: float,
    heater: HeaterStation,
) -> dict:
    """
    Adds continuous controlled heat to crude oil.

    Q_needed = m_dot * cp * (T_target - T_in)
    Q_useful = clamp(Q_needed, min_power, max_power)
    T_out = T_in + Q_useful / (m_dot * cp)

    Efficiency is used for fuel/input power:
    Q_fuel = Q_useful / efficiency
    """

    if m_dot_kg_s <= 1e-9:
        return {
            "T_out_K": T_in_K,
            "Q_useful_W": 0.0,
            "Q_fuel_W": 0.0,
            "heater_active": False,
        }

    q_needed = m_dot_kg_s * cp_J_kgK * (heater.target_temperature_K - T_in_K)

    # Do not cool using heater.
    if q_needed <= 0:
        q_useful = 0.0
    else:
        q_useful = clamp(q_needed, heater.min_heat_power_W, heater.max_heat_power_W)

    T_out_K = T_in_K + q_useful / (m_dot_kg_s * cp_J_kgK)

    if heater.efficiency <= 0:
        q_fuel = q_useful
    else:
        q_fuel = q_useful / heater.efficiency

    return {
        "T_out_K": T_out_K,
        "Q_useful_W": q_useful,
        "Q_fuel_W": q_fuel,
        "heater_active": q_useful > 0,
    }


def pipe_temperature_loss(
    T_in_K: float,
    T_ambient_K: float,
    m_dot_kg_s: float,
    cp_J_kgK: float,
    pipe: PipeSection,
) -> float:
    """
    Exponential cooling/heating toward ambient temperature:

    T_out = T_amb + (T_in - T_amb) * exp(-U*pi*D*L/(m_dot*cp))

    U is the overall heat transfer coefficient.
    """

    if m_dot_kg_s <= 1e-9:
        return T_in_K

    exponent = -(
        pipe.U_W_m2K * math.pi * pipe.diameter_m * pipe.length_m
    ) / (m_dot_kg_s * cp_J_kgK)

    return T_ambient_K + (T_in_K - T_ambient_K) * math.exp(exponent)


def crude_viscosity_from_temperature(
    T_K: float,
    mu_ref_Pa_s: float = 0.02,
    T_ref_K: float = 293.15,
    B_K: float = 1800.0,
) -> float:
    """
    Andrade/Arrhenius-style viscosity model:

    mu(T) = mu_ref * exp(B * (1/T - 1/T_ref))

    For crude oil, B must be calibrated from real viscosity-temperature data.
    """

    if T_K <= 0:
        raise ValueError("Temperature must be in Kelvin and greater than zero.")

    return mu_ref_Pa_s * math.exp(B_K * ((1.0 / T_K) - (1.0 / T_ref_K)))


def reynolds_number(
    rho_kg_m3: float,
    velocity_m_s: float,
    diameter_m: float,
    mu_Pa_s: float,
) -> float:
    if mu_Pa_s <= 0:
        raise ValueError("Viscosity must be greater than zero.")

    return rho_kg_m3 * velocity_m_s * diameter_m / mu_Pa_s


def friction_factor_swamee_jain(
    Re: float,
    roughness_m: float,
    diameter_m: float,
) -> float:
    """
    Darcy friction factor.

    Laminar: f = 64/Re
    Turbulent: Swamee-Jain approximation
    """

    if Re <= 0:
        return 0.0

    if Re < 2300:
        return 64.0 / Re

    return 0.25 / (
        math.log10(
            (roughness_m / (3.7 * diameter_m)) + (5.74 / (Re ** 0.9))
        )
    ) ** 2


def pipe_pressure_drop(
    m_dot_kg_s: float,
    rho_kg_m3: float,
    pipe: PipeSection,
    mu_Pa_s: float,
) -> dict:
    """
    Darcy-Weisbach pressure loss:

    dP = f * (L/D) * rho*v^2/2
    """

    if rho_kg_m3 <= 0:
        raise ValueError("Density must be greater than zero.")

    area_m2 = math.pi * pipe.diameter_m**2 / 4.0

    if area_m2 <= 0:
        raise ValueError("Pipe diameter must be greater than zero.")

    velocity_m_s = m_dot_kg_s / (rho_kg_m3 * area_m2)

    Re = reynolds_number(
        rho_kg_m3=rho_kg_m3,
        velocity_m_s=abs(velocity_m_s),
        diameter_m=pipe.diameter_m,
        mu_Pa_s=mu_Pa_s,
    )

    f = friction_factor_swamee_jain(
        Re=Re,
        roughness_m=pipe.roughness_m,
        diameter_m=pipe.diameter_m,
    )

    dP_Pa = f * (pipe.length_m / pipe.diameter_m) * 0.5 * rho_kg_m3 * velocity_m_s**2

    return {
        "velocity_m_s": velocity_m_s,
        "Re": Re,
        "friction_factor": f,
        "pressure_drop_Pa": dP_Pa,
    }


def simulate_pipe_then_optional_heater(
    state: FluidState,
    pipe: PipeSection,
    T_ambient_K: float,
    heater: HeaterStation | None = None,
    viscosity_mu_ref_Pa_s: float = 0.02,
    viscosity_T_ref_K: float = 293.15,
    viscosity_B_K: float = 1800.0,
) -> dict:
    """
    One reusable step:

    1. Oil loses/gains heat through pipe wall.
    2. Optional heater adds controlled heat.
    3. Viscosity is updated from final temperature.
    4. Pressure drop is calculated using updated viscosity.
    5. Outlet pressure is returned.
    """

    T_after_pipe_K = pipe_temperature_loss(
        T_in_K=state.temperature_K,
        T_ambient_K=T_ambient_K,
        m_dot_kg_s=state.mass_flow_kg_s,
        cp_J_kgK=state.cp_J_kgK,
        pipe=pipe,
    )

    heater_result = {
        "T_out_K": T_after_pipe_K,
        "Q_useful_W": 0.0,
        "Q_fuel_W": 0.0,
        "heater_active": False,
    }

    if heater is not None:
        heater_result = apply_crude_heater(
            T_in_K=T_after_pipe_K,
            m_dot_kg_s=state.mass_flow_kg_s,
            cp_J_kgK=state.cp_J_kgK,
            heater=heater,
        )

    T_final_K = heater_result["T_out_K"]

    mu_Pa_s = crude_viscosity_from_temperature(
        T_K=T_final_K,
        mu_ref_Pa_s=viscosity_mu_ref_Pa_s,
        T_ref_K=viscosity_T_ref_K,
        B_K=viscosity_B_K,
    )

    hydraulic = pipe_pressure_drop(
        m_dot_kg_s=state.mass_flow_kg_s,
        rho_kg_m3=state.density_kg_m3,
        pipe=pipe,
        mu_Pa_s=mu_Pa_s,
    )

    P_out_Pa = state.pressure_Pa - hydraulic["pressure_drop_Pa"]

    outlet_state = FluidState(
        temperature_K=T_final_K,
        pressure_Pa=P_out_Pa,
        mass_flow_kg_s=state.mass_flow_kg_s,
        density_kg_m3=state.density_kg_m3,
        cp_J_kgK=state.cp_J_kgK,
    )

    return {
        "outlet_state": outlet_state,
        "T_after_pipe_K": T_after_pipe_K,
        "heater": heater_result,
        "viscosity_Pa_s": mu_Pa_s,
        "hydraulic": hydraulic,
    }