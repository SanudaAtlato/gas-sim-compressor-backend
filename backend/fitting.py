import numpy as np
from scipy.optimize import curve_fit


def dra_model(C, a, b):
    return (a * C) / (1 + b * C)


def fit_dra_parameters(C_data, DR_data):
    C = np.array(C_data, dtype=float)
    DR = np.array(DR_data, dtype=float)

    nonzero = C > 0
    C_nonzero = C[nonzero]
    DR_nonzero = DR[nonzero]

    a0 = DR_nonzero[0] / C_nonzero[0]
    b0 = a0 / max(DR_nonzero)

    popt, _ = curve_fit(
        dra_model,
        C,
        DR,
        p0=[a0, b0],
        bounds=(0, np.inf)
    )

    a, b = popt
    DR_pred = dra_model(C, a, b)
    residuals = DR - DR_pred

    ss_res = np.sum(residuals ** 2)
    ss_tot = np.sum((DR - np.mean(DR)) ** 2)
    r2 = 1 - (ss_res / ss_tot)

    return {
        "a": float(a),
        "b": float(b),
        "DR_max_fraction": float(a / b),
        "R2": float(r2),
        "predicted_DR": DR_pred.tolist(),
        "residuals": residuals.tolist()
    }