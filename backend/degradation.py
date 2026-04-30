import numpy as np


def active_concentration_from_dr(DR, a, b):
    DR = np.array(DR, dtype=float)

    denominator = a - b * DR

    if np.any(denominator <= 0):
        raise ValueError("Invalid DR value. DR is too high for this a,b model.")

    return DR / denominator


def fit_kd_from_concentration(x, C_active):
    x = np.array(x, dtype=float)
    C_active = np.array(C_active, dtype=float)

    if np.any(C_active <= 0):
        raise ValueError("All active concentrations must be positive.")

    ln_C = np.log(C_active)

    slope, intercept = np.polyfit(x, ln_C, 1)

    kd = -slope
    C0 = np.exp(intercept)

    return {
        "kd": float(kd),
        "C0_estimated": float(C0),
        "slope": float(slope),
        "intercept": float(intercept)
    }


def fit_kd_from_dr(x, DR, a, b):
    C_active = active_concentration_from_dr(DR, a, b)

    result = fit_kd_from_concentration(x, C_active)
    result["C_active_estimated"] = C_active.tolist()

    return result


def predict_active_concentration(C0, kd, x):
    return C0 * np.exp(-kd * x)